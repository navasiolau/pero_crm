import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCashStageUsdQuote } from "./cash-stage-browser-runner.mjs";

test("staging USD preview must match the saved real quote before the one approved money action", () => {
  const plan = { mode: "USD", fxProof: { rate: "3.025700", date: "2026-09-29" } };
  const outcome = { ok: true, preview: { cashCurrency: "USD", cashAmount: "50.00",
    cashRate: "3.025700", cashRateDate: "2026-09-29", payrollCurrency: "BYN",
    bynAmount: "151.29", amount: "151.29" } };
  assert.deepEqual(assertCashStageUsdQuote(plan, outcome), outcome.preview);
  assert.throws(() => assertCashStageUsdQuote(plan, { ...outcome, preview: { ...outcome.preview,
    cashRate: "3.025800" } }), /CASH_STAGE_USD_PREVIEW_RATE_DRIFT/);
  assert.throws(() => assertCashStageUsdQuote(plan, { ...outcome, preview: { ...outcome.preview,
    cashRateDate: "2026-09-28" } }), /CASH_STAGE_USD_PREVIEW_RATE_DRIFT/);
});
