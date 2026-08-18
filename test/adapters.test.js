import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/adapters/csv-url.js";
import { validateConfig } from "../src/cli.js";

test("parseCsv handles quoted fields, escaped quotes, and CRLF", () => {
  const csv = 'id,title,notes\r\n1,"Grand Design, Imagine","He said ""sold"""\r\n2,Plain,\r\n';
  const recs = parseCsv(csv);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].title, "Grand Design, Imagine");
  assert.equal(recs[0].notes, 'He said "sold"');
  assert.equal(recs[1].notes, "");
});

test("parseCsv pads short rows instead of misaligning columns", () => {
  const recs = parseCsv("a,b,c\n1,2\n");
  assert.deepEqual(recs[0], { a: "1", b: "2", c: "" });
});

test("parseCsv rejects an unterminated quote rather than guessing", () => {
  assert.throws(() => parseCsv('a\n"unclosed\n'), /unterminated/);
});

test("validateConfig names every problem at once", () => {
  try {
    validateConfig({});
    assert.fail("should have thrown");
  } catch (err) {
    assert.match(err.message, /source\.adapter is required/);
    assert.match(err.message, /key is required/);
    assert.match(err.message, /fieldMap is required/);
    assert.match(err.message, /feedFields is required/);
    assert.match(err.message, /outDir is required/);
  }
});

test("validateConfig requires the key to be a mapped target field", () => {
  assert.throws(
    () =>
      validateConfig({
        source: { adapter: "csv-url", url: "https://x" },
        key: "stock_number",
        fieldMap: { title: "Title" },
        feedFields: ["title"],
        outDir: "./data",
      }),
    /must be a target field/
  );
});

test("validateConfig accepts a complete config", () => {
  assert.equal(
    validateConfig({
      source: { adapter: "csv-url", url: "https://x" },
      key: "stock_number",
      fieldMap: { stock_number: "StockNumber", title: "Title" },
      feedFields: ["title"],
      outDir: "./data",
    }),
    true
  );
});
