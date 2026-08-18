import { test } from "node:test";
import assert from "node:assert/strict";
import { merge } from "../src/merge.js";

const config = {
  key: "stock_number",
  feedFields: ["title", "price", "status"],
  requiredEnrichment: ["length_ft"],
};

const NOW = new Date("2026-08-18T12:00:00Z");

test("a field the feed omits is NEVER overwritten — the core rule", () => {
  const retained = [
    {
      stock_number: "A1",
      title: "Old Title",
      price: 100,
      length_ft: 35.5, // hand-collected enrichment; the feed knows nothing of it
      retired: false,
      first_seen: "2026-01-01T00:00:00.000Z",
      last_seen: "2026-01-01T00:00:00.000Z",
    },
  ];
  // Feed carries title and price but omits length_ft entirely, and this run
  // its price came through empty (normalized to null).
  const fresh = [{ stock_number: "A1", title: "New Title", price: null, status: "in stock" }];

  const { records } = merge(fresh, retained, config, NOW);
  const rec = records.find((r) => r.stock_number === "A1");

  assert.equal(rec.title, "New Title", "feed is authoritative for fields it carries");
  assert.equal(rec.price, 100, "a null from the feed must not clobber a retained value");
  assert.equal(rec.length_ft, 35.5, "enrichment the feed never carries must survive");
});

test("records missing from the feed are retired, not deleted", () => {
  const retained = [
    { stock_number: "A1", title: "Here", retired: false },
    { stock_number: "GONE", title: "Sold?", length_ft: 30, retired: false },
  ];
  const fresh = [{ stock_number: "A1", title: "Here" }];

  const { records, summary } = merge(fresh, retained, config, NOW);
  const gone = records.find((r) => r.stock_number === "GONE");

  assert.ok(gone, "the record still exists");
  assert.equal(gone.retired, true);
  assert.equal(gone.retired_at, NOW.toISOString());
  assert.equal(gone.length_ft, 30, "retirement keeps the enrichment too");
  assert.equal(summary.retired, 1);
});

test("an EMPTY feed retires everything but deletes nothing — the zero-record incident", () => {
  // This is the real failure this tool exists for: upstream returned empty
  // while looking healthy. The catalog must survive it intact.
  const retained = [
    { stock_number: "A1", title: "One", length_ft: 30, retired: false },
    { stock_number: "A2", title: "Two", length_ft: 28, retired: false },
  ];

  const { records } = merge([], retained, config, NOW);

  assert.equal(records.length, 2, "no record was deleted");
  assert.ok(records.every((r) => r.retired === true), "all marked retired, recoverable");
  assert.ok(records.every((r) => r.length_ft !== undefined), "enrichment intact");
});

test("a record returning to the feed is revived, enrichment intact", () => {
  const retained = [
    {
      stock_number: "B7",
      title: "Back",
      length_ft: 40,
      retired: true,
      retired_at: "2026-08-01T00:00:00.000Z",
    },
  ];
  const fresh = [{ stock_number: "B7", title: "Back Again", price: 500 }];

  const { records, summary } = merge(fresh, retained, config, NOW);
  const rec = records[0];

  assert.equal(rec.retired, false);
  assert.equal(rec.retired_at, undefined);
  assert.equal(rec.length_ft, 40);
  assert.equal(rec.title, "Back Again");
  assert.equal(summary.revived, 1);
});

test("new records are stamped and flagged for enrichment", () => {
  const fresh = [{ stock_number: "N1", title: "Brand New", price: 900 }];

  const { records, summary } = merge(fresh, [], config, NOW);
  const rec = records[0];

  assert.equal(rec.first_seen, NOW.toISOString());
  assert.equal(rec.last_seen, NOW.toISOString());
  assert.equal(rec.retired, false);
  assert.equal(rec.needs_enrichment, true, "no length_ft yet -> flagged");
  assert.equal(summary.added, 1);
  assert.equal(summary.needs_enrichment, 1);
});

test("fully enriched records are not flagged", () => {
  const fresh = [{ stock_number: "N2", title: "Complete", price: 900 }];
  const retained = [
    { stock_number: "N2", title: "Complete", price: 900, length_ft: 22, retired: false },
  ];

  const { records } = merge(fresh, retained, config, NOW);
  assert.equal(records[0].needs_enrichment, false);
});
