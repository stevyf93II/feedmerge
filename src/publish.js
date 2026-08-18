// publish.js — write the catalog as a versioned snapshot, guarded.
//
// The guard exists because of a real incident: a scheduled sync once
// committed a ZERO-record catalog to production, because the upstream
// returned an empty result to datacenter IPs while looking healthy. It was
// only recovered by restoring the file from an old git SHA by hand.
//
// The lesson: a publish step must be suspicious of its own input. A large
// drop in record count is far more likely to be a broken feed than a real
// change in the world, so it is refused until a human says otherwise.

import fs from "node:fs";
import path from "node:path";

const SNAPSHOT_RE = /^catalog-(\d{8}T\d{6})(-\d+)?\.json$/;

function snapshotName(now) {
  const iso = now.toISOString().replace(/[-:]/g, "").slice(0, 15); // 20260818T061500
  return `catalog-${iso}.json`;
}

export function listSnapshots(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => SNAPSHOT_RE.test(f))
    .sort(); // timestamp names sort chronologically
}

export function readLatest(dir) {
  const snaps = listSnapshots(dir);
  if (snaps.length === 0) return null;
  const file = path.join(dir, snaps[snaps.length - 1]);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * @param {object[]} records merged catalog
 * @param {object} config
 *   outDir:        snapshot directory
 *   keep:          how many snapshots to retain (default 5)
 *   maxDropPct:    refuse publish if active (non-retired) count drops more
 *                  than this percentage vs the last snapshot (default 20)
 *   force:         publish anyway (explicit human override)
 * @param {Date} [now]
 * @returns {{ published: boolean, file?: string, reason?: string, counts: object }}
 */
export function publish(records, config, now = new Date()) {
  const { outDir, keep = 5, maxDropPct = 20, force = false } = config;

  const active = records.filter((r) => !r.retired).length;
  const previous = readLatest(outDir);
  const prevActive = previous
    ? previous.records.filter((r) => !r.retired).length
    : null;

  const counts = { active, previous_active: prevActive, total: records.length };

  if (prevActive !== null && prevActive > 0 && !force) {
    const dropPct = ((prevActive - active) / prevActive) * 100;
    if (dropPct > maxDropPct) {
      return {
        published: false,
        reason:
          `refusing to publish: active record count fell from ${prevActive} to ${active} ` +
          `(${dropPct.toFixed(1)}% drop, limit ${maxDropPct}%). ` +
          `If this drop is real, re-run with --force.`,
        counts,
      };
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  // Two runs inside the same second must not overwrite each other's history.
  let file = path.join(outDir, snapshotName(now));
  for (let seq = 2; fs.existsSync(file); seq++) {
    file = path.join(outDir, snapshotName(now).replace(/\.json$/, `-${seq}.json`));
  }
  const payload = {
    generated_at: now.toISOString(),
    counts,
    records,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));

  // Maintain the stable pointer consumers read.
  fs.writeFileSync(path.join(outDir, "catalog.json"), JSON.stringify(payload, null, 2));

  // Prune old snapshots beyond `keep`.
  const snaps = listSnapshots(outDir);
  const excess = snaps.slice(0, Math.max(0, snaps.length - keep));
  for (const f of excess) fs.unlinkSync(path.join(outDir, f));

  return { published: true, file, counts };
}

/**
 * Restore the previous snapshot as the live catalog.json.
 * The bad snapshot is renamed aside (.rolledback), not deleted — evidence
 * of what went wrong is worth keeping.
 */
export function rollback(outDir) {
  const snaps = listSnapshots(outDir);
  if (snaps.length < 2) {
    return { rolledBack: false, reason: "need at least two snapshots to roll back" };
  }
  const bad = snaps[snaps.length - 1];
  const good = snaps[snaps.length - 2];

  const goodPayload = fs.readFileSync(path.join(outDir, good), "utf8");
  fs.writeFileSync(path.join(outDir, "catalog.json"), goodPayload);
  fs.renameSync(path.join(outDir, bad), path.join(outDir, bad + ".rolledback"));

  return { rolledBack: true, restored: good, setAside: bad + ".rolledback" };
}
