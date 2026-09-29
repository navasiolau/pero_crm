/** Pure opt-in cash QA guards. Import performs no I/O, DB connection or writes. */
import { createHash } from "node:crypto";

export const CASH_QA_FORMAT = "pero-cash-owned-qa/v1";
export const CASH_QA_MIGRATION = "20260929120000_manager_cash_advances";
export const CASH_QA_TABLES = Object.freeze(["User", "Client", "Project", "Product", "ProductStatusHistory", "ProjectStageHistory",
  "Task", "TaskAllocationGroup", "TaskDependency", "PriceItem", "Work", "TimeEntry", "PayrollEntry", "ProductStagePayPool",
  "WorkPaymentConversion", "ProductStageSettlement", "ProductStageSettlementShare", "Payout", "CashAccount", "ExpenseArticle",
  "Payment", "OrgSetting", "MaterialCategory", "Material", "ProjectMaterial", "StockMovement", "File", "Communication",
  "Notification", "NotificationPreference", "UserPreference", "Plugin", "PluginSetting", "PluginRunLog", "DomainEvent",
  "ApiToken", "ChangeLog", "TelegramLink"]);
const LOCAL_ID = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const STAGE_ID = "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const SAFE_ID = /^[a-z0-9_-]{8,128}$/i;
const OPTIONAL_COMPOSITION = new Set(["ProductCompositionRevision", "ProductCompositionItem"]);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const sorted = (values) => [...values].sort();
const same = (a, b) => canonical(a) === canonical(b);
function bynAt(cents, rateText) {
  const [whole, fraction = ""] = rateText.split(".");
  const micro = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  const result = (BigInt(cents) * micro + 500000n) / 1000000n;
  return `${result / 100n}.${String(result % 100n).padStart(2, "0")}`;
}

export class CashQaStop extends Error {
  constructor(code) { super(code); this.name = "CashQaStop"; this.code = code; }
}
function check(ok, code) { if (!ok) throw new CashQaStop(code); }
export function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") { check(Number.isFinite(value), "INVALID_JSON_NUMBER"); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  check(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype, "INVALID_JSON_OBJECT");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function assertCashQaTarget(target) {
  check(target && typeof target === "object", "TARGET_MISSING");
  const local = target.kind === "EXISTING_LOCAL" && target.containerId === LOCAL_ID && target.host === "127.0.0.1" &&
    target.port === 5433 && target.database === "pero_crm";
  const stage = target.kind === "EXISTING_STAGING" && target.containerId === STAGE_ID && target.guest === "crm-staging" &&
    target.host === "db" && target.port === 5432 && target.database === "crm";
  check(local || stage, "TARGET_FORBIDDEN");
  return target;
}

export function cashQaSchemaTables(optionalCompositionTables = []) {
  check(Array.isArray(optionalCompositionTables) && new Set(optionalCompositionTables).size === optionalCompositionTables.length &&
    optionalCompositionTables.every((name) => typeof name === "string" && OPTIONAL_COMPOSITION.has(name) && !CASH_QA_TABLES.includes(name)),
  "COMPOSITION_TABLES_NOT_REVIEWED");
  return sorted([...CASH_QA_TABLES, ...optionalCompositionTables]);
}

function assertSnapshot(snapshot, plan) {
  check(snapshot && typeof snapshot === "object" && same(sorted(snapshot.schemaTables ?? []), plan.schema.tables) &&
    snapshot.schemaHash === plan.schema.hash && same(sorted(Object.keys(snapshot.rows ?? {})), plan.schema.tables), "SCHEMA_CHANGED");
  for (const table of plan.schema.tables) {
    check(Array.isArray(snapshot.rows[table]), "SNAPSHOT_INVALID");
    for (const raw of snapshot.rows[table]) check(typeof raw === "string" && raw.startsWith("{") && raw.endsWith("}"), "RAW_JSON_REQUIRED");
  }
  const settings = snapshot.rows.OrgSetting.map((raw) => JSON.parse(raw)).filter((row) => row.key === "payrollCurrency");
  check(settings.length <= 1 && (settings.length === 0 || settings[0].value === "BYN"), "PAYROLL_CURRENCY_NOT_BYN");
  return snapshot;
}

function rowId(table, row) {
  if (table === "OrgSetting") return row.key;
  if (table === "TaskDependency") return `${row.taskId}|${row.dependsOnId}`;
  if (table === "NotificationPreference") return `${row.userId}|${row.type}`;
  if (table === "UserPreference") return `${row.userId}|${row.key}`;
  if (table === "PluginSetting") return `${row.pluginId}|${row.key}`;
  return row.id;
}

/** Fingerprints exact to_jsonb(t)::text, preserving numeric precision and every field. */
export function cashRawFingerprints(snapshot, tables, excluded = {}) {
  check(same(sorted(Object.keys(snapshot.rows ?? {})), sorted(tables)), "SNAPSHOT_INVALID");
  return Object.fromEntries(tables.map((table) => {
    const blocked = new Set(excluded[table] ?? []);
    const raws = snapshot.rows[table].filter((raw) => {
      check(typeof raw === "string", "RAW_JSON_REQUIRED");
      const row = JSON.parse(raw);
      check(row && typeof row === "object" && !Array.isArray(row), "RAW_JSON_REQUIRED");
      return !blocked.has(rowId(table, row));
    }).sort();
    return [table, sha(raws.join("\n") + "\n")];
  }));
}

function plannedIds(plan) {
  return { User: plan.users.map((u) => u.id), Project: [plan.project.id], CashAccount: plan.accounts.map((a) => a.id),
    Payment: plan.payments.map((p) => p.id), PayrollEntry: [plan.accrual.id] };
}

export function validateCashQaPlan(plan) {
  check(plan?.format === CASH_QA_FORMAT && UUID.test(plan.runId ?? ""), "PLAN_INVALID");
  assertCashQaTarget(plan.target);
  check(Array.isArray(plan.users) && Array.isArray(plan.accounts) && Array.isArray(plan.payments) && plan.project && plan.accrual &&
    plan.requestIds && plan.schema, "PLAN_INVALID");
  const tables = cashQaSchemaTables(plan.schema?.optionalCompositionTables);
  check(same(plan.schema?.tables, tables) && HASH.test(plan.schema?.hash ?? "") &&
    plan.migration === CASH_QA_MIGRATION && HASH.test(plan.sqlSha256 ?? "") &&
    same(sorted(Object.keys(plan.baseline ?? {})), tables) && Object.values(plan.baseline).every((v) => HASH.test(v)), "SCHEMA_OR_BASELINE_INVALID");
  const ids = [plan.project?.id, ...plan.users.map((u) => u.id), ...plan.accounts.map((a) => a.id),
    ...plan.payments.map((p) => p.id), plan.accrual?.id, ...Object.values(plan.requestIds ?? {})];
  check(ids.length === 12 && ids.every((id) => UUID.test(id ?? "")) && new Set(ids).size === ids.length, "OWNED_IDS_INVALID");
  check(plan.actors?.managerId && plan.actors?.financeId && plan.project.clientId &&
    !ids.includes(plan.actors.managerId) && !ids.includes(plan.actors.financeId) && !ids.includes(plan.project.clientId), "EXISTING_ACTORS_REQUIRED");
  check(Array.isArray(plan.actors.financeRecipientIds) &&
    new Set(plan.actors.financeRecipientIds).size === plan.actors.financeRecipientIds.length &&
    plan.actors.financeRecipientIds.every((id) => typeof id === "string" && id.length > 0 && !ids.includes(id)),
  "FINANCE_RECIPIENTS_INVALID");
  check(plan.mode === "USD" || plan.mode === "BYN_FALLBACK", "FX_MODE_INVALID");
  check(plan.project.currency === "BYN" && plan.project.stage === "LEAD" &&
    Number.isInteger(plan.project.numberInt) && plan.project.numberInt < 0 && plan.project.numberInt >= -2147483648 &&
    plan.project.managerId === plan.actors.managerId && plan.project.number.includes(plan.runId) && plan.project.title.includes(plan.runId) &&
    plan.users.length === 2 && plan.users.every((u) => u.payScheme === "NONE" && u.name.includes(plan.runId) &&
      u.email.includes(plan.runId) && u.email.endsWith("@qa.invalid") && typeof u.passwordHash === "string" &&
      u.passwordHash.startsWith("$argon2") && sha(u.passwordHash) === u.passwordDigest && same(u.roles, ["WORKER"])) &&
    plan.users[0].active === true && plan.users[1].active === false, "QA_IDENTITY_INVALID");
  check(plan.accounts.length === 2 && same(plan.accounts.map((a) => a.currency), ["BYN", "USD"]) &&
    plan.accounts.every((a) => a.name.includes(plan.runId) && a.active === true), "QA_CASH_INVALID");
  check(plan.payments.length === 2 && plan.payments.every((p) => p.projectId === plan.project.id && p.direction === "INCOME" &&
    p.amount === "1000.00" && p.comment.includes(plan.runId) && p.createdById === plan.actors.financeId &&
    p.projectAmount === p.bynAmount) && plan.payments[0].currency === "BYN" &&
    plan.payments[0].cashAccountId === plan.accounts[0].id && plan.payments[0].rate === "1.000000" &&
    plan.payments[0].bynAmount === "1000.00" &&
    plan.payments[1].currency === (plan.mode === "USD" ? "USD" : "BYN") &&
    plan.payments[1].cashAccountId === plan.accounts[plan.mode === "USD" ? 1 : 0].id &&
    (plan.mode !== "BYN_FALLBACK" || (plan.payments[1].rate === "1.000000" && plan.payments[1].bynAmount === "1000.00")) &&
    (plan.mode !== "USD" || (plan.fxProof?.source === "NBRB" && HASH.test(plan.fxProof.rawSha256 ?? "") &&
      /^\d+(?:\.\d{1,6})?$/.test(plan.fxProof.rate ?? "") && Number(plan.fxProof.rate) > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(plan.fxProof.date ?? "") &&
      plan.payments[1].rate === plan.fxProof.rate && plan.payments[1].rateDate === plan.fxProof.date &&
      plan.payments[1].bynAmount === bynAt(100000, plan.fxProof.rate))), "QA_FUNDING_INVALID");
  const month = new Date().toISOString().slice(0, 7);
  check(plan.accrual.userId === plan.users[1].id && plan.accrual.amount === "500.00" && plan.accrual.currency === "BYN" &&
    plan.accrual.month < month && plan.accrual.scheme === "PIECE" && plan.accrual.taskId === null &&
    plan.accrual.productId === null && plan.accrual.settlementShareId === null && plan.accrual.comment.includes(plan.runId), "QA_ACCRUAL_INVALID");
  check(same(sorted(Object.keys(plan.requestIds)), ["advance", "delete", "salary", "usd"]), "REQUEST_IDS_INVALID");
  return plan;
}

export function cashPlanSha256(plan) { validateCashQaPlan(plan); return sha(canonical(plan) + "\n"); }
export function cashCaptureSha256(capture) { return sha(canonical(capture) + "\n"); }
export function assertBulkQaDebtors(actualIds, plan) {
  validateCashQaPlan(plan);
  check(Array.isArray(actualIds) && same(sorted(actualIds), [plan.users[1].id]) && new Set(actualIds).size === actualIds.length,
    "BULK_FOREIGN_DEBTOR_DI_ONLY");
  return true;
}

function rows(snapshot, table) { return snapshot.rows[table].map((raw) => JSON.parse(raw)); }
function byId(snapshot, table, id) { return rows(snapshot, table).find((row) => rowId(table, row) === id); }
function assertFixture(snapshot, plan) {
  for (const user of plan.users) {
    const row = byId(snapshot, "User", user.id);
    check(row && row.email === user.email && row.name === user.name && row.active === user.active && row.payScheme === "NONE" &&
      same(row.roles, ["WORKER"]) &&
      sha(row.passwordHash ?? "") === user.passwordDigest, "QA_USER_CHANGED");
  }
  const project = byId(snapshot, "Project", plan.project.id);
  check(project && project.clientId === plan.project.clientId && project.currency === "BYN" &&
    project.number === plan.project.number && project.numberInt === plan.project.numberInt &&
    project.managerId === plan.actors.managerId && project.title === plan.project.title, "QA_PROJECT_CHANGED");
  for (const account of plan.accounts) {
    const row = byId(snapshot, "CashAccount", account.id);
    check(row && row.name === account.name && row.currency === account.currency && row.active === true, "QA_CASH_CHANGED");
  }
  for (const payment of plan.payments) {
    const row = byId(snapshot, "Payment", payment.id);
    check(row && row.projectId === plan.project.id && row.cashAccountId === payment.cashAccountId &&
      row.currency === payment.currency && row.direction === "INCOME" && Number(row.amount) === 1000 &&
      Number(row.rate) === Number(payment.rate) && Number(row.bynAmount) === Number(payment.bynAmount) &&
      Number(row.projectAmount) === Number(payment.projectAmount), "QA_PAYMENT_CHANGED");
  }
  const accrual = byId(snapshot, "PayrollEntry", plan.accrual.id);
  check(accrual && accrual.userId === plan.users[1].id && Number(accrual.amount) === 500 && accrual.currency === "BYN" &&
    accrual.month === plan.accrual.month && accrual.scheme === "PIECE" && accrual.taskId === null &&
    accrual.productId === null && accrual.settlementShareId === null, "QA_ACCRUAL_CHANGED");
}

function assertEffects(snapshot, plan, observed, payoutIds) {
  const effects = observed.effectIds ?? {};
  for (const table of ["DomainEvent", "Notification", "ChangeLog"]) {
    check(Array.isArray(effects[table] ?? []) && new Set(effects[table] ?? []).size === (effects[table] ?? []).length &&
      (effects[table] ?? []).every((id) => SAFE_ID.test(id)), "EFFECT_IDS_INVALID");
  }
  const users = new Set([...plan.users.map((u) => u.id), ...(plan.actors.financeRecipientIds ?? [])]);
  for (const id of effects.DomainEvent ?? []) {
    const row = byId(snapshot, "DomainEvent", id);
    check(row?.type === "payroll.payout" && payoutIds.has(row.payload?.payoutId) &&
      [plan.actors.managerId, plan.actors.financeId].includes(row.actor), "FOREIGN_EVENT_REJECTED");
  }
  check((effects.DomainEvent ?? []).length === payoutIds.size &&
    new Set((effects.DomainEvent ?? []).map((id) => byId(snapshot, "DomainEvent", id)?.payload?.payoutId)).size === payoutIds.size,
  "PAYOUT_EVENT_COUNT_INVALID");
  for (const id of effects.Notification ?? []) {
    const row = byId(snapshot, "Notification", id);
    check(row && users.has(row.userId) && ["payroll.payout", "payroll.orgPayout"].includes(row.type) &&
      ["/payroll", "/finance/payroll"].includes(row.link) && typeof row.body === "string" &&
      row.body.includes("QA-CASH") && row.body.includes(plan.runId), "FOREIGN_NOTIFICATION_REJECTED");
  }
  for (const id of effects.ChangeLog ?? []) {
    const row = byId(snapshot, "ChangeLog", id);
    check(row?.entity === "payout" && row.action === "delete" && payoutIds.has(row.entityId) &&
      row.actorId === plan.actors.financeId, "FOREIGN_LOG_REJECTED");
  }
}

function functionalState(snapshot, plan, owned, phase, observed) {
  if (phase === "ABSENT") return { bynCash: "0.00", usdCash: "0.00", inactiveDue: "0.00", orgDeltaByn: "0.00" };
  const payments = rows(snapshot, "Payment").filter((row) => plan.payments.some((p) => p.id === row.id));
  const payouts = rows(snapshot, "Payout").filter((row) => (owned.Payout ?? []).includes(row.id));
  const accruals = rows(snapshot, "PayrollEntry").filter((row) => plan.users.some((u) => u.id === row.userId));
  check(accruals.length === 1 && accruals[0].id === plan.accrual.id, "ADVANCE_CREATED_ACCRUAL");
  const sum = (list, field) => list.reduce((total, row) => total + Number(row[field] ?? 0), 0);
  const cash = (id) => (sum(payments.filter((row) => row.cashAccountId === id), "amount") -
    sum(payouts.filter((row) => row.cashAccountId === id), "cashAmount")).toFixed(2);
  const result = { bynCash: cash(plan.accounts[0].id), usdCash: cash(plan.accounts[1].id),
    inactiveDue: (500 - sum(payouts.filter((row) => row.userId === plan.users[1].id), "amount")).toFixed(2),
    orgDeltaByn: (sum(payments, "bynAmount") - sum(payouts, "bynAmount")).toFixed(2) };
  check(Number(result.bynCash) >= 0 && Number(result.usdCash) >= 0, "QA_CASH_NEGATIVE");
  if (phase === "INITIAL") check(result.bynCash === (plan.mode === "USD" ? "1000.00" : "2000.00") &&
    result.usdCash === (plan.mode === "USD" ? "1000.00" : "0.00") && result.inactiveDue === "500.00", "INITIAL_FUNCTIONAL_MISMATCH");
  if (phase === "FINAL") {
    check(result.bynCash === (plan.mode === "USD" ? "680.00" : "1680.00") &&
      result.usdCash === (plan.mode === "USD" ? "950.00" : "0.00") && result.inactiveDue === "300.00", "FINAL_FUNCTIONAL_MISMATCH");
    check(same(observed.functional, result), "FINAL_READONLY_BALANCE_PROOF_REQUIRED");
  }
  return result;
}

function ownedGraphHash(snapshot, owned) {
  const parts = Object.entries(owned).flatMap(([table, ids]) => {
    const selected = new Set(ids);
    return snapshot.rows[table].filter((raw) => selected.has(rowId(table, JSON.parse(raw)))).map((raw) => `${table}\t${raw}`);
  });
  return sha(sorted(parts).join("\n") + "\n");
}

/** No name/time adoption: issue receipts come only from the plan's UUIDs and captured action result IDs. */
/** @param {{outcomes?: {requestId: string, payoutId: string, deleted: boolean}[],
 *   effectIds?: {DomainEvent?: string[], Notification?: string[], ChangeLog?: string[]},
 *   duplicateReplay?: boolean, functional?: {bynCash: string, usdCash: string, inactiveDue: string, orgDeltaByn: string}}} observed */
export function inspectCashCapture(snapshot, plan, observed = { outcomes: [], effectIds: {} }, phase = "PARTIAL") {
  validateCashQaPlan(plan);
  assertSnapshot(snapshot, plan);
  check(["ABSENT", "INITIAL", "PARTIAL", "FINAL"].includes(phase), "PHASE_INVALID");
  const allRequests = new Set(Object.values(plan.requestIds));
  const outcomes = observed.outcomes ?? [];
  check(Array.isArray(outcomes) && outcomes.length <= 4 && new Set(outcomes.map((o) => o.requestId)).size === outcomes.length &&
    outcomes.every((o) => allRequests.has(o.requestId) && SAFE_ID.test(o.payoutId ?? "") && typeof o.deleted === "boolean"),
  "OUTCOMES_INVALID");
  const excluded = plannedIds(plan);
  const payoutIds = new Set(outcomes.map((o) => o.payoutId));
  if (phase === "ABSENT") check(outcomes.length === 0 && Object.entries(excluded).every(([table, ids]) => ids.every((id) => !byId(snapshot, table, id))), "OWNED_ROWS_ALREADY_PRESENT");
  else assertFixture(snapshot, plan);
  for (const outcome of outcomes) {
    const receiptId = `payout-issue:${outcome.requestId}`;
    const receipt = byId(snapshot, "ChangeLog", receiptId);
    const salaryRequest = outcome.requestId === plan.requestIds.salary;
    const expectedActor = salaryRequest ? plan.actors.financeId : plan.actors.managerId;
    const expectedKind = salaryRequest ? "SALARY" : "ADVANCE";
    const expectedUser = salaryRequest ? plan.users[1].id : plan.users[0].id;
    check(receipt?.entity === "payout" && receipt.action === "issue" && receipt.entityId === outcome.payoutId &&
      receipt.actorId === expectedActor && receipt.newValue?.payoutId === outcome.payoutId &&
      receipt.newValue?.userId === expectedUser && receipt.newValue?.kind === expectedKind,
    "RECEIPT_MEMBERSHIP_INVALID");
    const payout = byId(snapshot, "Payout", outcome.payoutId);
    check(outcome.deleted ? !payout : payout && payout.userId === receipt.newValue.userId &&
      plan.accounts.some((a) => a.id === payout.cashAccountId) && ["ADVANCE", "SALARY"].includes(payout.kind),
    "PAYOUT_MEMBERSHIP_INVALID");
    if (outcome.deleted) check((observed.effectIds?.ChangeLog ?? []).some((id) => {
      const row = byId(snapshot, "ChangeLog", id);
      return row?.entity === "payout" && row.action === "delete" && row.entityId === outcome.payoutId;
    }), "DELETE_RECEIPT_MISSING");
  }
  assertEffects(snapshot, plan, observed, payoutIds);
  if (phase === "INITIAL") check(outcomes.length === 0, "INITIAL_HAS_PAYOUT");
  if (phase === "FINAL") {
    const needed = [plan.requestIds.advance, plan.requestIds.salary, plan.requestIds.delete,
      ...(plan.mode === "USD" ? [plan.requestIds.usd] : [])];
    check(same(sorted(outcomes.map((o) => o.requestId)), sorted(needed)) &&
      outcomes.find((o) => o.requestId === plan.requestIds.delete)?.deleted === true &&
      observed.duplicateReplay === true, "FINAL_SCENARIO_INCOMPLETE");
    check((observed.effectIds?.ChangeLog ?? []).length === 1, "DELETE_LOG_COUNT_INVALID");
    const notificationPairs = [];
    for (const outcome of outcomes) {
      const receipt = byId(snapshot, "ChangeLog", `payout-issue:${outcome.requestId}`);
      const payee = plan.users.find((u) => u.id === receipt.newValue.userId);
      if (payee.active) notificationPairs.push(`payroll.payout|${payee.id}`);
      for (const userId of plan.actors.financeRecipientIds.filter((id) => id !== receipt.actorId)) {
        notificationPairs.push(`payroll.orgPayout|${userId}`);
      }
    }
    const observedPairs = (observed.effectIds?.Notification ?? []).map((id) => {
      const row = byId(snapshot, "Notification", id);
      return `${row.type}|${row.userId}`;
    });
    check(same(sorted(observedPairs), sorted(notificationPairs)), "NOTIFICATION_COUNT_OR_RECIPIENT_MISMATCH");
    const expected = new Map([[plan.requestIds.advance, ["ADVANCE", "120", plan.users[0].id, "BYN"]],
      [plan.requestIds.salary, ["SALARY", "200", plan.users[1].id, "BYN"]],
      [plan.requestIds.usd, ["ADVANCE", "50", plan.users[0].id, "USD"]]]);
    for (const outcome of outcomes.filter((o) => !o.deleted)) {
      const row = byId(snapshot, "Payout", outcome.payoutId);
      const [kind, cash, userId, currency] = expected.get(outcome.requestId) ?? [];
      check(row?.kind === kind && Number(row.cashAmount) === Number(cash) && row.userId === userId && row.cashCurrency === currency &&
        (currency !== "BYN" || Number(row.amount) === Number(cash)) && row.payrollCurrency === "BYN", "FINAL_PAYOUT_AMOUNT_INVALID");
      if (currency === "USD") {
        check(Number(row.cashRate) === Number(plan.fxProof.rate) && String(row.cashRateDate).slice(0, 10) === plan.fxProof.date &&
          Number(row.bynAmount) === Number(bynAt(5000, plan.fxProof.rate)) && Number(row.amount) === Number(row.bynAmount),
        "USD_SNAPSHOT_INVALID");
      }
    }
  }
  if (phase !== "ABSENT") {
    excluded.Payout = outcomes.filter((o) => !o.deleted).map((o) => o.payoutId);
    excluded.ChangeLog = [...outcomes.map((o) => `payout-issue:${o.requestId}`), ...(observed.effectIds?.ChangeLog ?? [])];
    excluded.DomainEvent = observed.effectIds?.DomainEvent ?? [];
    excluded.Notification = observed.effectIds?.Notification ?? [];
  }
  check(same(cashRawFingerprints(snapshot, plan.schema.tables, excluded), plan.baseline), "FOREIGN_FINGERPRINT_DRIFT");
  const functional = functionalState(snapshot, plan, excluded, phase, observed);
  return { phase, owned: excluded, graphHash: ownedGraphHash(snapshot, excluded), functional };
}

export async function baselineCashQa(adapter, target, schemaTables, schemaHash) {
  assertCashQaTarget(target);
  check(typeof adapter?.readOnly === "function" && HASH.test(schemaHash ?? ""), "READONLY_ADAPTER_REQUIRED");
  const expected = cashQaSchemaTables(schemaTables.filter((name) => !CASH_QA_TABLES.includes(name)));
  check(same(sorted(schemaTables), expected), "SCHEMA_CHANGED");
  return adapter.readOnly(async (tx) => {
    const snapshot = await tx.snapshot(expected);
    const plan = { schema: { tables: expected, hash: schemaHash } };
    assertSnapshot(snapshot, plan);
    return cashRawFingerprints(snapshot, expected);
  });
}

export async function prepareCashQa({ adapter, plan, durablePlanSha256 }) {
  validateCashQaPlan(plan);
  check(durablePlanSha256 === cashPlanSha256(plan), "DURABLE_PLAN_PROOF_REQUIRED");
  check(typeof adapter?.transaction === "function", "TRANSACTION_ADAPTER_REQUIRED");
  return adapter.transaction(async (tx) => {
    const before = await tx.snapshot(plan.schema.tables);
    inspectCashCapture(before, plan, { outcomes: [], effectIds: {} }, "ABSENT");
    await tx.insertExactFixture(plan);
    return inspectCashCapture(await tx.snapshot(plan.schema.tables), plan, { outcomes: [], effectIds: {} }, "INITIAL");
  });
}

export async function captureCashQa({ adapter, plan, observed, phase }) {
  validateCashQaPlan(plan);
  check(typeof adapter?.readOnly === "function", "READONLY_ADAPTER_REQUIRED");
  return adapter.readOnly(async (tx) => inspectCashCapture(await tx.snapshot(plan.schema.tables), plan, observed, phase));
}

export async function cleanupCashQa({ adapter, plan, observed, captured, durableCaptureSha256, actionsDrained }) {
  validateCashQaPlan(plan);
  check(actionsDrained === true, "ACTIONS_NOT_DRAINED");
  check(captured && durableCaptureSha256 === cashCaptureSha256(captured), "DURABLE_CAPTURE_PROOF_REQUIRED");
  check(typeof adapter?.transaction === "function", "TRANSACTION_ADAPTER_REQUIRED");
  return adapter.transaction(async (tx) => {
    const state = inspectCashCapture(await tx.snapshot(plan.schema.tables), plan, observed, captured.phase);
    check(same(state.owned, captured.owned) && state.graphHash === captured.graphHash &&
      same(state.functional, captured.functional), "CAPTURE_DRIFT");
    const order = ["Notification", "ChangeLog", "DomainEvent", "Payout", "PayrollEntry", "Payment", "CashAccount", "Project", "User"];
    for (const table of order) {
      const ids = state.owned[table] ?? [];
      if (ids.length) check(await tx.deleteExact(table, ids) === ids.length, "EXACT_DELETE_COUNT_MISMATCH");
    }
    const after = await tx.snapshot(plan.schema.tables);
    inspectCashCapture(after, plan, { outcomes: [], effectIds: {} }, "ABSENT");
    return { phase: "CLEANED", deleted: Object.fromEntries(order.map((table) => [table, state.owned[table]?.length ?? 0])) };
  });
}
