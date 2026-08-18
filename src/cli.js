#!/usr/bin/env node
// feedmerge CLI
//
//   feedmerge run       --config feedmerge.config.js [--force]
//   feedmerge rollback  --config feedmerge.config.js
//   feedmerge validate  --config feedmerge.config.js
//
// The config file is an ES module whose default export describes the sync.
// See feedmerge.config.example.js at the repo root.

import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalize, findFakeUniqueColumns } from "./normalize.js";
import { merge } from "./merge.js";
import { publish, readLatest, rollback } from "./publish.js";

const ADAPTERS = {
  "csv-url": () => import("./adapters/csv-url.js"),
  "json-url": () => import("./adapters/json-url.js"),
};

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, force: false, config: "feedmerge.config.js" };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--force") args.force = true;
    else if (rest[i] === "--config") args.config = rest[++i];
    else throw new Error(`unknown argument: ${rest[i]}`);
  }
  return args;
}

async function loadConfig(file) {
  const abs = path.resolve(process.cwd(), file);
  const mod = await import(pathToFileURL(abs).href);
  const config = mod.default;
  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  const problems = [];
  if (!config || typeof config !== "object") problems.push("config must export a default object");
  else {
    if (!config.source?.adapter) problems.push("source.adapter is required");
    else if (!ADAPTERS[config.source.adapter])
      problems.push(
        `unknown adapter "${config.source.adapter}" (have: ${Object.keys(ADAPTERS).join(", ")})`
      );
    if (!config.key) problems.push("key is required (the stable join field)");
    if (!config.fieldMap || Object.keys(config.fieldMap).length === 0)
      problems.push("fieldMap is required and must not be empty");
    if (config.key && config.fieldMap && !(config.key in config.fieldMap))
      problems.push(`key "${config.key}" must be a target field in fieldMap`);
    if (!Array.isArray(config.feedFields) || config.feedFields.length === 0)
      problems.push("feedFields is required: the fields the feed is authoritative for");
    if (!config.outDir) problems.push("outDir is required");
  }
  if (problems.length > 0) {
    throw new Error("invalid config:\n  - " + problems.join("\n  - "));
  }
  return true;
}

async function cmdRun(config, force) {
  const { fetchRecords } = await ADAPTERS[config.source.adapter]();

  const raw = await fetchRecords(config.source);
  console.log(`fetched ${raw.length} raw record(s)`);

  if (config.suspectUniqueColumns?.length && raw.length > 0) {
    const fakes = findFakeUniqueColumns(raw, config.suspectUniqueColumns);
    for (const f of fakes) {
      console.warn(
        `warning: column "${f.column}" duplicates "${f.duplicates}" on every record — not a real identifier`
      );
    }
  }

  const fresh = normalize(raw, config);
  const previous = readLatest(config.outDir);
  const retained = previous ? previous.records : [];

  const { records, summary } = merge(fresh, retained, config);
  console.log(
    `merge: +${summary.added} added, ~${summary.updated} updated, ` +
      `${summary.revived} revived, ${summary.retired} newly retired, ` +
      `${summary.needs_enrichment} need enrichment`
  );

  const result = publish(records, { ...config, force });
  if (!result.published) {
    console.error(result.reason);
    process.exitCode = 2;
    return;
  }
  console.log(`published ${result.counts.active} active record(s) -> ${result.file}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || ["-h", "--help", "help"].includes(args.command)) {
    console.log("usage: feedmerge <run|rollback|validate> [--config file] [--force]");
    return;
  }

  const config = await loadConfig(args.config);

  if (args.command === "validate") {
    console.log("config ok");
    return;
  }
  if (args.command === "rollback") {
    const r = rollback(config.outDir);
    if (!r.rolledBack) {
      console.error(r.reason);
      process.exitCode = 2;
      return;
    }
    console.log(`rolled back: ${r.restored} is live again, ${r.setAside} set aside`);
    return;
  }
  if (args.command === "run") {
    await cmdRun(config, args.force);
    return;
  }
  throw new Error(`unknown command: ${args.command}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
