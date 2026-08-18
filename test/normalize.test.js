import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanText,
  toNumber,
  toNullable,
  findFakeUniqueColumns,
  applyFieldMap,
  normalize,
} from "../src/normalize.js";

test("cleanText collapses doubled internal whitespace — a real feed does this to every value", () => {
  assert.equal(cleanText("2026  Grand  Design  Imagine"), "2026 Grand Design Imagine");
  assert.equal(cleanText("  padded  "), "padded");
  assert.equal(cleanText(42), 42, "non-strings pass through");
});

test("toNumber handles currency formatting and never turns empty into 0", () => {
  assert.equal(toNumber("$45,995.00"), 45995);
  assert.equal(toNumber("45995"), 45995);
  assert.equal(toNumber(""), null, "a missing price is not a free unit");
  assert.equal(toNumber("call for price"), null);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(120), 120);
});

test("toNullable maps empty and null-spellings to null", () => {
  assert.equal(toNullable(""), null);
  assert.equal(toNullable("  "), null);
  assert.equal(toNullable("N/A"), null);
  assert.equal(toNullable("none"), null);
  assert.equal(toNullable("-"), null);
  assert.equal(toNullable("real value"), "real value");
});

test("findFakeUniqueColumns catches an id column that duplicates another — the fake-VIN case", () => {
  const records = [
    { stock_number: "123", vin: "123", title: "A" },
    { stock_number: "456", vin: "456", title: "B" },
  ];
  const fakes = findFakeUniqueColumns(records, ["vin"]);
  assert.equal(fakes.length, 1);
  assert.equal(fakes[0].column, "vin");
  assert.equal(fakes[0].duplicates, "stock_number");
});

test("findFakeUniqueColumns stays quiet when the column is genuinely distinct", () => {
  const records = [
    { stock_number: "123", vin: "1GBJC34J8MJ103282", title: "A" },
    { stock_number: "456", vin: "2FTRX18W1XCA01234", title: "B" },
  ];
  assert.equal(findFakeUniqueColumns(records, ["vin"]).length, 0);
});

test("applyFieldMap preserves unmapped columns under extra instead of dropping them", () => {
  const raw = { StockNumber: "A1", Price: "$100", Mystery: "keep  me" };
  const out = applyFieldMap(raw, {
    stock_number: "StockNumber",
    price: { from: "Price", type: "number" },
  });
  assert.equal(out.stock_number, "A1");
  assert.equal(out.price, 100);
  assert.deepEqual(out.extra, { Mystery: "keep me" });
});

test("normalize refuses records with a missing key rather than silently dropping them", () => {
  const raw = [{ StockNumber: "A1" }, { StockNumber: "" }];
  assert.throws(
    () => normalize(raw, { key: "stock_number", fieldMap: { stock_number: "StockNumber" } }),
    /missing key field/
  );
});

test("normalize refuses duplicate keys — an ambiguous join corrupts the catalog", () => {
  const raw = [{ StockNumber: "A1" }, { StockNumber: "A1" }];
  assert.throws(
    () => normalize(raw, { key: "stock_number", fieldMap: { stock_number: "StockNumber" } }),
    /duplicate key/
  );
});
