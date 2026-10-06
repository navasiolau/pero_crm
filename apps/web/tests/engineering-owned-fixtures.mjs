/** Opt-in QA helpers. Importing this module performs no I/O and creates no client. */
import { createHash } from "node:crypto";
import { canonical, SNAPSHOT_TABLES } from "./work-shares-owned-fixtures.mjs";

const FORMAT = "pero-engineering-owned-qa/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const STAGING = "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a";
export const ENGINEERING_TABLES = Object.freeze([...SNAPSHOT_TABLES, "ProductStagePayPool", "WorkPaymentConversion", "ProductStageSettlement", "ProductStageSettlementShare"]);
export const ENGINEERING_TRIGGERS = Object.freeze([
  ["WorkPaymentConversion", "WorkPaymentConversion_append_only"],
  ["ProductStageSettlement", "ProductStageSettlement_append_only"],
  ["ProductStageSettlementShare", "ProductStageSettlementShare_append_only"],
  ["PayrollEntry", "PayrollEntry_product_settlement_append_only"],
]);
const OWNED = Object.freeze(["Notification", "UserPreference", "ChangeLog", "DomainEvent", "ProductStatusHistory", "ProjectStageHistory", "PayrollEntry",
  "ProductStageSettlementShare", "ProductStageSettlement", "WorkPaymentConversion", "TimeEntry", "TaskDependency", "TaskAllocationGroup", "Task",
  "Work", "ProductStagePayPool", "Product", "Project", "User"]);
const DEL = Object.freeze(["Notification", "UserPreference", "ChangeLog", "DomainEvent", "PayrollEntry", "ProductStageSettlementShare",
  "ProductStageSettlement", "WorkPaymentConversion", "TimeEntry", "TaskDependency", "ProductStatusHistory", "ProjectStageHistory",
  "Task", "TaskAllocationGroup", "Work", "ProductStagePayPool", "Product", "Project", "User"]);
const LOCK_ALL_WRITES = `LOCK TABLE ${ENGINEERING_TABLES.map((table) => `"${table}"`).join(",")} IN SHARE ROW EXCLUSIVE MODE`;
const LOCK_HISTORY = `LOCK TABLE ${ENGINEERING_TRIGGERS.map(([table]) => `"${table}"`).join(",")} IN ACCESS EXCLUSIVE MODE`;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const sorted = (values) => [...values].sort();
const same = (a, b) => canonical(a) === canonical(b);

/** PostgreSQL timestamp without time zone is stored as UTC by Prisma but jsonb omits Z. */
export function engineeringTimestampInstant(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = "", zone = "Z"] = match;
  const components = [year, month, day, hour, minute, second].map(Number);
  const local = new Date(Date.UTC(components[0], components[1] - 1, components[2], components[3], components[4], components[5]));
  if (local.getUTCFullYear() !== components[0] || local.getUTCMonth() + 1 !== components[1] || local.getUTCDate() !== components[2] ||
    local.getUTCHours() !== components[3] || local.getUTCMinutes() !== components[4] || local.getUTCSeconds() !== components[5]) return null;
  if (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return null;
  const base = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`);
  return Number.isFinite(base) ? BigInt(base) * 1000n + BigInt(fraction.padEnd(6, "0") || "0") : null;
}

export class EngineeringQaStop extends Error {
  constructor(code) { super(code); this.name = "EngineeringQaStop"; this.code = code; }
}
function check(ok, code) { if (!ok) throw new EngineeringQaStop(code); }
function validId(value) { return typeof value === "string" && UUID.test(value); }
function idsUnique(values) { return values.every(validId) && new Set(values).size === values.length; }

export function assertEngineeringQaTarget(target) {
  check(target && typeof target === "object", "TARGET_MISSING");
  if (target.kind === "EXISTING_LOCAL") {
    check(target.containerId === LOCAL && target.host === "127.0.0.1" && target.port === 5433 && target.database === "pero_crm", "TARGET_FORBIDDEN");
  } else if (target.kind === "EXISTING_STAGING") {
    check(target.containerId === STAGING && target.guest === "crm-staging" && target.host === "db" &&
      target.port === 5432 && target.database === "crm", "TARGET_FORBIDDEN");
  } else throw new EngineeringQaStop("TARGET_FORBIDDEN");
  return target;
}

export function validateEngineeringPlan(plan) {
  check(plan?.format === FORMAT && validId(plan.runId), "PLAN_INVALID");
  assertEngineeringQaTarget(plan.target);
  const ids = [plan.project?.id, plan.product?.id, plan.pool?.id, plan.legacyWork?.id,
    plan.legacyTasks?.[0]?.id, plan.legacyTasks?.[1]?.id, plan.historicalTimeEntry?.id,
    ...(plan.users ?? []).map((user) => user.id)];
  check(ids.length === 10 && idsUnique(ids), "PLANNED_IDS_INVALID");
  check(!ids.includes(plan.managerId) && !ids.includes(plan.project?.clientId), "PLANNED_IDS_INVALID");
  check(plan.users.length === 3 && same(plan.users.map((user) => user.roles), [["ENGINEER"], ["ENGINEER"], ["WORKER"]]) &&
    plan.users.every((user) => user.active === true && user.payScheme === "PIECE" && user.email?.endsWith(".invalid") &&
      user.email.includes(plan.runId) && user.name?.includes(plan.runId) && typeof user.passwordHash === "string" && user.passwordHash.startsWith("$argon2")), "QA_USERS_INVALID");
  check(plan.product.engineerId === plan.users[0].id && plan.product.expectedPrice === "10000.00" && plan.product.status === "DESIGN" &&
    plan.product.number.includes(plan.runId) && plan.project.number.includes(plan.runId) &&
    Number.isInteger(plan.project.numberInt) && plan.project.numberInt >= -2147483648 && plan.project.numberInt < 0 &&
    plan.project.currency === "BYN" && typeof plan.project.clientId === "string" && plan.project.clientId.length > 0 &&
    typeof plan.managerId === "string" && plan.managerId.length > 0, "QA_PROJECT_INVALID");
  check(plan.legacyWork.quantity === "5.00" && plan.legacyWork.priceSnapshot === "100.00" && plan.legacyWork.total === "500.00" &&
    typeof plan.newWorkTitle === "string" && plan.newWorkTitle.includes(plan.runId) && plan.newWorkQuantity === "10.30" &&
    same(plan.legacyTasks.map((task) => task.quantity), ["2.00", "3.00"]) &&
    plan.legacyTasks.every((task) => task.assigneeId === plan.users[0].id && task.title.includes(plan.runId)) &&
    same(plan.legacyTasks.map((task) => task.status), ["DONE", "NEW"]) &&
    plan.historicalTimeEntry.taskId === plan.legacyTasks[0].id && plan.historicalTimeEntry.userId === plan.users[0].id,
  "QA_WORK_INVALID");
  const zoned = (value) => typeof value === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(value) && engineeringTimestampInstant(value) !== null;
  check(plan.legacyTasks.every((task) => zoned(task.dueAt) && Number.isSafeInteger(task.estimateMinutes) && task.estimateMinutes > 0) &&
    zoned(plan.legacyTasks[0].doneAt) && zoned(plan.historicalTimeEntry.startedAt) && zoned(plan.historicalTimeEntry.stoppedAt) &&
    engineeringTimestampInstant(plan.historicalTimeEntry.stoppedAt) >= engineeringTimestampInstant(plan.historicalTimeEntry.startedAt) &&
    Number.isSafeInteger(plan.historicalTimeEntry.minutes) && plan.historicalTimeEntry.minutes > 0, "QA_TIME_INVALID");
  check(plan.baseline && same(Object.keys(plan.baseline).sort(), [...ENGINEERING_TABLES].sort()) &&
    Object.values(plan.baseline).every((hash) => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)), "BASELINE_INVALID");
  return plan;
}

export function engineeringPublicPlan(plan) {
  return { format: FORMAT, runId: plan.runId, target: plan.target, managerId: plan.managerId,
    ids: { project: plan.project.id, product: plan.product.id, pool: plan.pool.id, legacyWork: plan.legacyWork.id,
      legacyTasks: plan.legacyTasks.map((task) => task.id), timeEntry: plan.historicalTimeEntry.id,
      users: plan.users.map((user) => user.id) }, clientId: plan.project.clientId,
    project: { number: plan.project.number, numberInt: plan.project.numberInt, title: plan.project.title },
    product: { number: plan.product.number, title: plan.product.title },
    users: plan.users.map(({ id, email, name, roles, payScheme, active, passwordHash }) => ({ id, email, name, roles, payScheme, active,
      passwordDigest: sha(passwordHash) })),
    newWorkTitle: plan.newWorkTitle, newWorkQuantity: plan.newWorkQuantity,
    legacy: { title: plan.legacyWork.title, quantity: "5.00", priceSnapshot: "100.00", total: "500.00",
      tasks: plan.legacyTasks.map(({ id, title, quantity, status, doneAt }) => ({ id, title, quantity, status, doneAt: doneAt ?? null })),
      historicalTimeEntry: { ...plan.historicalTimeEntry } }, baseline: plan.baseline };
}
function key(table, row) { return table === "TaskDependency" ? `${row.taskId}|${row.dependsOnId}` : table === "UserPreference" ? `${row.userId}|${row.key}` : table === "OrgSetting" ? row.key : row.id; }
function manifestBody(manifest) { check(manifest && typeof manifest === "object", "MANIFEST_INVALID"); const body = { ...manifest }; delete body.manifestHash; return body; }
function omitVolatile(table, row) { if (table !== "ApiToken") return row; const stable = { ...row }; delete stable.lastUsedAt; return stable; }

/** All table names are static allowlisted constants. The caller supplies an already validated Prisma client/transaction. */
export async function readEngineeringSnapshot(db) {
  const result = {};
  for (const table of ENGINEERING_TABLES) {
    const expression = table === "ApiToken" ? `(to_jsonb(t)-'lastUsedAt')` : "to_jsonb(t)";
    const rows = await db.$queryRawUnsafe(`SELECT ${expression}::text AS raw FROM "${table}" AS t`);
    check(Array.isArray(rows), "SNAPSHOT_INVALID");
    result[table] = rows.map(({ raw }) => {
      check(typeof raw === "string", "SNAPSHOT_INVALID");
      const row = JSON.parse(raw);
      Object.defineProperty(row, "__raw", { value: raw, enumerable: false });
      return row;
    });
  }
  return result;
}

export function engineeringFingerprints(snapshot, owned = {}) {
  return Object.fromEntries(ENGINEERING_TABLES.map((table) => {
    const exclude = new Set(owned[table] ?? []);
    const rows = (snapshot[table] ?? []).filter((row) => !exclude.has(key(table, row))).map((row) => row.__raw ?? canonical(omitVolatile(table, row))).sort();
    return [table, sha(rows.join("\n") + "\n")];
  }));
}

export async function baselineEngineeringOwned(db, target) {
  assertEngineeringQaTarget(target);
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return engineeringFingerprints(await readEngineeringSnapshot(tx));
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 120000 });
}

export function engineeringPlanSha256(plan) { validateEngineeringPlan(plan); return sha(canonical(engineeringPublicPlan(plan))); }

function ownGraph(snapshot, manifest) {
  const id = manifest.ids;
  const users = new Set(id.users), project = id.project, product = id.product, pool = id.pool;
  const rows = (table) => snapshot[table] ?? [];
  const picks = {
    User: rows("User").filter((row) => users.has(row.id)),
    Project: rows("Project").filter((row) => row.id === project),
    Product: rows("Product").filter((row) => row.id === product),
    ProductStagePayPool: rows("ProductStagePayPool").filter((row) => row.id === pool || row.productId === product),
    Work: rows("Work").filter((row) => row.productId === product || row.projectId === project),
    Task: rows("Task").filter((row) => row.projectId === project || row.productId === product),
  };
  check(picks.User.length === 3 && picks.Project.length === 1 && picks.Product.length === 1 && picks.ProductStagePayPool.length === 1,
    "INITIAL_GRAPH_MISSING");
  check(picks.Project[0].clientId === manifest.clientId && picks.Project[0].currency === "BYN" &&
    picks.Project[0].number === manifest.project.number && picks.Project[0].numberInt === manifest.project.numberInt &&
    picks.Project[0].title === manifest.project.title && picks.Product[0].projectId === project &&
    picks.Product[0].number === manifest.product.number && picks.Product[0].title === manifest.product.title &&
    picks.ProductStagePayPool[0].productId === product, "INITIAL_GRAPH_CHANGED");
  check(picks.User.every((row) => {
    const expected = manifest.users.find((user) => user.id === row.id);
    return expected && row.email === expected.email && row.name === expected.name && same(row.roles, expected.roles) &&
      row.payScheme === expected.payScheme && row.active === expected.active && sha(row.passwordHash) === expected.passwordDigest;
  }), "QA_USER_CHANGED");
  const legacyWork = picks.Work.find((row) => row.id === id.legacyWork);
  const newWork = picks.Work.find((row) => row.id !== id.legacyWork);
  check(picks.Work.length >= 1 && picks.Work.length <= 2 && legacyWork &&
    legacyWork.productId === product && legacyWork.projectId === project &&
    legacyWork.title === manifest.legacy.title && Number(legacyWork.quantity) === 5 &&
    Number(legacyWork.priceSnapshot) === 100 && Number(legacyWork.total) === 500 &&
    (!newWork || (newWork.productId === product && newWork.projectId === project && newWork.stagePayPoolId === pool &&
      newWork.paymentKind === "ENGINEERING" && newWork.title === manifest.newWorkTitle && newWork.createdById === manifest.managerId &&
      Number(newWork.quantity) === Number(manifest.newWorkQuantity) && newWork.priceSnapshot === null && newWork.total === null)), "WORK_GRAPH_UNKNOWN");
  const workIds = new Set(picks.Work.map((row) => row.id));
  check(picks.Task.length >= 2 && picks.Task.length <= 4 && picks.Task.every((row) => workIds.has(row.workId) && row.projectId === project && row.productId === product && users.has(row.assigneeId)) &&
    id.legacyTasks.every((taskId) => picks.Task.some((row) => row.id === taskId)), "TASK_GRAPH_UNKNOWN");
  const taskIds = new Set(picks.Task.map((row) => row.id));
  const legacyTasks = id.legacyTasks.map((taskId) => picks.Task.find((row) => row.id === taskId));
  check(legacyTasks.every((task, index) => task.workId === id.legacyWork && task.title === manifest.legacy.tasks[index].title &&
    Number(task.quantity) === Number(manifest.legacy.tasks[index].quantity) && task.shareAmount === null &&
    task.shareUnits === null && task.allocationGroupId === null && Number(task.executorShare) === 1) &&
    legacyTasks[0].status === "DONE" && legacyTasks[0].doneById === manifest.managerId &&
    engineeringTimestampInstant(legacyTasks[0].doneAt) !== null &&
    engineeringTimestampInstant(legacyTasks[0].doneAt) === engineeringTimestampInstant(manifest.legacy.tasks[0].doneAt), "LEGACY_TASK_CHANGED");
  const newTasks = newWork ? picks.Task.filter((row) => row.workId === newWork.id) : [];
  check(newTasks.length <= 2 && (newWork ? newTasks.length >= 1 : newTasks.length === 0) &&
    newTasks.every((row) => row.title === manifest.newWorkTitle && row.shareAmount === null), "NEW_TASK_UNKNOWN");
  picks.TaskAllocationGroup = rows("TaskAllocationGroup").filter((row) => workIds.has(row.workId));
  const groupIds = new Set(picks.TaskAllocationGroup.map((row) => row.id));
  check(picks.TaskAllocationGroup.length === (newWork ? 1 : 0) &&
    picks.TaskAllocationGroup.every((row) => row.workId === newWork?.id && Number(row.quantity) === Number(manifest.newWorkQuantity) &&
      row.budgetSource === "STAGE_PREVIEW" && row.budget === null && row.currency === null) &&
    picks.Task.every((row) => row.allocationGroupId === null || groupIds.has(row.allocationGroupId)), "GROUP_GRAPH_UNKNOWN");
  check(newTasks.every((task) => task.allocationGroupId === picks.TaskAllocationGroup[0]?.id &&
    Number(task.quantity) === Number(manifest.newWorkQuantity) && Number.isInteger(task.shareUnits) && task.shareUnits > 0) &&
    (!newTasks.length || newTasks.reduce((sum, task) => sum + task.shareUnits, 0) === 1000000), "PHYSICAL_SPLIT_UNKNOWN");
  picks.TaskDependency = rows("TaskDependency").filter((row) => taskIds.has(row.taskId) || taskIds.has(row.dependsOnId));
  picks.TimeEntry = rows("TimeEntry").filter((row) => taskIds.has(row.taskId));
  picks.WorkPaymentConversion = rows("WorkPaymentConversion").filter((row) => workIds.has(row.workId) || row.poolId === pool);
  check((legacyWork.paymentKind === "LEGACY" && legacyWork.stagePayPoolId === null && picks.WorkPaymentConversion.length === 0) ||
    (legacyWork.paymentKind === "ENGINEERING" && legacyWork.stagePayPoolId === pool && picks.WorkPaymentConversion.length === 1), "CONVERSION_GRAPH_UNKNOWN");
  picks.ProductStageSettlement = rows("ProductStageSettlement").filter((row) => row.productId === product || row.poolId === pool);
  const settlementIds = new Set(picks.ProductStageSettlement.map((row) => row.id));
  picks.ProductStageSettlementShare = rows("ProductStageSettlementShare").filter((row) => settlementIds.has(row.settlementId) || taskIds.has(row.taskId));
  const shareIds = new Set(picks.ProductStageSettlementShare.map((row) => row.id));
  picks.PayrollEntry = rows("PayrollEntry").filter((row) => row.productId === product || shareIds.has(row.settlementShareId) || taskIds.has(row.taskId));
  picks.ProductStatusHistory = rows("ProductStatusHistory").filter((row) => row.productId === product);
  picks.ProjectStageHistory = rows("ProjectStageHistory").filter((row) => row.projectId === project);
  picks.UserPreference = rows("UserPreference").filter((row) => users.has(row.userId));
  picks.ChangeLog = rows("ChangeLog").filter((row) => [project, product, pool, ...workIds, ...taskIds].includes(row.entityId));
  const splitReceipts = picks.ChangeLog.filter((row) => row.action === "split" && newTasks.some((task) => task.id === row.entityId));
  if (newTasks.length === 2) {
    check(splitReceipts.length === 1 && splitReceipts[0].actorId === manifest.ids.users[0] &&
      splitReceipts[0].newValue?.recipientId === manifest.ids.users[1] &&
      newTasks.some((task) => task.id === splitReceipts[0].newValue?.childTaskId && task.assigneeId === manifest.ids.users[1]) &&
      newTasks.some((task) => task.id === splitReceipts[0].entityId && task.assigneeId === manifest.ids.users[0]), "SPLIT_RECEIPT_MISSING");
  } else check(splitReceipts.length === 0, "SPLIT_RECEIPT_UNKNOWN");
  check(newTasks.every((task) => task.createdById === manifest.managerId ||
    (splitReceipts.length === 1 && task.id === splitReceipts[0].newValue?.childTaskId && task.createdById === manifest.ids.users[0])), "NEW_TASK_ACTOR_UNKNOWN");
  picks.DomainEvent = rows("DomainEvent").filter((row) =>
    [project, product].includes(row.payload?.projectId) || row.payload?.productId === product || taskIds.has(row.payload?.taskId));
  const QA_PAYMENT_BODY = `Инженерный фонд изделия ${manifest.product.number}`;
  const earnings = manifest.users.map((user) => {
    const cents = picks.PayrollEntry.filter((row) => row.userId === user.id).reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0);
    return { user, cents, text: `${new Intl.NumberFormat("ru-RU").format(cents / 100)} BYN` };
  });
  picks.Notification = rows("Notification").filter((row) =>
    (row.type === "task.assigned" && users.has(row.userId) && row.link === "/my" &&
      row.body === `Проект ${manifest.project.number}` &&
      picks.Task.some((task) => row.title === `Вам назначена задача: ${task.title}` || row.title === `Вам передана часть задачи: ${task.title}`)) ||
    (row.type === "task.statusChanged" && ["/my", `/products/${manifest.product.number}`, `/projects/${project}`].includes(row.link) &&
      String(row.body ?? "").includes(manifest.project.number) && picks.Task.some((task) => String(row.title ?? "").includes(task.title))) ||
    (row.type === "product.statusChanged" && row.link === `/products/${manifest.product.number}` &&
      String(row.title ?? "").includes(manifest.product.number) && row.body === manifest.product.title) ||
    (picks.ProductStageSettlement.length === 1 && ["payroll.accrued", "payroll.orgAccrued"].includes(row.type) &&
      row.body === QA_PAYMENT_BODY &&
      earnings.some(({ user, cents, text }) => cents > 0 &&
        (row.type === "payroll.accrued"
          ? row.userId === user.id && row.link === "/payroll" && row.title === `Начислена зарплата: ${text}`
          : row.link === "/finance/payroll" && row.title === `Начислено ${user.name}: ${text}`))));
  const owned = Object.fromEntries(OWNED.map((table) => [table, sorted((picks[table] ?? []).map((row) => key(table, row)))]));
  check(picks.TaskDependency.every((row) => taskIds.has(row.taskId) && taskIds.has(row.dependsOnId)) &&
    picks.TimeEntry.every((row) => users.has(row.userId) && taskIds.has(row.taskId)) &&
    picks.TimeEntry.some((row) => row.id === id.timeEntry && row.taskId === id.legacyTasks[0] &&
      row.userId === id.users[0] && row.source === "manual" && row.autoStopped === false &&
      row.minutes === manifest.legacy.historicalTimeEntry.minutes &&
      engineeringTimestampInstant(row.startedAt) !== null && engineeringTimestampInstant(row.stoppedAt) !== null &&
      engineeringTimestampInstant(row.startedAt) === engineeringTimestampInstant(manifest.legacy.historicalTimeEntry.startedAt) &&
      engineeringTimestampInstant(row.stoppedAt) === engineeringTimestampInstant(manifest.legacy.historicalTimeEntry.stoppedAt)) &&
    picks.UserPreference.every((row) => row.key === "my.view") &&
    picks.ChangeLog.every((row) => [manifest.managerId, ...users].includes(row.actorId) && row.actorType === "user" && row.source === "web" &&
      ["create", "update", "status", "split", "engineering.close", "engineering.configure", "engineering.shares", "time"].includes(row.action) &&
      (row.action !== "engineering.close" || (row.entity === "product" && row.entityId === product && String(row.id).startsWith("product-engineering-close:")))) &&
    picks.DomainEvent.every((row) => [manifest.managerId, ...users].includes(row.actor) &&
      ["task.created", "task.assigned", "task.statusChanged", "task.split", "payroll.accrued", "product.statusChanged", "product.engineeringSettled"].includes(row.type)) &&
    picks.WorkPaymentConversion.every((row) => row.poolId === pool && row.workId === id.legacyWork) &&
    picks.ProductStageSettlement.every((row) => row.poolId === pool && row.productId === product && row.projectId === project) &&
    picks.ProductStageSettlementShare.every((row) => settlementIds.has(row.settlementId) && workIds.has(row.workId) && taskIds.has(row.taskId) && users.has(row.userId)) &&
    picks.PayrollEntry.every((row) => row.scheme === "PRODUCT_ENGINEERING" &&
      users.has(row.userId) && shareIds.has(row.settlementShareId)), "UNKNOWN_REFERENCES");
  check(rows("File").every((row) => !taskIds.has(row.taskId) && row.productId !== product && row.projectId !== project) &&
    rows("Payment").every((row) => row.projectId !== project) && rows("Payout").every((row) => !users.has(row.userId)), "UNKNOWN_REFERENCES");
  const allOwnedIds = new Set([project, product, pool, ...users, ...workIds, ...taskIds, ...settlementIds, ...shareIds,
    ...Object.values(owned).flat()]);
  for (const table of ENGINEERING_TABLES) for (const row of rows(table)) {
    const references = Object.entries(row).filter(([name, value]) => name.endsWith("Id") && typeof value === "string" && allOwnedIds.has(value));
    if (references.length && !(owned[table] ?? []).includes(key(table, row))) throw new EngineeringQaStop("UNKNOWN_REFERENCES");
  }
  return { owned, picks };
}

export function verifyEngineeringCapture(snapshot, manifest) {
  const { owned, picks } = ownGraph(snapshot, manifest);
  check(same(engineeringFingerprints(snapshot, owned), manifest.baseline), "BUSINESS_FINGERPRINT_DRIFT");
  check((snapshot.PayrollEntry ?? []).every((row) => !([manifest.ids.project, manifest.ids.product].includes(row.projectId) && row.scheme === "PIECE")), "UNEXPECTED_PIECE_PAY");
  const paid = picks.PayrollEntry;
  const totals = Object.fromEntries(manifest.ids.users.map((userId) => [userId, paid.filter((row) => row.userId === userId)
    .reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0)]));
  const phase = picks.ProductStageSettlement.length ? "SETTLED" : picks.Work.length === 1 ? "INITIAL" : picks.Task.length === 3 ? "WORK_CREATED" : "SPLIT_OR_CONVERTED";
  const graphRows = Object.fromEntries(OWNED.map((table) => [table,
    (picks[table] ?? []).map((row) => row.__raw ?? canonical(row)).sort()]));
  return { owned, totals, phase, settled: picks.ProductStageSettlement.length === 1, graphHash: sha(canonical(graphRows)) };
}

/** Invoke only after the full browser scenario; cleanup may use any captured phase. */
export function assertFinalEngineeringScenario(snapshot, manifest) {
  const capture = verifyEngineeringCapture(snapshot, manifest);
  const { picks } = ownGraph(snapshot, manifest);
  const legacyWork = picks.Work.find((row) => row.id === manifest.ids.legacyWork);
  const newWork = picks.Work.find((row) => row.id !== manifest.ids.legacyWork);
  check(newWork && picks.Work.length === 2 && picks.Task.length === 4, "SCENARIO_INCOMPLETE");
  check(picks.Task.every((task) => task.status === "DONE"), "SCENARIO_TASKS_NOT_DONE");
  const legacyTasks = manifest.ids.legacyTasks.map((taskId) => picks.Task.find((row) => row.id === taskId));
  const newTasks = picks.Task.filter((row) => row.workId === newWork.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
  check(Number(picks.Product[0].expectedPrice) === 12000 &&
    legacyWork.poolWeightUnits === 400000 && newWork.poolWeightUnits === 600000 &&
    same(legacyTasks.map((task) => task.stageShareUnits), [800000, 200000]) &&
    legacyTasks[0].assigneeId === manifest.ids.users[0] && legacyTasks[1].assigneeId === manifest.ids.users[2] &&
    newTasks.length === 2 && same(newTasks.map((task) => task.stageShareUnits).sort(), [500000, 500000]) &&
    new Set(newTasks.map((task) => task.assigneeId)).size === 2 &&
    new Set(newTasks.map((task) => task.assigneeId)).has(manifest.ids.users[0]) &&
    new Set(newTasks.map((task) => task.assigneeId)).has(manifest.ids.users[1]), "SCENARIO_ALLOCATION_MISMATCH");
  check(picks.ProductStageSettlement.length === 1 && picks.ProductStageSettlementShare.length === 4 && picks.PayrollEntry.length === 4 &&
    same(Object.values(capture.totals), [37200, 18000, 4800]) && Math.round(Number(picks.ProductStageSettlement[0].amount) * 100) === 60000,
  "SETTLEMENT_TOTAL_MISMATCH");
  const settlement = picks.ProductStageSettlement[0];
  check(["PRODUCTION", "STORAGE", "INSTALLATION", "DONE", "RECLAMATION"].includes(picks.Product[0].status) &&
    picks.ProductStagePayPool[0].state === "SETTLED" &&
    Number(settlement.priceSnapshot) === 12000 && Number(settlement.ratePercentSnapshot) === 5 &&
    settlement.productCurrency === "BYN" && settlement.payrollCurrency === "BYN" &&
    picks.PayrollEntry.every((row) => row.currency === "BYN" && row.projectCurrency === "BYN" && row.scheme === "PRODUCT_ENGINEERING"),
  "SETTLEMENT_SOURCE_MISMATCH");
  return capture;
}

export async function prepareEngineeringOwned({ db, plan, durablePlanSha256 }) {
  validateEngineeringPlan(plan);
  check(typeof durablePlanSha256 === "string" && durablePlanSha256 === engineeringPlanSha256(plan), "DURABLE_PLAN_PROOF_REQUIRED");
  return db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
    await tx.$executeRawUnsafe(LOCK_ALL_WRITES);
    const before = await readEngineeringSnapshot(tx);
    const manifest = engineeringPublicPlan(plan);
    check(same(engineeringFingerprints(before), plan.baseline), "BASELINE_DRIFT_BEFORE_INSERT");
    const plannedIds = new Set([manifest.ids.project, manifest.ids.product, manifest.ids.pool, manifest.ids.legacyWork,
      ...manifest.ids.legacyTasks, manifest.ids.timeEntry, ...manifest.ids.users]);
    check(ENGINEERING_TABLES.every((table) => (before[table] ?? []).every((row) => !plannedIds.has(row.id))), "PREPARE_ID_COLLISION");
    check((before.Project ?? []).every((row) => row.id !== plan.project.id && row.number !== plan.project.number) &&
      (before.User ?? []).every((row) => !plan.users.some((user) => user.id === row.id || user.email === row.email)) &&
      (before.Client ?? []).some((row) => row.id === plan.project.clientId) &&
      (before.User ?? []).some((row) => row.id === plan.managerId && row.active === true &&
        Array.isArray(row.roles) && row.roles.some((role) => ["ADMIN", "DIRECTOR", "MANAGER"].includes(role))), "PREPARE_COLLISION_OR_CONTEXT_MISSING");
    for (const user of plan.users) await tx.user.create({ data: { id: user.id, email: user.email, name: user.name, passwordHash: user.passwordHash,
      roles: user.roles, payScheme: "PIECE", active: true } });
    await tx.project.create({ data: { id: plan.project.id, number: plan.project.number, numberInt: plan.project.numberInt,
      title: plan.project.title, clientId: plan.project.clientId, managerId: plan.managerId, currency: "BYN", stage: "LEAD" } });
    await tx.product.create({ data: { id: plan.product.id, projectId: plan.project.id, number: plan.product.number, suffixInt: 1,
      title: plan.product.title, engineerId: plan.users[0].id, expectedPrice: "10000.00", status: "DESIGN" } });
    await tx.productStagePayPool.create({ data: { id: plan.pool.id, productId: plan.product.id, kind: "ENGINEERING", state: "DRAFT" } });
    await tx.work.create({ data: { id: plan.legacyWork.id, projectId: plan.project.id, productId: plan.product.id,
      title: plan.legacyWork.title, quantity: "5.00", priceSnapshot: "100.00", total: "500.00", paymentKind: "LEGACY" } });
    for (const task of plan.legacyTasks) await tx.task.create({ data: { id: task.id, projectId: plan.project.id, productId: plan.product.id,
      workId: plan.legacyWork.id, title: task.title, type: "Проектирование", status: task.status, assigneeId: plan.users[0].id,
      quantity: task.quantity, dueAt: new Date(task.dueAt), estimateMinutes: task.estimateMinutes,
      ...(task.status === "DONE" ? { doneAt: new Date(task.doneAt), doneById: plan.managerId } : {}) } });
    await tx.timeEntry.create({ data: { id: plan.historicalTimeEntry.id, taskId: plan.legacyTasks[0].id, userId: plan.users[0].id,
      source: "manual", startedAt: new Date(plan.historicalTimeEntry.startedAt), stoppedAt: new Date(plan.historicalTimeEntry.stoppedAt),
      minutes: plan.historicalTimeEntry.minutes } });
    await tx.taskDependency.create({ data: { taskId: plan.legacyTasks[1].id, dependsOnId: plan.legacyTasks[0].id } });
    const after = await readEngineeringSnapshot(tx);
    const initialOwned = Object.fromEntries(OWNED.map((table) => [table, []]));
    Object.assign(initialOwned, { User: manifest.ids.users, Project: [manifest.ids.project], Product: [manifest.ids.product],
      ProductStagePayPool: [manifest.ids.pool], Work: [manifest.ids.legacyWork], Task: manifest.ids.legacyTasks,
      TimeEntry: [manifest.ids.timeEntry], TaskDependency: [`${manifest.ids.legacyTasks[1]}|${manifest.ids.legacyTasks[0]}`] });
    check(same(engineeringFingerprints(after, initialOwned), manifest.baseline), "PREPARE_BUSINESS_DIFF");
  return { ...manifest, manifestHash: sha(canonical(manifest)) };
  }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 60000 });
}

export async function captureEngineeringOwned({ db, target, manifest, expectFinal = false }) {
  assertEngineeringQaTarget(target);
  check(same(target, manifest?.target) && manifest?.manifestHash === sha(canonical(manifestBody(manifest))), "MANIFEST_INVALID");
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const snapshot = await readEngineeringSnapshot(tx);
    return expectFinal ? assertFinalEngineeringScenario(snapshot, manifest) : verifyEngineeringCapture(snapshot, manifest);
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 120000 });
}

export function assertEngineeringTriggerSet(triggers) {
  check(Array.isArray(triggers) && triggers.length === ENGINEERING_TRIGGERS.length, "TRIGGER_SET_MISMATCH");
  const normalize = (body) => String(body ?? "").replace(/\s+/g, " ").trim();
  const SOURCE_APPEND_ONLY = normalize(`BEGIN
    RAISE EXCEPTION 'product payment history is append-only';
  END;`);
  const SOURCE_PAYROLL = normalize(`BEGIN
    IF OLD."settlementShareId" IS NOT NULL THEN
      RAISE EXCEPTION 'product engineering payroll entry is append-only';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END;`);
  for (const [table, name] of ENGINEERING_TRIGGERS) {
    const row = triggers.find((trigger) => trigger.table_name === table && trigger.tgname === name);
    const functionName = table === "PayrollEntry" ? "protect_settled_product_payroll_entry" : "reject_product_payment_history_mutation";
    check(row && row.tgenabled === "O" && row.tgisinternal === false && typeof row.definition === "string" &&
      row.definition.includes(name) && row.definition.includes(`ON public.\"${table}\"`) &&
      row.definition.includes(functionName) && typeof row.function_definition === "string" && row.function_definition.includes(functionName) &&
      Number(row.tgtype) === 27 && Number(row.tgnargs) === 0 && row.tgqual === null && row.fnnamespace === "public" &&
      row.proname === functionName && row.prosecdef === false &&
      normalize(row.prosrc) === (table === "PayrollEntry" ? SOURCE_PAYROLL : SOURCE_APPEND_ONLY), "TRIGGER_SET_MISMATCH");
  }
  return sha(canonical(triggers.map(({ table_name, tgname, tgenabled, definition, function_definition, tgtype, tgnargs, tgqual, fnnamespace, proname, prosrc, prosecdef }) =>
    ({ table_name, tgname, tgenabled, definition, function_definition, tgtype, tgnargs, tgqual, fnnamespace, proname, prosrc, prosecdef })).sort((a, b) => a.tgname.localeCompare(b.tgname))));
}

const TRIGGER_QUERY = `SELECT c.relname AS table_name,t.tgname,t.tgenabled,t.tgisinternal,t.tgtype,t.tgnargs,t.tgqual::text AS tgqual,
nf.nspname AS fnnamespace,p.proname,p.prosrc,p.prosecdef,
pg_get_triggerdef(t.oid) AS definition,pg_get_functiondef(t.tgfoid) AS function_definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace nf ON nf.oid=p.pronamespace
WHERE n.nspname='public' AND c.relname IN ('WorkPaymentConversion','ProductStageSettlement','ProductStageSettlementShare','PayrollEntry')
AND NOT t.tgisinternal`;

/** Caller must have approved QA creation/cleanup and durable capture proof. */
export async function cleanupEngineeringOwned({ db, target, manifest, captured, actionsDrained = false }) {
  assertEngineeringQaTarget(target);
  check(actionsDrained, "ACTIONS_NOT_DRAINED");
  check(same(target, manifest?.target) && manifest?.manifestHash === sha(canonical(manifestBody(manifest))) &&
    captured?.graphHash && captured?.owned, "MANIFEST_INVALID");
  return db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
    await tx.$executeRawUnsafe(LOCK_ALL_WRITES);
    await tx.$executeRawUnsafe(LOCK_HISTORY);
    const before = await readEngineeringSnapshot(tx);
    const current = verifyEngineeringCapture(before, manifest);
    check(current.graphHash === captured.graphHash && same(current.owned, captured.owned), "OWNED_GRAPH_DRIFT");
    const triggerBefore = await tx.$queryRawUnsafe(TRIGGER_QUERY);
    const triggerHash = assertEngineeringTriggerSet(triggerBefore);
    for (const [table, name] of ENGINEERING_TRIGGERS) await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${name}"`);
    for (const table of DEL) {
      const keys = current.owned[table] ?? [];
      if (!keys.length) continue;
      const result = table === "TaskDependency"
        ? await tx.$queryRawUnsafe(`DELETE FROM "TaskDependency" WHERE ("taskId" || '|' || "dependsOnId") = ANY($1::text[]) RETURNING "taskId"`, keys)
        : table === "UserPreference"
          ? await tx.$queryRawUnsafe(`DELETE FROM "UserPreference" WHERE ("userId" || '|' || "key") = ANY($1::text[]) RETURNING "userId"`, keys)
        : await tx.$queryRawUnsafe(`DELETE FROM "${table}" WHERE "id" = ANY($1::text[]) RETURNING "id"`, keys);
      check(result.length === keys.length, "EXACT_DELETE_COUNT_MISMATCH");
    }
    for (const [table, name] of ENGINEERING_TRIGGERS) await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${name}"`);
    check(assertEngineeringTriggerSet(await tx.$queryRawUnsafe(TRIGGER_QUERY)) === triggerHash, "TRIGGER_RESTORE_MISMATCH");
    const after = await readEngineeringSnapshot(tx);
    check(same(engineeringFingerprints(after), manifest.baseline), "CLEANUP_POSTCHECK_FAILED");
    return { phase: "CLEANED", deleted: Object.fromEntries(DEL.map((table) => [table, current.owned[table]?.length ?? 0])) };
  }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 60000 });
}
