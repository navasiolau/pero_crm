import assert from "node:assert/strict";
import { test } from "node:test";

import {
  didSettleAnything,
  settlementConfirmationDisabled,
  settlementPreviewDisclosure,
} from "../src/app/(app)/finance/payroll/settlement-preview";

test("bulk settlement labels cross-currency debt estimates as an upper bound", () => {
  const disclosure = settlementPreviewDisclosure("BYN", "USD");
  assert.match(disclosure, /верхняя граница/i);
  assert.match(disclosure, /USD/);
  assert.match(disclosure, /курс/i);
});

test("empty cash prevents confirming bulk settlement", () => {
  assert.equal(settlementConfirmationDisabled(0, 100, false), true);
  assert.equal(settlementConfirmationDisabled(0, 0, false), true);
  assert.equal(settlementConfirmationDisabled(10, 100, false), false);
  assert.equal(settlementConfirmationDisabled(10, 100, true), true);
});

test("a zero-recipient result is not reported as a successful settlement", () => {
  assert.equal(didSettleAnything({ ok: true, paidCount: 0, totalPaid: 0 }), false);
  assert.equal(didSettleAnything({ ok: true, paidCount: 2, totalPaid: 45 }), true);
  assert.equal(didSettleAnything({ ok: false, paidCount: 2, totalPaid: 45 }), false);
});
