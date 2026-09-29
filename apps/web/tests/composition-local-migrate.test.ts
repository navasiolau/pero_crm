import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCompositionMigrationData } from "./composition-local-migrate.mjs";

test("composition migration adds only two empty tables and preserves original raw fingerprints", () => {
  const before = { Product: { count: "1305", hash: "original-products" }, PayrollEntry: { count: "9", hash: "original-pay" } };
  const after = { ...before, ProductCompositionRevision: { count: "0", hash: "empty" }, ProductCompositionItem: { count: "0", hash: "empty" } };
  assert.doesNotThrow(() => assertCompositionMigrationData(before, after));
  assert.throws(() => assertCompositionMigrationData(before, { ...after, Product: { count: "1305", hash: "changed" } }), /LEGACY_DATA_CHANGED/);
  assert.throws(() => assertCompositionMigrationData(before, { ...after, ProductCompositionItem: { count: "1", hash: "backfilled" } }), /NEW_TABLE_NOT_EMPTY/);
  assert.throws(() => assertCompositionMigrationData(before, { ...before }), /NEW_TABLE_NOT_EMPTY/);
  assert.throws(() => assertCompositionMigrationData(before, { ...after, Unknown: { count: "0", hash: "empty" } }), /LEGACY_DATA_CHANGED/);
});
