// feedmerge.config.example.js
//
// Copy to feedmerge.config.js and edit. Every option shown; comments say
// which are required.

export default {
  // REQUIRED — where the fresh roster comes from.
  source: {
    adapter: "csv-url", // "csv-url" | "json-url"
    url: "https://example.com/feed.csv",
    // headers: { "x-api-key": process.env.FEED_KEY },
    // path: "data.items", // json-url only: dot-path when the array isn't the root
  },

  // REQUIRED — the stable identifier records join on across runs.
  key: "stock_number",

  // REQUIRED — raw feed columns -> catalog fields.
  //   target: "SourceColumn"                          rename, text-cleaned
  //   target: { from: "SourceColumn", type: "number" }  + numeric coercion
  //   target: { from: "SourceColumn", transform: (v, raw) => v } custom
  // Unmapped source columns survive under `extra`, never dropped.
  fieldMap: {
    stock_number: "StockNumber",
    title: "Title",
    price: { from: "Price", type: "number" },
    status: "Status",
  },

  // REQUIRED — the fields the FEED is authoritative for. Only these are
  // updated from the feed on an existing record; everything else on the
  // record (hand-collected specs, photos, notes) is retained enrichment
  // the feed can never overwrite.
  feedFields: ["title", "price", "status"],

  // Optional — enrichment fields a complete record must have. Records
  // missing any get needs_enrichment: true so a collection pass can find
  // them cheaply.
  requiredEnrichment: ["length_ft", "sleeps"],

  // Optional — columns that claim to be unique identifiers. If one of them
  // duplicates another column on every record, the run warns loudly instead
  // of trusting it. (Real feeds do this.)
  suspectUniqueColumns: ["vin"],

  // REQUIRED — snapshot directory. catalog.json in here is the stable
  // pointer consumers read.
  outDir: "./data",

  // Optional — snapshot retention and the publish guard.
  keep: 5, // snapshots to keep
  maxDropPct: 20, // refuse publish if active count drops more than this %
};
