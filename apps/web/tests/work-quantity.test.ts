import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { remainingWorkQuantity, stepWorkQuantity } from "../src/lib/work-quantity";
import { quantityAtoms, allocatedWorkQuantity, taskPieceAmount } from "../src/lib/work-shares";
import { taskPaymentLabel } from "../src/lib/task-payment-display";

// Источник: work-quantity.test.ts
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

test('historical grouped budget counts quantity once and preserves fixed40+60',()=>{
 const rows=[{quantity:'10',allocationGroupId:'old',shareAmount:'40',executorShare:'0.4'},{quantity:'10',allocationGroupId:'old',shareAmount:'60',executorShare:'0.6'}];
 assert.equal(allocatedWorkQuantity(rows),'10.00');
 assert.deepEqual(rows.map(row=>taskPieceAmount(row,'10')),['40.00','60.00']);
 assert.equal(taskPieceAmount({quantity:'4',executorShare:'0.5',shareAmount:null},'10'),'20.00');
});

test("ordinary quantity distribution 4+6 of10 keeps full per-task pay and no remaining excess",()=>{
 const tasks=[{quantity:"4.00",executorShare:"1.000"},{quantity:"6.00",executorShare:"1.000"}];
 assert.equal(allocatedWorkQuantity(tasks),"10.00");assert.equal(remainingWorkQuantity("10.00",allocatedWorkQuantity(tasks)),"0.00");
 assert.deepEqual(tasks.map(task=>taskPieceAmount(task,"10.00")),["40.00","60.00"]);
});

test("task rewards use canonical zero and frozen DTO amounts without old-share or engineering-preview fallback",()=>{
 assert.match(taskPaymentLabel({workId:"work",rewardAmount:"0.00",rewardCurrency:"BYN",rewardSource:"WORK_SNAPSHOT",shareAmount:"999",shareCurrency:"USD"}),/0.*BYN/);
 assert.match(taskPaymentLabel({workId:"work",rewardAmount:"17.89",rewardCurrency:"BYN",rewardSource:"FROZEN_TASK_SNAPSHOT",previewAmount:"999",previewCurrency:"USD"}),/17,89.*BYN/);
 assert.equal(taskPaymentLabel({workId:"work",rewardAmount:null,rewardCurrency:null,rewardSource:"UNAVAILABLE",paymentKind:"ENGINEERING",previewAmount:"999",previewCurrency:"BYN",shareAmount:"888",shareCurrency:"BYN"}),"—");
});
