import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSalaryPayoutRetry, salaryRetryBlockedByLimit } from "../src/app/(app)/advances/cash-payout-operation";

test("salary retry keeps the submitted month and request id despite live month changes", () => {
  const frozen = {
    requestId: "frozen-request-id",
    month: "2026-09",
    payload: {
      userId: "employee-1",
      cashAccountId: "cash-usd",
      cashAmount: "12.50",
      expectedCashCurrency: "USD" as const,
      description: "Работа по заказу",
    },
  };

  assert.deepEqual(buildSalaryPayoutRetry(frozen, "2026-10"), {
    userId: "employee-1",
    cashAccountId: "cash-usd",
    cashAmount: "12.50",
    expectedCashCurrency: "USD",
    requestId: "frozen-request-id",
    month: "2026-09",
    kind: "SALARY",
    comment: "Работа по заказу",
  });
});

test("mutable salary cap cannot block retry of an already submitted request", () => {
  assert.equal(salaryRetryBlockedByLimit(false, true), true);
  assert.equal(salaryRetryBlockedByLimit(true, true), false);
  assert.equal(salaryRetryBlockedByLimit(false, false), false);
});
