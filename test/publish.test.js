import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { publish, rollback, readLatest, listSnapshots } from "../src/publish.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "feedmerge-"));
}

const recs = (n, retired = 0) =>
  Array.from({ length: n }, (_, i) => ({
    stock_number: `S${i}`,
    retired: i < retired,
  }));

test("publish writes a snapshot and a stable catalog.json pointer", () => {
  const dir = tmpDir();
  const r = publish(recs(10), { outDir: dir }, new Date("2026-08-18T12:00:00Z"));
  assert.equal(r.published, true);
  assert.ok(fs.existsSync(path.join(dir, "catalog.json")));
  const latest = readLatest(dir);
  assert.equal(latest.records.length, 10);
  assert.equal(latest.counts.active, 10);
});

test("the count-drop guard refuses a suspicious collapse — the zero-record incident, again", () => {
  const dir = tmpDir();
  publish(recs(200), { outDir: dir }, new Date("2026-08-18T12:00:00Z"));

  // Next run the feed comes back nearly empty. This is almost never real.
  const r = publish(recs(3), { outDir: dir }, new Date("2026-08-18T18:00:00Z"));
  assert.equal(r.published, false);
  assert.match(r.reason, /refusing to publish/);
  assert.match(r.reason, /--force/);

  // The catalog on disk is untouched.
  assert.equal(readLatest(dir).records.length, 200);
});

test("force overrides the guard when a human says the drop is real", () => {
  const dir = tmpDir();
  publish(recs(200), { outDir: dir }, new Date("2026-08-18T12:00:00Z"));
  const r = publish(recs(3), { outDir: dir, force: true }, new Date("2026-08-18T18:00:00Z"));
  assert.equal(r.published, true);
});

test("a drop within tolerance publishes normally", () => {
  const dir = tmpDir();
  publish(recs(100), { outDir: dir }, new Date("2026-08-18T12:00:00Z"));
  const r = publish(recs(85), { outDir: dir, maxDropPct: 20 }, new Date("2026-08-18T18:00:00Z"));
  assert.equal(r.published, true);
});

test("retired records do not count toward the active total the guard watches", () => {
  const dir = tmpDir();
  publish(recs(100), { outDir: dir }, new Date("2026-08-18T12:00:00Z"));
  // 100 records still exist but 90 are retired -> active fell to 10 -> refuse.
  const r = publish(recs(100, 90), { outDir: dir }, new Date("2026-08-18T18:00:00Z"));
  assert.equal(r.published, false);
});

test("snapshot retention prunes to keep", () => {
  const dir = tmpDir();
  for (let h = 0; h < 8; h++) {
    publish(recs(50), { outDir: dir, keep: 3 }, new Date(`2026-08-18T0${h}:00:00Z`));
  }
  assert.equal(listSnapshots(dir).length, 3);
});

test("rollback restores the previous snapshot and sets the bad one aside", () => {
  const dir = tmpDir();
  publish(recs(200), { outDir: dir }, new Date("2026-08-18T12:00:00Z"));
  // A bad snapshot slipped through (forced past the guard, or a subtle
  // corruption the guard cannot see). Rollback is the recovery path.
  publish(recs(150), { outDir: dir, force: true }, new Date("2026-08-18T18:00:00Z"));

  const r = rollback(dir);
  assert.equal(r.rolledBack, true);

  const live = JSON.parse(fs.readFileSync(path.join(dir, "catalog.json"), "utf8"));
  assert.equal(live.records.length, 200, "previous snapshot is live again");
  assert.ok(
    fs.existsSync(path.join(dir, r.setAside)),
    "the bad snapshot is kept as evidence, not deleted"
  );
});

test("rollback refuses when there is nothing to roll back to", () => {
  const dir = tmpDir();
  publish(recs(10), { outDir: dir }, new Date("2026-08-18T12:00:00Z"));
  const r = rollback(dir);
  assert.equal(r.rolledBack, false);
});
