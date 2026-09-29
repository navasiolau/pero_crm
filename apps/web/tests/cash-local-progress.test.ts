import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { assertCashDeleteOwnership, cashRemainingPredecessor, deriveCashProgress } from "./cash-local-progress.mjs";

const runId = randomUUID(), salaryRequest = randomUUID(), deleteRequest = randomUUID();
const plan = { runId, mode: "BYN_FALLBACK", users: [{ id: "active" }, { id: "inactive" }],
  accounts: [{ id: "byn" }, { id: "usd" }],
  actors: { managerId: "manager", financeId: "finance", financeRecipientIds: ["finance", "director"] },
  requestIds: { salary: salaryRequest, delete: deleteRequest } };
const prior = { outcomes: [{ requestId: randomUUID(), payoutId: randomUUID(), deleted: false }],
  effectIds: { DomainEvent: ["old-event"], Notification: ["old-personal"], ChangeLog: [] }, duplicateReplay: true };

test("remaining sequence is fixed and USD skipped only in approved fallback", () => {
  assert.equal(cashRemainingPredecessor(plan, "salary200"), "advance");
  assert.equal(cashRemainingPredecessor(plan, "delete10"), "salary200");
  assert.equal(cashRemainingPredecessor({ ...plan, mode: "USD" }, "delete10"), "usd50");
  assert.equal(cashRemainingPredecessor({ ...plan, mode: "USD" }, "delete10", true), "salary200");
  assert.equal(cashRemainingPredecessor(plan, "replay10"), "remove10");
  assert.throws(() => cashRemainingPredecessor(plan, "usd50"), /REMAINING_ACTION_FORBIDDEN/);
});

test("salary effects bind fixed receipt, event and finance recipients, rejecting foreign notification", () => {
  const payoutId = randomUUID();
  const snapshot = { rows: {
    ChangeLog: [JSON.stringify({ id: `payout-issue:${salaryRequest}`, entity: "payout", action: "issue",
      entityId: payoutId, actorId: "finance", newValue: { payoutId, userId: "inactive", kind: "SALARY" } })],
    DomainEvent: [JSON.stringify({ id: "salary-event", type: "payroll.payout", actor: "finance", payload: { payoutId } })],
    Notification: [JSON.stringify({ id: "director-notice", type: "payroll.orgPayout", userId: "director",
      body: `QA-CASH ${runId} salary` })], Payout: [JSON.stringify({ id: payoutId, userId: "inactive", kind: "SALARY",
        cashAccountId: "byn", cashCurrency: "BYN", cashAmount: "200.00", payrollCurrency: "BYN" })],
  } };
  const actionResult = { kind: "salary200", outcome: { ok: true, payoutId, repeated: false } };
  const result = deriveCashProgress(snapshot, plan, prior, "salary200", actionResult);
  assert.equal(result.outcomes.at(-1)?.payoutId, payoutId);
  assert.deepEqual(result.effectIds.Notification, ["old-personal", "director-notice"]);
  const foreign = structuredClone(snapshot);
  foreign.rows.Notification[0] = JSON.stringify({ id: "director-notice", type: "payroll.orgPayout",
    userId: "director", body: "Unrelated salary notification" });
  assert.throws(() => deriveCashProgress(foreign, plan, prior, "salary200", actionResult), /PAYOUT_NOTIFICATION_MISMATCH/);
});

test("delete is proven by one finance audit and deleted-request replay must refuse without new payout", () => {
  const payoutId = randomUUID();
  const afterIssue = { outcomes: [...prior.outcomes, { requestId: deleteRequest, payoutId, deleted: false }],
    effectIds: { ...prior.effectIds, ChangeLog: [] }, duplicateReplay: true };
  const removed = { rows: { Payout: [], ChangeLog: [JSON.stringify({ id: "delete-audit", entity: "payout",
    action: "delete", entityId: payoutId, actorId: "finance" })] } };
  const deleted = deriveCashProgress(removed, plan, afterIssue, "remove10", { kind: "remove10", outcome: { ok: true } });
  assert.equal(deleted.outcomes.at(-1)?.deleted, true);
  assert.deepEqual(deleted.effectIds.ChangeLog, ["delete-audit"]);
  assert.equal(deriveCashProgress(removed, plan, deleted, "replay10",
    { kind: "replay10", outcome: { ok: false, error: "Операция отменена" } }).duplicateReplay, true);
  assert.throws(() => deriveCashProgress(removed, plan, deleted, "replay10",
    { kind: "replay10", outcome: { ok: true, payoutId: randomUUID() } }), /DELETED_REPLAY_NOT_REFUSED/);
  const lingering: { rows: { Payout: string[]; ChangeLog: string[] } } = structuredClone(removed);
  lingering.rows.Payout = [JSON.stringify({ id: payoutId })];
  assert.throws(() => deriveCashProgress(lingering, plan, afterIssue, "remove10",
    { kind: "remove10", outcome: { ok: true } }), /DELETE_PAYOUT_STILL_PRESENT/);
});

test("delete target must be exact reserved 10 BYN payout, not merely a safe-looking ID", () => {
  const payoutId = randomUUID();
  const proof = { outcomes: [{ requestId: deleteRequest, payoutId, deleted: false }] };
  const state = { rows: { Payout: [JSON.stringify({ id: payoutId, userId: "active", kind: "ADVANCE",
    cashAccountId: "byn", cashCurrency: "BYN", cashAmount: "10.00" })],
  ChangeLog: [JSON.stringify({ id: `payout-issue:${deleteRequest}`, entityId: payoutId, actorId: "manager",
    newValue: { userId: "active", kind: "ADVANCE" } })] } };
  const boundPlan = { ...plan, accounts: [{ id: "byn" }] };
  assert.equal(assertCashDeleteOwnership(state, boundPlan, proof), payoutId);
  const foreign = structuredClone(state);
  foreign.rows.Payout[0] = JSON.stringify({ id: payoutId, userId: "active", kind: "ADVANCE",
    cashAccountId: "foreign-cash", cashCurrency: "BYN", cashAmount: "10.00" });
  assert.throws(() => assertCashDeleteOwnership(foreign, boundPlan, proof), /DELETE_OWNERSHIP_MISMATCH/);
});
