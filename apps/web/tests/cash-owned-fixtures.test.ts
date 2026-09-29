import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  CASH_QA_FORMAT, CASH_QA_MIGRATION, assertBulkQaDebtors, assertCashQaTarget, baselineCashQa,
  cashCaptureSha256, cashPlanSha256, cashQaSchemaTables, cashRawFingerprints, captureCashQa, cleanupCashQa,
  inspectCashCapture, prepareCashQa, validateCashQaPlan,
} from "./cash-owned-fixtures.mjs";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const local = { kind: "EXISTING_LOCAL", containerId: "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5",
  host: "127.0.0.1", port: 5433, database: "pero_crm" };
const stage = { kind: "EXISTING_STAGING", containerId: "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a",
  guest: "crm-staging", host: "db", port: 5432, database: "crm" };
const raw = (row: object) => JSON.stringify(row);

function fixture() {
  const runId = randomUUID();
  const tables = cashQaSchemaTables();
  const empty = { schemaTables: tables, schemaHash: "a".repeat(64), rows: Object.fromEntries(tables.map((table) => [table, [] as string[]])) };
  const hash = "$argon2id$unit-test-only";
  const users = [true, false].map((active, index) => ({ id: randomUUID(), email: `${runId}-${index}@qa.invalid`,
    name: `QA-CASH ${runId} ${index}`, active, roles: ["WORKER"], payScheme: "NONE", passwordHash: hash, passwordDigest: sha(hash) }));
  const accounts = ["BYN", "USD"].map((currency) => ({ id: randomUUID(), name: `QA-CASH ${runId} ${currency}`, currency, active: true }));
  const project = { id: randomUUID(), number: `QA-CASH-${runId}`, numberInt: -1, title: `QA-CASH ${runId}`,
    clientId: "existing-client", managerId: "existing-manager", stage: "LEAD", currency: "BYN" };
  const payments = [0, 1].map((index) => ({ id: randomUUID(), projectId: project.id, cashAccountId: accounts[0].id,
    direction: "INCOME", amount: "1000.00", currency: "BYN", rate: "1.000000", bynAmount: "1000.00",
    projectAmount: "1000.00", rateDate: null, createdById: "existing-finance", comment: `QA-CASH ${runId} funding ${index}` }));
  const previous = new Date(); previous.setUTCMonth(previous.getUTCMonth() - 1);
  const accrual = { id: randomUUID(), userId: users[1].id, amount: "500.00", currency: "BYN", scheme: "PIECE",
    month: previous.toISOString().slice(0, 7), taskId: null, productId: null, settlementShareId: null,
    comment: `QA-CASH ${runId} prior accrual` };
  const plan = { format: CASH_QA_FORMAT, runId, target: local, schema: { tables, hash: empty.schemaHash, optionalCompositionTables: [] },
    migration: CASH_QA_MIGRATION, sqlSha256: "bfa8d8a59b67ec027e67602a824a71eb98e473b57aad35e181eeaa1f852870dd",
    baseline: cashRawFingerprints(empty, tables), mode: "BYN_FALLBACK", project, users, accounts, payments, accrual,
    actors: { managerId: "existing-manager", financeId: "existing-finance", financeRecipientIds: ["existing-finance"] },
    requestIds: { advance: randomUUID(), salary: randomUUID(), usd: randomUUID(), delete: randomUUID() } };
  const initial = structuredClone(empty);
  initial.rows.User = users.map((user) => raw(user));
  initial.rows.Project = [raw(project)];
  initial.rows.CashAccount = accounts.map((account) => raw(account));
  initial.rows.Payment = payments.map((payment) => raw({ ...payment, amount: 1000, bynAmount: 1000, projectAmount: 1000 }));
  initial.rows.PayrollEntry = [raw({ ...accrual, amount: 500 })];
  return { plan, empty, initial };
}

test("target and schema guards reject production, altered identity and unknown tables", () => {
  assert.deepEqual(assertCashQaTarget(local), local);
  assert.deepEqual(assertCashQaTarget(stage), stage);
  assert.throws(() => assertCashQaTarget({ ...local, database: "production" }), /TARGET_FORBIDDEN/);
  assert.throws(() => assertCashQaTarget({ ...stage, containerId: local.containerId }), /TARGET_FORBIDDEN/);
  assert.throws(() => assertCashQaTarget({ kind: "PRODUCTION", host: "db" }), /TARGET_FORBIDDEN/);
  assert.ok(cashQaSchemaTables(["ProductCompositionRevision", "ProductCompositionItem"]).includes("ProductCompositionRevision"));
  assert.throws(() => cashQaSchemaTables(["CompositionAnything"]), /COMPOSITION_TABLES_NOT_REVIEWED/);
  assert.throws(() => cashQaSchemaTables(["CompositionModule"]), /COMPOSITION_TABLES_NOT_REVIEWED/);
  assert.throws(() => cashQaSchemaTables(["UnknownPayments"]), /COMPOSITION_TABLES_NOT_REVIEWED/);
  const { plan, initial } = fixture();
  assert.equal(validateCashQaPlan(plan), plan);
  initial.schemaTables.push("UnknownPayments");
  assert.throws(() => inspectCashCapture(initial, plan, { outcomes: [], effectIds: {} }, "INITIAL"), /SCHEMA_CHANGED/);
});

test("raw business fingerprints preserve numeric text exactly and stop foreign drift", () => {
  const { plan, initial } = fixture();
  assert.equal(inspectCashCapture(initial, plan, { outcomes: [], effectIds: {} }, "INITIAL").phase, "INITIAL");
  const first = structuredClone(initial), second = structuredClone(initial);
  first.rows.Client = ['{"id":"business","amount":100000000000000001.00}'];
  second.rows.Client = ['{"id":"business","amount":100000000000000002.00}'];
  assert.notEqual(cashRawFingerprints(first, plan.schema.tables).Client, cashRawFingerprints(second, plan.schema.tables).Client);
  assert.throws(() => inspectCashCapture(first, plan, { outcomes: [], effectIds: {} }, "INITIAL"), /FOREIGN_FINGERPRINT_DRIFT/);
});

test("only attested staging fingerprint projection omits ApiToken.lastUsedAt, never business fields", () => {
  const tables = cashQaSchemaTables();
  const rows = Object.fromEntries(tables.map((table) => [table, [] as string[]]));
  rows.ApiToken = [JSON.stringify({ id: "token-owned-by-real-user", tokenHash: "hash-a", scopes: ["read"],
    ownerId: "real-user", lastUsedAt: "2026-09-29T00:00:00.000Z" })];
  const stageSnapshot = { schemaTables: tables, rows, fingerprintTargetKind: "EXISTING_STAGING" };
  const first = cashRawFingerprints(stageSnapshot, tables);
  const later = structuredClone(stageSnapshot);
  later.rows.ApiToken[0] = JSON.stringify({ ...JSON.parse(later.rows.ApiToken[0]), lastUsedAt: "2026-09-29T01:00:00.000Z" });
  assert.equal(cashRawFingerprints(later, tables).ApiToken, first.ApiToken);
  assert.notEqual(cashRawFingerprints({ ...stageSnapshot, fingerprintTargetKind: "EXISTING_LOCAL" }, tables).ApiToken,
    cashRawFingerprints({ ...later, fingerprintTargetKind: "EXISTING_LOCAL" }, tables).ApiToken);
  for (const changed of [{ scopes: ["write"] }, { tokenHash: "hash-b" }, { ownerId: "other-user" },
    { id: "different-token-id" }]) {
    later.rows.ApiToken[0] = JSON.stringify({ ...JSON.parse(rows.ApiToken[0]), lastUsedAt: "2026-09-29T01:00:00.000Z",
      ...changed });
    assert.notEqual(cashRawFingerprints(later, tables).ApiToken, first.ApiToken);
  }
  later.rows.ApiToken = rows.ApiToken;
  later.rows.Plugin = [JSON.stringify({ id: "demo", updatedAt: "later" })];
  assert.notEqual(cashRawFingerprints(later, tables).Plugin, first.Plugin);
});

test("plan binds exact QA identities, fallback funding and prior-month accrual", () => {
  const { plan } = fixture();
  assert.match(cashPlanSha256(plan), /^[0-9a-f]{64}$/);
  assert.throws(() => validateCashQaPlan({ ...plan, users: plan.users.map((user) => ({ ...user, id: plan.project.id })) }), /OWNED_IDS_INVALID/);
  assert.throws(() => validateCashQaPlan({ ...plan, accrual: { ...plan.accrual, settlementShareId: "settled" } }), /QA_ACCRUAL_INVALID/);
  assert.throws(() => validateCashQaPlan({ ...plan, payments: plan.payments.map((payment, index) => index ? { ...payment, currency: "USD", rate: "1.000000" } : payment) }), /QA_FUNDING_INVALID/);
  assert.equal(assertBulkQaDebtors([plan.users[1].id], plan), true);
  assert.throws(() => assertBulkQaDebtors([plan.users[1].id, "real-employee"], plan), /BULK_FOREIGN_DEBTOR_DI_ONLY/);
});

test("deleted payout remains owned only through known request UUID receipt and exact deletion log", () => {
  const { plan, initial } = fixture();
  const snapshot = structuredClone(initial);
  const payoutId = "payoutowned123";
  const eventId = "eventowned123";
  const deleteLogId = "deletelog123";
  snapshot.rows.ChangeLog = [raw({ id: `payout-issue:${plan.requestIds.delete}`, entity: "payout", entityId: payoutId,
    action: "issue", actorId: plan.actors.managerId, newValue: { payoutId, userId: plan.users[0].id, kind: "ADVANCE" } }),
  raw({ id: deleteLogId, entity: "payout", entityId: payoutId, action: "delete", actorId: plan.actors.financeId })];
  snapshot.rows.DomainEvent = [raw({ id: eventId, type: "payroll.payout", actor: plan.actors.managerId, payload: { payoutId } })];
  const observed = { outcomes: [{ requestId: plan.requestIds.delete, payoutId, deleted: true }],
    effectIds: { DomainEvent: [eventId], ChangeLog: [deleteLogId], Notification: [] } };
  assert.equal(inspectCashCapture(snapshot, plan, observed, "PARTIAL").phase, "PARTIAL");
  assert.throws(() => inspectCashCapture(snapshot, plan, { ...observed, effectIds: { ...observed.effectIds, ChangeLog: [] } }, "PARTIAL"), /DELETE_RECEIPT_MISSING/);
  assert.throws(() => inspectCashCapture(snapshot, plan, { ...observed, outcomes: [{ ...observed.outcomes[0], requestId: randomUUID() }] }, "PARTIAL"), /OUTCOMES_INVALID/);
});

test("final fallback capture proves amounts, one accrual, exact receipts/events and notification recipients", () => {
  const { plan, initial } = fixture();
  const snapshot = structuredClone(initial);
  const defs = [
    { requestId: plan.requestIds.advance, payoutId: "payoutadvance01", userId: plan.users[0].id, actorId: plan.actors.managerId,
      kind: "ADVANCE", cashAmount: 120, deleted: false },
    { requestId: plan.requestIds.salary, payoutId: "payoutsalary01", userId: plan.users[1].id, actorId: plan.actors.financeId,
      kind: "SALARY", cashAmount: 200, deleted: false },
    { requestId: plan.requestIds.delete, payoutId: "payoutdelete01", userId: plan.users[0].id, actorId: plan.actors.managerId,
      kind: "ADVANCE", cashAmount: 10, deleted: true },
  ];
  snapshot.rows.Payout = defs.filter((row) => !row.deleted).map((row) => raw({ id: row.payoutId, userId: row.userId,
    kind: row.kind, cashAmount: row.cashAmount, amount: row.cashAmount, bynAmount: row.cashAmount,
    cashCurrency: "BYN", payrollCurrency: "BYN", cashAccountId: plan.accounts[0].id }));
  snapshot.rows.ChangeLog = defs.map((row) => raw({ id: `payout-issue:${row.requestId}`, entity: "payout",
    entityId: row.payoutId, action: "issue", actorId: row.actorId, newValue: { payoutId: row.payoutId, userId: row.userId, kind: row.kind } }));
  snapshot.rows.ChangeLog.push(raw({ id: "deletelog01", entity: "payout", entityId: defs[2].payoutId,
    action: "delete", actorId: plan.actors.financeId }));
  snapshot.rows.DomainEvent = defs.map((row, index) => raw({ id: `eventowned0${index}`, type: "payroll.payout",
    actor: row.actorId, payload: { payoutId: row.payoutId } }));
  snapshot.rows.Notification = [
    raw({ id: "notifyactive01", type: "payroll.payout", userId: plan.users[0].id, link: "/payroll", body: `QA-CASH ${plan.runId} advance` }),
    raw({ id: "notifyactive02", type: "payroll.payout", userId: plan.users[0].id, link: "/payroll", body: `QA-CASH ${plan.runId} delete` }),
    raw({ id: "notifyorg001", type: "payroll.orgPayout", userId: plan.actors.financeId, link: "/finance/payroll", body: `QA-CASH ${plan.runId} advance` }),
    raw({ id: "notifyorg002", type: "payroll.orgPayout", userId: plan.actors.financeId, link: "/finance/payroll", body: `QA-CASH ${plan.runId} delete` }),
  ];
  const observed = { outcomes: defs.map(({ requestId, payoutId, deleted }) => ({ requestId, payoutId, deleted })),
    effectIds: { ChangeLog: ["deletelog01"], DomainEvent: ["eventowned00", "eventowned01", "eventowned02"],
      Notification: ["notifyactive01", "notifyactive02", "notifyorg001", "notifyorg002"] }, duplicateReplay: true,
    functional: { bynCash: "1680.00", usdCash: "0.00", inactiveDue: "300.00", orgDeltaByn: "1680.00" } };
  const result = inspectCashCapture(snapshot, plan, observed, "FINAL");
  assert.equal(result.phase, "FINAL");
  assert.deepEqual(result.functional, observed.functional);
  const changed = structuredClone(snapshot);
  changed.rows.Notification.pop();
  assert.throws(() => inspectCashCapture(changed, plan, observed, "FINAL"), /FOREIGN_NOTIFICATION_REJECTED|NOTIFICATION_COUNT_OR_RECIPIENT_MISMATCH/);
  const unrelated = structuredClone(snapshot);
  unrelated.rows.Notification[0] = raw({ ...JSON.parse(unrelated.rows.Notification[0]), body: "Unrelated salary" });
  assert.throws(() => inspectCashCapture(unrelated, plan, observed, "FINAL"), /FOREIGN_NOTIFICATION_REJECTED/);
  assert.throws(() => inspectCashCapture(snapshot, plan, { ...observed, duplicateReplay: false }, "FINAL"), /FINAL_SCENARIO_INCOMPLETE/);
});

test("prepare and cleanup require durable receipts before any adapter access", async () => {
  const { plan } = fixture();
  const untouched = new Proxy({}, { get: () => { throw new Error("ADAPTER_TOUCHED"); } });
  await assert.rejects(prepareCashQa({ adapter: untouched, plan, durablePlanSha256: "" }), /DURABLE_PLAN_PROOF_REQUIRED/);
  await assert.rejects(cleanupCashQa({ adapter: untouched, plan, observed: { outcomes: [], effectIds: {} }, captured: {},
    durableCaptureSha256: "", actionsDrained: false }), /ACTIONS_NOT_DRAINED/);
});

test("adapter lifecycle prepares only the eight planned rows, captures read-only, then exact-cleans", async () => {
  const { plan, empty, initial } = fixture();
  let state = structuredClone(empty);
  const tx = { snapshot: async () => structuredClone(state), insertExactFixture: async () => { state = structuredClone(initial); },
    deleteExact: async (table: string, ids: string[]) => {
      const before = state.rows[table].length;
      state.rows[table] = state.rows[table].filter((rawRow: string) => !ids.includes(JSON.parse(rawRow).id));
      return before - state.rows[table].length;
    } };
  const adapter = { readOnly: async (fn: (arg: typeof tx) => Promise<unknown>) => fn(tx),
    transaction: async (fn: (arg: typeof tx) => Promise<unknown>) => fn(tx) };
  assert.deepEqual(await baselineCashQa(adapter, local, plan.schema.tables, plan.schema.hash), plan.baseline);
  const prepared = await prepareCashQa({ adapter, plan, durablePlanSha256: cashPlanSha256(plan) });
  assert.equal(prepared.phase, "INITIAL");
  const captured = await captureCashQa({ adapter, plan, observed: { outcomes: [], effectIds: {} }, phase: "INITIAL" });
  assert.equal(captured.graphHash, prepared.graphHash);
  const changed = structuredClone(state);
  changed.rows.CashAccount[0] = raw({ ...JSON.parse(changed.rows.CashAccount[0]), comment: "changed" });
  assert.notEqual(inspectCashCapture(changed, plan, { outcomes: [], effectIds: {} }, "INITIAL").graphHash, captured.graphHash);
  const cleaned = await cleanupCashQa({ adapter, plan, observed: { outcomes: [], effectIds: {} }, captured,
    durableCaptureSha256: cashCaptureSha256(captured), actionsDrained: true });
  assert.equal(cleaned.phase, "CLEANED");
  assert.equal(cleaned.deleted.User, 2);
  assert.equal(cleaned.deleted.Payment, 2);
});
