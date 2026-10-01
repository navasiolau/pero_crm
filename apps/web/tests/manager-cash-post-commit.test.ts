import assert from "node:assert/strict";
import { test } from "node:test";
import { deliverCashPayout } from "../src/server/payroll/cash-post-commit";

test("post-commit cache failures never turn a persisted payout into an error response", async () => {
  const calls: string[] = [];
  await deliverCashPayout({ repeated: false, payoutId: "payout", amount: "120.00", cashAmount: "120.00",
    currency: "BYN", payrollCurrency: "BYN", userId: "employee", userName: "Employee", month: "2026-09", eventId: "event" },
  { kind: "ADVANCE", description: "Сборка шкафа" }, "manager", {
    dispatchEvent: async () => { calls.push("event"); },
    notifyPerson: async () => { calls.push("person"); },
    notifyOrg: async () => { calls.push("org"); },
    revalidatePath: () => { calls.push("cache"); throw new Error("cache unavailable"); },
  });
  assert.deepEqual(calls.slice(0, 3), ["event", "person", "org"]);
  assert.equal(calls.filter((call) => call === "cache").length, 4);
});

test("replayed payout creates no post-commit effects", async () => {
  let effects = 0;
  const increment = async () => { effects += 1; };
  await deliverCashPayout({ repeated: true, payoutId: "payout", amount: "120.00", cashAmount: "120.00",
    currency: "BYN", payrollCurrency: "BYN", userId: "employee", month: "2026-09", eventId: null },
  { kind: "ADVANCE", description: "Сборка шкафа" }, "manager", {
    dispatchEvent: increment, notifyPerson: increment, notifyOrg: increment, revalidatePath: () => { effects += 1; },
  });
  assert.equal(effects, 0);
});
