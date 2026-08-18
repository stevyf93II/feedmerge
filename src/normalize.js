// normalize.js — turn raw adapter records into typed, trustworthy records.
//
// Every rule in here exists because a real feed violated the assumption it
// protects. Vendor feeds lie in quiet ways: doubled whitespace, columns that
// claim to be identifiers but aren't, numbers wrapped in currency formatting,
// empties that should be nulls. Normalization is where those lies stop.

/**
 * Collapse runs of internal whitespace to a single space and trim.
 * Some feeds double every internal space in every text field. Nothing
 * downstream should ever see that.
 */
export function cleanText(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Coerce a money-ish or dimension-ish string to a number.
 * "$45,995.00" -> 45995, "35' 6\"" stays a string (ambiguous), "" -> null.
 * Never coerces empty to 0 — a missing price is not a free unit.
 */
export function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (s === "") return null;
  const cleaned = s.replace(/[$,]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** Empty string, whitespace-only, and common null spellings become null. */
export function toNullable(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  const s = value.trim();
  if (s === "" || /^(null|n\/a|none|-)$/i.test(s)) return null;
  return s;
}

/**
 * Detect a column that claims to be unique but merely duplicates another
 * column. Real example: a feed whose "vin" column contained the stock number
 * again. Trusting it as an identifier would have corrupted every join.
 *
 * Returns the list of suspect column names.
 */
export function findFakeUniqueColumns(records, candidateColumns) {
  const suspects = [];
  if (records.length === 0) return suspects;
  for (const col of candidateColumns) {
    for (const other of Object.keys(records[0])) {
      if (other === col) continue;
      const allSame = records.every(
        (r) => r[col] !== undefined && r[col] !== null && r[col] === r[other]
      );
      if (allSame) {
        suspects.push({ column: col, duplicates: other });
        break;
      }
    }
  }
  return suspects;
}

/**
 * Apply a field map to one raw record.
 *
 * fieldMap: {
 *   targetField: "source_column"                      — rename
 *   targetField: { from: "col", type: "number" }      — rename + coerce
 *   targetField: { from: "col", transform: (v) => v } — custom
 * }
 *
 * Unmapped source columns are preserved under `extra` rather than dropped:
 * throwing away data you didn't understand yet is how you end up re-fetching.
 */
export function applyFieldMap(raw, fieldMap) {
  const out = {};
  const used = new Set();

  for (const [target, spec] of Object.entries(fieldMap)) {
    const from = typeof spec === "string" ? spec : spec.from;
    used.add(from);
    let value = raw[from];

    value = cleanText(value);

    if (typeof spec === "object") {
      if (spec.type === "number") value = toNumber(value);
      else if (spec.type === "nullable") value = toNullable(value);
      if (typeof spec.transform === "function") value = spec.transform(value, raw);
    } else {
      value = toNullable(value);
    }

    out[target] = value === undefined ? null : value;
  }

  const extra = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!used.has(k)) extra[k] = cleanText(v);
  }
  if (Object.keys(extra).length > 0) out.extra = extra;

  return out;
}

/**
 * Normalize a full batch. Throws if the configured key field is missing or
 * empty on any record — a record you cannot address is a record you cannot
 * merge, and silently dropping it hides feed damage.
 */
export function normalize(rawRecords, config) {
  const { fieldMap, key } = config;
  const records = rawRecords.map((r) => applyFieldMap(r, fieldMap));

  const keyless = records.filter((r) => r[key] === null || r[key] === undefined || r[key] === "");
  if (keyless.length > 0) {
    throw new Error(
      `normalize: ${keyless.length} record(s) missing key field "${key}" — refusing to continue`
    );
  }

  const seen = new Map();
  for (const r of records) {
    const k = r[key];
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  if (dupes.length > 0) {
    throw new Error(
      `normalize: duplicate key values in feed for "${key}": ` +
        dupes.map(([k, n]) => `${k} (x${n})`).join(", ")
    );
  }

  return records;
}
