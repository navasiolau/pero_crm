import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { cashRemainingIntent, cashDirectActionOnce, cashResultRecord,
  recoverRecordedSalaryResult, assertCashUsdRefusalRecorded } from "./cash-local-actions.mjs";

const runId = randomUUID();
const plan = { runId, mode: "USD", users: [{ id: "active" }, { id: "inactive" }],
  accounts: [{ id: "byn" }, { id: "usd" }], requestIds: {
    salary: randomUUID(), usd: randomUUID(), delete: randomUUID() } };

test("remaining cash intents use only reserved people/accounts/request IDs and correct actor/route", () => {
  const salary = cashRemainingIntent(plan, "salary200", "2026-09");
  assert.equal(salary.role, "finance");
  assert.equal(salary.path, "/finance/payroll");
  assert.deepEqual(salary.args, [{ userId: "inactive", cashAccountId: "byn", cashAmount: "200.00",
    expectedCashCurrency: "BYN", requestId: plan.requestIds.salary, month: "2026-09", kind: "SALARY",
    comment: `QA-CASH ${runId} salary` }]);
  assert.equal(cashRemainingIntent(plan, "usd50").args[0].requestId, plan.requestIds.usd);
  assert.equal(cashRemainingIntent(plan, "delete10").args[0].requestId, plan.requestIds.delete);
  assert.throws(() => cashRemainingIntent({ ...plan, mode: "BYN_FALLBACK" }, "usd50"), /USD_CASE_NOT_PLANNED/);
  assert.throws(() => cashRemainingIntent(plan, "foreign"), /REMAINING_ACTION_FORBIDDEN/);
});

test("direct Flight transport submits exact body once, without redirect/retry, and marks uncertain after send failures", async () => {
  const intent = cashRemainingIntent(plan, "usd50");
  let calls = 0;
  const result = await cashDirectActionOnce({ origin: "http://127.0.0.1:3106", intent,
    actionId: "a".repeat(42), cookie: "authjs.session-token=private", transport: (async (_url: URL | RequestInfo, options?: RequestInit) => {
      calls++;
      assert.equal(options?.redirect, "manual");
      assert.deepEqual(JSON.parse(String(options?.body)), intent.args);
      return { status: 200, arrayBuffer: async () => Buffer.from(`0:{"ok":true,"payoutId":"${randomUUID()}","repeated":false}\n`) };
    }) as unknown as typeof fetch });
  assert.equal(calls, 1);
  assert.equal(result.outcome.ok, true);
  await assert.rejects(() => cashDirectActionOnce({ origin: "http://127.0.0.1:3106", intent,
    actionId: "a".repeat(42), cookie: "authjs.session-token=private", transport: (async () => { throw new Error("timeout"); }) as typeof fetch }),
  /ACTION_UPSTREAM_UNCERTAIN/);
  assert.equal(calls, 1);
});

test("durable result keeps typed action status separate from HTTP 200", () => {
  const source = { status: 200, kind: "salary200", outcome: { ok: true, payoutId: "cmumahn9s000cvx88w2tys1zj", repeated: false },
    requestSha256: "a".repeat(64) };
  assert.deepEqual(cashResultRecord(source, true), { kind: "salary200", outcome: source.outcome,
    requestSha256: source.requestSha256, httpStatus: 200, status: "ACTION_RESPONSE_CAPTURED" });
  assert.equal(cashResultRecord(source, false).status, "UNEXPECTED_RESPONSE_CAPTURE_REQUIRED");
});

test("only the pinned already-written salary result can be normalized without changing its file", () => {
  const recorded = { status: 200, kind: "salary200", outcome: { ok: true, payoutId: "cmumahn9s000cvx88w2tys1zj", repeated: false },
    requestSha256: "a".repeat(64) };
  const sha = "1bc257d461ea9180f4866054d54c2c96ab70803098a14de4a25be1dfea56f812";
  const fixed = recoverRecordedSalaryResult(recorded, sha);
  assert.equal(fixed.status, "ACTION_RESPONSE_CAPTURED");
  assert.equal(fixed.httpStatus, 200);
  assert.throws(() => recoverRecordedSalaryResult(recorded, "0".repeat(64)), /RECORDED_SALARY_RESULT_MISMATCH/);
  assert.throws(() => recoverRecordedSalaryResult({ ...recorded, outcome: { ...recorded.outcome, payoutId: "foreign" } }, sha),
    /RECORDED_SALARY_RESULT_MISMATCH/);
});

test("explicit USD FX refusal is read-only evidence only when bound to saved request", () => {
  const intent = { kind: "usd50", payloadSha256: "a".repeat(64) };
  const result = { kind: "usd50", status: "UNEXPECTED_RESPONSE_CAPTURE_REQUIRED", httpStatus: 200,
    requestSha256: intent.payloadSha256, outcome: { ok: false, error: "Не удалось получить корректный курс НБ РБ для выдачи" } };
  assert.equal(assertCashUsdRefusalRecorded(intent, result), true);
  assert.throws(() => assertCashUsdRefusalRecorded(intent, { ...result, outcome: { ok: true } }), /USD_REFUSAL_PROOF_INVALID/);
  assert.throws(() => assertCashUsdRefusalRecorded(intent, { ...result, requestSha256: "b".repeat(64) }),
    /USD_REFUSAL_PROOF_INVALID/);
});
