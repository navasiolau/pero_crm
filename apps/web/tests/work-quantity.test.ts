import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { remainingWorkQuantity, stepWorkQuantity } from "../src/lib/work-quantity";
import { quantityAtoms } from "../src/lib/work-shares";

test("fractional remaining 10.30 minus 10.00 is an exact 0.30 for the All button", () => {
  const remaining = remainingWorkQuantity("10.30", "10.00");
  assert.equal(remaining, "0.30");
  assert.equal(quantityAtoms(Number(remaining)), BigInt(30));
});

test("editing adds back the task's own decimal quantity without floating residue", () => {
  assert.equal(remainingWorkQuantity("10.30", "10.00", "0.20"), "0.50");
  assert.equal(remainingWorkQuantity("0.30", "0.10", "0.10"), "0.30");
});

test("plus and minus preserve fractional precision and clamp to fractional bounds", () => {
  assert.equal(stepWorkQuantity("2.30", "10.30", -1), "1.30");
  assert.equal(stepWorkQuantity("0.14", "10.30", 1), "1.14");
  assert.equal(stepWorkQuantity("", "0.30", 1), "0.30");
  assert.equal(stepWorkQuantity("1.30", "10.30", -1), "0.30");
});

test("genuine third decimal digits are rejected rather than rounded", () => {
  for (const value of ["0.301", "1.234", "1.0001"]) {
    assert.throws(() => quantityAtoms(value));
    assert.throws(() => stepWorkQuantity(value, "10.30", 1));
  }
});

test("all additive DDL is enclosed in one explicit transaction", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20260928140000_universal_work_shares/migration.sql", import.meta.url), "utf8").replace(/^--.*$/gm, "").trim();
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;$/);
  assert.equal((sql.match(/\bBEGIN;/g) ?? []).length, 1);
  assert.equal((sql.match(/\bCOMMIT;/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /\bCONCURRENTLY\b/);
});
