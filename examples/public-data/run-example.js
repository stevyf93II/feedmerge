// run-example.js — the whole pipeline, offline, in one script.
//
//   node examples/public-data/run-example.js
//
// Demonstrates, in order:
//   1. Day 1 sync: four units arrive; none have hand-collected specs yet,
//      so all are flagged needs_enrichment. The fake-unique VIN column is
//      detected and warned about.
//   2. An operator enriches one unit by hand (length_ft, sleeps).
//   3. Day 2 sync: a price changes, one unit vanishes (retired, not
//      deleted), one arrives, and the empty-price unit gets a real price.
//      The hand enrichment SURVIVES even though the feed knows nothing
//      about those fields.
//   4. A catastrophic day 3: the feed returns empty. The merge retires
//      everything but deletes nothing, and the publish guard refuses to
//      overwrite the catalog. Nothing is lost.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../../src/adapters/csv-url.js";
import { normalize, findFakeUniqueColumns } from "../../src/normalize.js";
import { merge } from "../../src/merge.js";
import { publish, readLatest } from "../../src/publish.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "data");
fs.rmSync(outDir, { recursive: true, force: true });

const config = {
  key: "stock_number",
  fieldMap: {
    stock_number: "StockNumber",
    title: "Title",
    price: { from: "Price", type: "number" },
    status: "Status",
    vin: "Vin",
  },
  feedFields: ["title", "price", "status"],
  requiredEnrichment: ["length_ft", "sleeps"],
  suspectUniqueColumns: ["vin"],
  outDir,
  maxDropPct: 20,
};

function sync(csvFile, label, when) {
  console.log(`\n=== ${label} ===`);
  const raw = parseCsv(fs.readFileSync(path.join(here, csvFile), "utf8"));

  const fakes = findFakeUniqueColumns(raw, config.suspectUniqueColumns);
  for (const f of fakes) {
    console.log(`warning: "${f.column}" duplicates "${f.duplicates}" on every record — not trusting it as an id`);
  }

  const fresh = normalize(raw, config);
  const previous = readLatest(outDir);
  const retained = previous ? previous.records : [];
  const { records, summary } = merge(fresh, retained, config, when);
  console.log("merge:", summary);

  const result = publish(records, config, when);
  if (result.published) {
    console.log(`published: ${result.counts.active} active records`);
  } else {
    console.log(`PUBLISH REFUSED: ${result.reason}`);
  }
}

// Day 1
sync("feed-day1.csv", "Day 1: first sync", new Date("2026-08-18T06:00:00Z"));

// Operator enriches T1001 by hand between syncs.
{
  const latest = readLatest(outDir);
  const t1001 = latest.records.find((r) => r.stock_number === "T1001");
  t1001.length_ft = 32.9;
  t1001.sleeps = 6;
  t1001.needs_enrichment = false;
  fs.writeFileSync(path.join(outDir, "catalog.json"), JSON.stringify(latest, null, 2));
  // write it back over the latest snapshot too so the next run's readLatest sees it
  const snaps = fs.readdirSync(outDir).filter((f) => /^catalog-\d/.test(f)).sort();
  fs.writeFileSync(path.join(outDir, snaps[snaps.length - 1]), JSON.stringify(latest, null, 2));
  console.log("\n(operator hand-enriched T1001 with length_ft and sleeps)");
}

// Day 2
sync("feed-day2.csv", "Day 2: price change, one unit gone, one new", new Date("2026-08-18T12:00:00Z"));

{
  const latest = readLatest(outDir);
  const t1001 = latest.records.find((r) => r.stock_number === "T1001");
  const t1002 = latest.records.find((r) => r.stock_number === "T1002");
  console.log(`\nT1001 after day 2: price=${t1001.price} (feed updated it), length_ft=${t1001.length_ft} (enrichment SURVIVED)`);
  console.log(`T1002 after day 2: retired=${t1002.retired} (gone from feed -> retired, not deleted)`);
}

// Day 3: catastrophic empty feed
console.log("\n=== Day 3: the feed returns EMPTY (outage upstream) ===");
{
  const previous = readLatest(outDir);
  const { records, summary } = merge([], previous.records, config, new Date("2026-08-18T18:00:00Z"));
  console.log("merge:", summary, "(everything retired, NOTHING deleted)");
  const result = publish(records, config, new Date("2026-08-18T18:00:00Z"));
  console.log(result.published ? "published (unexpected!)" : `PUBLISH REFUSED: ${result.reason}`);
  console.log(`catalog on disk still has ${readLatest(outDir).records.length} records — nothing lost`);
}
