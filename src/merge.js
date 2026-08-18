// merge.js — reconcile a fresh feed snapshot with the retained catalog.
//
// The single most important rule in this codebase:
//
//   A FIELD THE FEED DOES NOT CARRY IS NEVER OVERWRITTEN.
//
// The feed is fast and authoritative for the fields it actually contains
// (roster, price, status). The retained catalog holds slow, expensive
// enrichment (specifications collected by hand, photos, descriptions) that
// the feed knows nothing about. A naive "replace the catalog with the feed"
// sync destroys weeks of enrichment in one run. This module exists so that
// can never happen.

/**
 * @param {object[]} freshRecords   normalized records from this run's feed
 * @param {object[]} retainedRecords the previous catalog (may be [])
 * @param {object} config
 *   key:            join field, e.g. "stock_number"
 *   feedFields:     fields the feed is authoritative for. Only these are
 *                   taken from the fresh record on an update.
 *   requiredEnrichment: fields that must be present and non-null for a
 *                   record to be considered fully enriched. Missing any
 *                   sets needs_enrichment: true.
 * @param {Date} [now] injectable clock for tests
 * @returns {{ records: object[], summary: object }}
 */
export function merge(freshRecords, retainedRecords, config, now = new Date()) {
  const { key, feedFields, requiredEnrichment = [] } = config;
  const ts = now.toISOString();

  const retainedByKey = new Map(retainedRecords.map((r) => [r[key], r]));
  const freshKeys = new Set(freshRecords.map((r) => r[key]));

  const out = [];
  const summary = { added: 0, updated: 0, retired: 0, revived: 0, unchanged_retired: 0, needs_enrichment: 0 };

  for (const fresh of freshRecords) {
    const existing = retainedByKey.get(fresh[key]);

    if (!existing) {
      // New record: take it whole, stamp it.
      const rec = { ...fresh, first_seen: ts, last_seen: ts, retired: false };
      out.push(rec);
      summary.added++;
      continue;
    }

    // Update: start from the RETAINED record so enrichment survives, then
    // apply only the fields the feed is authoritative for — and even then,
    // never null out a retained value with a feed omission.
    const rec = { ...existing };
    for (const f of feedFields) {
      const v = fresh[f];
      if (v !== undefined && v !== null) {
        rec[f] = v;
      }
      // v === null/undefined: feed omitted it this run. Retained value stands.
    }
    if (existing.retired) {
      rec.retired = false;
      delete rec.retired_at;
      summary.revived++;
    } else {
      summary.updated++;
    }
    rec.last_seen = ts;
    out.push(rec);
  }

  // Records the feed no longer carries: RETIRE, never delete. A feed that
  // returns empty (outage, IP block, auth failure) must not be able to
  // silently empty the catalog. Deletion is a human decision.
  for (const retained of retainedRecords) {
    if (freshKeys.has(retained[key])) continue;
    if (retained.retired) {
      out.push(retained);
      summary.unchanged_retired++;
    } else {
      out.push({ ...retained, retired: true, retired_at: ts });
      summary.retired++;
    }
  }

  // Flag records missing required enrichment so a collection pass can find
  // them without diffing the whole catalog.
  for (const rec of out) {
    const missing = requiredEnrichment.filter(
      (f) => rec[f] === undefined || rec[f] === null
    );
    rec.needs_enrichment = missing.length > 0;
    if (rec.needs_enrichment && !rec.retired) summary.needs_enrichment++;
  }

  return { records: out, summary };
}
