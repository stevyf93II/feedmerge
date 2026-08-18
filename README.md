# feedmerge

[![CI](https://github.com/stevyf93II/feedmerge/actions/workflows/ci.yml/badge.svg)](https://github.com/stevyf93II/feedmerge/actions/workflows/ci.yml)

Sync a vendor data feed into a clean, versioned JSON catalog without letting a fast feed wipe slow, hand-built enrichment.

Zero runtime dependencies. Node 18+.

## The problem

You consume a data feed you do not control: an inventory roster, a product list, a listings export. The feed is authoritative for what exists right now and what it costs. But your catalog also holds things the feed knows nothing about: specifications collected by hand, photos, descriptions, measurements taken with a tape measure. That enrichment is slow and expensive to produce.

A naive sync (`catalog = feed`) destroys all of it on the first run. A naive "merge" that copies every feed field over every catalog field destroys it more politely. And a feed that fails in a quiet way, returning an empty or truncated roster while reporting success, will happily empty your catalog for you.

feedmerge is the sync discipline that came out of running exactly this kind of pipeline in production. Two incidents shaped its design:

1. **The zero-record publish.** A scheduled sync once committed an empty catalog to production because the upstream returned no records to datacenter IPs while looking perfectly healthy. Recovery meant digging the last good file out of an old git SHA by hand. That is why the publish stage refuses a sharp drop in record count until a human passes `--force`, and why every publish is a versioned snapshot.
2. **The fake unique column.** A feed shipped a column named like a globally unique identifier that actually contained a copy of another column. Trusting it as a join key would have corrupted every merge. That is why the pipeline can be told which columns are merely *claimed* to be unique, and warns loudly when one of them duplicates another column on every record.

Smaller scars are encoded in the normalize stage: feeds that double every internal space in every text value, prices formatted as currency strings, empty strings where nulls should be, and empty prices that must never become `0`.

## Design

Four stages, each with one job:

```
adapter  ->  normalize  ->  merge  ->  publish
(fetch)      (coerce,      (join      (versioned
             distrust)     without    snapshot,
                           damage)    guarded)
```

**Adapter** fetches the raw roster. Two are built in: `csv-url` (with a small, strict RFC 4180 parser — a machine-generated CSV it rejects is a CSV worth rejecting) and `json-url` (with a dot-path for arrays that are not at the response root).

**Normalize** maps raw columns to catalog fields, cleans text, coerces numbers, converts empties to nulls, and refuses records with missing or duplicate keys — a record you cannot address is a record you cannot merge.

**Merge** is the core rule of the tool:

> A field the feed does not carry is never overwritten.

The feed is authoritative only for the fields you list in `feedFields`, and even for those, a null from the feed never clobbers a retained value. Records the feed stops carrying are **retired, never deleted** — an empty feed run retires everything and deletes nothing, so the catalog survives an upstream outage intact. Records missing required enrichment are flagged `needs_enrichment: true` so a collection pass can find them cheaply.

**Publish** writes a timestamped snapshot plus a stable `catalog.json` pointer, refuses to publish when the active record count drops more than `maxDropPct` (default 20%) unless forced, prunes snapshots beyond `keep`, and can roll back — setting the bad snapshot aside as evidence rather than deleting it.

## Quickstart

```sh
git clone https://github.com/stevyf93II/feedmerge.git
cd feedmerge
npm test                                      # 28 tests, no dependencies
node examples/public-data/run-example.js      # the whole story, offline
```

The example walks three days of a feed: a first sync, a hand-enrichment between syncs, a price change that does not touch the enrichment, a vanished record that is retired rather than deleted, and an empty-feed day that the publish guard refuses to publish.

To run against a real feed:

```sh
cp feedmerge.config.example.js feedmerge.config.js
# edit feedmerge.config.js
node src/cli.js validate
node src/cli.js run
```

## Configuration

Everything lives in one config module (see `feedmerge.config.example.js` for the commented version):

| Option | Required | Meaning |
| --- | --- | --- |
| `source.adapter` | yes | `csv-url` or `json-url` |
| `source.url` | yes | feed URL |
| `source.headers` | no | auth headers, e.g. from environment |
| `source.path` | no | json-url only: dot-path to the array |
| `key` | yes | stable join field across runs |
| `fieldMap` | yes | raw columns to catalog fields, with optional `type: "number"` or a `transform` function; unmapped columns survive under `extra` |
| `feedFields` | yes | the only fields the feed may update on existing records |
| `requiredEnrichment` | no | fields a complete record must have; missing ones set `needs_enrichment` |
| `suspectUniqueColumns` | no | columns to check for the fake-unique pathology |
| `outDir` | yes | snapshot directory; `catalog.json` here is the stable pointer |
| `keep` | no | snapshots to retain (default 5) |
| `maxDropPct` | no | publish guard threshold (default 20) |

CLI: `feedmerge run [--force]`, `feedmerge rollback`, `feedmerge validate`, all taking `--config <file>`. `run` exits 2 when the guard refuses, so schedulers see a real failure.

## Deployment

The intended deployment is `.github/workflows/sync.example.yml`: a GitHub Actions cron that runs the sync and commits the catalog back to the repo. No server, no database. Consumers fetch `data/catalog.json` raw from GitHub or from whatever site the repo deploys. Because every published state is a git commit, recovery from a bad publish is `git revert`, not archaeology — and because the guard exits nonzero, a broken feed never reaches the commit step at all.

## Non-goals

- Not a general ETL framework. One feed in, one catalog out.
- Not a scraper. Adapters consume feeds that already exist (CSV or JSON over HTTP). Writing a site-specific adapter is your job; the interface is one async function returning an array of records.
- Not a database. The catalog is a JSON file by design — small enough to version, diff, and revert.
- No conflict resolution UI. When the feed and the enrichment genuinely disagree, the feed wins for `feedFields` and the enrichment wins for everything else. That rule is the product.

## License

MIT
