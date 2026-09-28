/** Guarded, opt-in QA library. No CLI, console output, connection or INSERT on import. */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";

export const REQUIRED_MIGRATION = "20260928140000_universal_work_shares";
export const LOCAL_CONTAINER_ID = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const FORMAT = "pero-work-shares-owned-qa/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
export const SNAPSHOT_TABLES = Object.freeze(["User", "Client", "Project", "Product", "ProductStatusHistory", "ProjectStageHistory", "Task", "TaskAllocationGroup", "TaskDependency", "PriceItem", "Work", "TimeEntry", "PayrollEntry", "Payout", "CashAccount", "ExpenseArticle", "Payment", "OrgSetting", "MaterialCategory", "Material", "ProjectMaterial", "StockMovement", "File", "Communication", "Notification", "NotificationPreference", "UserPreference", "Plugin", "PluginSetting", "PluginRunLog", "DomainEvent", "ApiToken", "ChangeLog", "TelegramLink"]);
const TABLES = SNAPSHOT_TABLES;
const COMPOSITE = { TaskDependency: ["taskId", "dependsOnId"], UserPreference: ["userId", "key"], NotificationPreference: ["userId", "type"], PluginSetting: ["pluginId", "key"] };
const OWNED_TABLES = ["User", "Project", "Work", "Task", "TaskAllocationGroup", "TaskDependency", "TimeEntry", "PayrollEntry", "Notification", "DomainEvent", "ChangeLog", "UserPreference"];
const keysFor = (table) => COMPOSITE[table] ?? [table === "OrgSetting" ? "key" : "id"];

/** Shared SQL/DI projection policy; omitted fields are never written or restored. */
export function fingerprintOmittedColumns(table) { return table === "ApiToken" ? ["lastUsedAt"] : []; }

export class QaStop extends Error {
  constructor(code) { super(code); this.name = "QaStop"; this.code = code; }
}
function check(condition, code) { if (!condition) throw new QaStop(code); }
function equal(a, b) { return canonical(a) === canonical(b); }

export function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") { check(Number.isFinite(value), "INVALID_JSON_NUMBER"); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  check(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype, "INVALID_JSON_OBJECT");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function canonicalEnvelope(envelope) { return canonical(envelope) + "\n"; }
export function envelopeSha256(envelope) { return createHash("sha256").update(canonicalEnvelope(envelope), "utf8").digest("hex"); }
function mac(body, secret) { return createHmac("sha256", secret).update(canonical({ format: FORMAT, body }), "utf8").digest("hex"); }
export function sealEnvelope(body, secret) {
  check(typeof secret === "string" && secret.length >= 32, "SIGNING_SECRET_REQUIRED");
  return { format: FORMAT, body, hmac: mac(body, secret) };
}
export function openEnvelope(envelope, secret) {
  check(envelope?.format === FORMAT && HASH.test(envelope.hmac ?? ""), "MANIFEST_FORMAT_INVALID");
  const expected = Buffer.from(mac(envelope.body, secret), "hex");
  check(timingSafeEqual(Buffer.from(envelope.hmac, "hex"), expected), "MANIFEST_TAMPERED");
  return envelope.body;
}

function validatePlan(plan) {
  check(plan?.version === 1 && UUID.test(plan.runId), "PLAN_INVALID");
  check(["EXISTING_LOCAL", "EXISTING_STAGING"].includes(plan.target?.kind), "TARGET_FORBIDDEN");
  const ids = [plan.project?.id, plan.work?.id, plan.source?.id, plan.dependent?.id, ...(plan.users ?? []).map((user) => user.id)];
  check(ids.length === 6 && ids.every((id) => UUID.test(id ?? "")) && new Set(ids).size === 6, "PLANNED_IDS_INVALID");
  check(plan.users.length === 2 && equal(plan.users.map((user) => user.roles), [["WORKER"], ["MOUNTER"]]), "QA_ROLES_INVALID");
  for (const user of plan.users) {
    check(user.name.includes(plan.runId) && user.email.includes(plan.runId) && user.email.endsWith(".invalid"), "QA_IDENTITY_INVALID");
    check(user.payScheme === "PIECE" && user.active === true && user.sessionVersion === 0 && user.passwordHash.startsWith("$argon2"), "QA_USER_CONTRACT_INVALID");
  }
  check(plan.project.number === `LOCAL-QA-${plan.runId}` && plan.project.title.includes(plan.runId) && plan.project.numberInt < 0, "QA_PROJECT_INVALID");
  check(plan.source.title.includes(plan.runId) && plan.dependent.title.includes(plan.runId) && plan.fractionalTitle.includes(plan.runId), "QA_TASK_NAMES_INVALID");
  check(new Set([plan.source.title, plan.dependent.title, plan.fractionalTitle]).size === 3, "QA_TASK_NAMES_COLLIDE");
  check(["BYN", "RUB", "USD", "EUR"].includes(plan.currency) && plan.limits.tasks === 4 && plan.limits.groups === 1, "QA_LIMITS_INVALID");
  check(plan.migration === REQUIRED_MIGRATION && equal(Object.keys(plan.baseline).sort(), [...TABLES].sort()), "BASELINE_INVALID");
  return plan;
}

function amount(value) { const number = Number(value); return Number.isFinite(number) ? number : NaN; }
function formatAmount(value, currency) {
  if (Number.isNaN(Number(value))) return "—";
  return `${new Intl.NumberFormat("ru-RU").format(Number(value))} ${{ BYN: "BYN", RUB: "₽", USD: "$", EUR: "€" }[currency] ?? currency}`;
}
function sameFields(row, expected, code) { for (const [key, value] of Object.entries(expected)) check(equal(row[key] ?? null, value), code); }

/** Classifies ownership separately from numeric/application assertions. Never guesses IDs. */
export function deriveOwnership(plan, records) {
  validatePlan(plan);
  const rows = (name) => records[name] ?? [];
  const plannedIds = new Set([plan.project.id, plan.work.id, plan.source.id, plan.dependent.id, ...plan.users.map((user) => user.id)]);
  const initial = [...rows("User"), ...rows("Project"), ...rows("Work"), ...rows("Task")].filter((row) => plannedIds.has(row.id));
  if (initial.length === 0) {
    check(OWNED_TABLES.every((name) => rows(name).length === 0), "ORPHANED_QA_ROWS");
    return { phase: "ABSENT", keys: {}, tasks: {}, diagnostics: /** @type {string[]} */ ([]) };
  }
  check(initial.length === 6, "PARTIAL_INITIAL_ROWS");
  check(rows("User").length === 2 && rows("Project").length === 1 && rows("Work").length === 1, "FOREIGN_ID_REJECTED");
  for (const expected of plan.users) {
    const user = rows("User").find((row) => row.id === expected.id);
    check(user, "QA_USER_MISSING");
    sameFields(user, expected, "QA_USER_IDENTITY_CHANGED");
  }
  sameFields(rows("Project")[0], plan.project, "QA_PROJECT_IDENTITY_CHANGED");
  sameFields(rows("Work")[0], { id: plan.work.id, projectId: plan.project.id, productId: null, title: plan.work.title, priceItemId: plan.work.priceItemId, createdById: plan.manager.id }, "QA_WORK_IDENTITY_CHANGED");
  const userIds = new Set(plan.users.map((user) => user.id));
  const actors = new Set([...userIds, plan.manager.id]);
  const tasks = rows("Task");
  check(tasks.length >= 2 && tasks.length <= 4 && new Set(tasks.map((task) => task.id)).size === tasks.length, "MAX_FOUR_TASKS");
  for (const task of tasks) check(task.projectId === plan.project.id && task.productId === null && userIds.has(task.assigneeId) && actors.has(task.createdById) && [null, plan.work.id].includes(task.workId), "FOREIGN_TASK_REJECTED");
  const source = tasks.find((task) => task.id === plan.source.id);
  const dependent = tasks.find((task) => task.id === plan.dependent.id);
  sameFields(source, { title: plan.source.title, workId: plan.work.id, assigneeId: plan.users[0].id, createdById: plan.manager.id }, "SOURCE_IDENTITY_CHANGED");
  sameFields(dependent, { title: plan.dependent.title, workId: null, assigneeId: plan.users[1].id, createdById: plan.manager.id }, "DEPENDENT_IDENTITY_CHANGED");
  const fractional = tasks.filter((task) => task.title === plan.fractionalTitle);
  check(fractional.length <= 1, "AMBIGUOUS_FRACTIONAL_TASK");
  const logs = rows("ChangeLog");
  if (fractional.length) {
    sameFields(fractional[0], { workId: plan.work.id, assigneeId: plan.users[0].id, createdById: plan.manager.id }, "FRACTIONAL_IDENTITY_CHANGED");
    check(logs.some((log) => log.entity === "task" && log.entityId === fractional[0].id && log.actorId === plan.manager.id && log.action === "create" && log.newValue?.title === plan.fractionalTitle && log.newValue?.project === plan.project.number), "FRACTIONAL_CREATE_RECEIPT_MISSING");
  }
  const splitReceipts = logs.filter((log) => log.entityId === source.id && log.action === "split");
  check(splitReceipts.length <= 1, "AMBIGUOUS_SPLIT_RECEIPT");
  let child = null;
  let group = null;
  if (splitReceipts.length) {
    const receipt = splitReceipts[0];
    check(receipt.id.startsWith("task-split:") && UUID.test(receipt.id.slice(11)) && receipt.entity === "task" && receipt.actorId === plan.users[0].id && receipt.actorType === "user" && receipt.source === "web", "SPLIT_RECEIPT_ACTOR_INVALID");
    const saved = receipt.newValue;
    check(saved?.recipientId === plan.users[1].id && saved.percent === "30.00" && saved.expectedRevision === 0 && typeof saved.childTaskId === "string" && typeof saved.groupId === "string", "SPLIT_RECEIPT_INVALID");
    child = tasks.find((task) => task.id === saved.childTaskId);
    group = rows("TaskAllocationGroup").find((row) => row.id === saved.groupId);
    check(child && group && child.id !== source.id && group.workId === plan.work.id && group.createdById === receipt.actorId, "SPLIT_RECEIPT_BINDING_INVALID");
    sameFields(child, { title: source.title, workId: plan.work.id, assigneeId: plan.users[1].id, createdById: receipt.actorId, allocationGroupId: group.id }, "SPLIT_CHILD_IDENTITY_CHANGED");
    check(source.allocationGroupId === group.id, "SPLIT_GROUP_LINK_INVALID");
  }
  check(rows("TaskAllocationGroup").length === (group ? 1 : 0), "UNKNOWN_ALLOCATION_GROUP");
  const knownTasks = [source, dependent, ...fractional, ...(child ? [child] : [])];
  check(knownTasks.length === tasks.length && new Set(knownTasks.map((task) => task.id)).size === tasks.length, "UNKNOWN_TASK_REJECTED");
  const taskIds = new Set(knownTasks.map((task) => task.id));
  for (const task of knownTasks) check([null, group?.id].includes(task.allocationGroupId), "UNKNOWN_ALLOCATION_GROUP");
  for (const edge of rows("TaskDependency")) check(taskIds.has(edge.taskId) && taskIds.has(edge.dependsOnId), "FOREIGN_DEPENDENCY_REJECTED");
  for (const timer of rows("TimeEntry")) check(taskIds.has(timer.taskId) && userIds.has(timer.userId), "FOREIGN_TIMER_REJECTED");
  for (const row of rows("PayrollEntry")) check(taskIds.has(row.taskId) && userIds.has(row.userId) && row.projectId === plan.project.id && [null, plan.work.id].includes(row.workId), "FOREIGN_PAYROLL_REJECTED");
  for (const pref of rows("UserPreference")) check(userIds.has(pref.userId) && pref.key === "my.view", "FOREIGN_PREFERENCE_REJECTED");
  for (const log of logs) check(actors.has(log.actorId) && log.actorType === "user" && log.source === "web" && log.entity === "task" && taskIds.has(log.entityId) && ["create", "status", "time", "split"].includes(log.action), "UNKNOWN_CHANGELOG_REJECTED");
  for (const event of rows("DomainEvent")) {
    const p = event.payload;
    check(actors.has(event.actor) && p && taskIds.has(p.taskId), "UNKNOWN_EVENT_REJECTED");
    if (event.type === "task.split") check(child && p.taskId === source.id && p.childTaskId === child.id && p.groupId === group.id && p.recipientId === plan.users[1].id, "UNKNOWN_EVENT_REJECTED");
    else check(["task.assigned", "task.statusChanged"].includes(event.type) && p.projectId === plan.project.id, "UNKNOWN_EVENT_REJECTED");
  }
  const titles = new Set(knownTasks.map((task) => task.title));
  for (const note of rows("Notification")) {
    const personal = userIds.has(note.userId) && note.link === "/my" && (
      (note.type === "task.assigned" && note.body === `Проект ${plan.project.number}` && [...titles].some((title) => note.title === `Вам назначена задача: ${title}` || note.title === `Вам передана часть задачи: ${title}`)) ||
      (note.type === "task.statusChanged" && note.body === `Проект ${plan.project.number}` && [...titles].some((title) => ["выполнена", "в работе"].some((status) => note.title === `Задача «${title}»: ${status}`))));
    const status = note.type === "task.statusChanged" && note.link === `/projects/${plan.project.id}` && rows("DomainEvent").some((event) => {
      if (event.type !== "task.statusChanged" || !["IN_PROGRESS", "DONE"].includes(event.payload?.to)) return false;
      const task = knownTasks.find((task) => task.id === event.payload.taskId);
      return task && note.title === `Задача «${task.title}»: ${event.payload.to === "DONE" ? "выполнена" : "в работе"}` && logs.some((log) =>
        log.entityId === task.id && log.action === "status" && log.actorId === event.actor && log.newValue === event.payload.to &&
        note.body === `Проект ${plan.project.number} · ${log.actorName ?? ""}`);
    });
    const payroll = note.type === "payroll.orgAccrued" && note.link === "/finance/payroll" && rows("PayrollEntry").some((entry) => {
      const user = plan.users.find((user) => user.id === entry.userId);
      const task = knownTasks.find((task) => task.id === entry.taskId);
      return note.body === `Сдельно · ${task.title} · ${plan.project.number}` && note.title === `Начислено ${user.name}: ${formatAmount(entry.amount, entry.currency)}`;
    });
    check(personal || status || payroll, "AMBIGUOUS_NOTIFICATION_REJECTED");
  }
  // Group/Task/Payroll arithmetic is an application result, not an ownership key.
  /** @type {string[]} */
  const diagnostics = [];
  const record = (ok, code) => { if (!ok) diagnostics.push(code); };
  record(amount(rows("Work")[0].quantity) === 10.3 && amount(rows("Work")[0].priceSnapshot) === 100 && amount(rows("Work")[0].total) === 1030, "WORK_BUDGET_MISMATCH");
  if (fractional.length) record(amount(fractional[0].quantity) === 0.3, "FRACTIONAL_QUANTITY_MISMATCH");
  if (group) {
    record(amount(group.quantity) === 10 && amount(group.budget) === 1000 && group.currency === plan.currency, "GROUP_BUDGET_MISMATCH");
    record(amount(source.quantity) === 10 && amount(child.quantity) === 10, "GROUP_QUANTITY_MISMATCH");
    record(source.shareUnits === 700000 && child.shareUnits === 300000 && amount(source.shareAmount) === 700 && amount(child.shareAmount) === 300, "SPLIT_AMOUNTS_MISMATCH");
    record(rows("TaskDependency").some((edge) => edge.taskId === dependent.id && edge.dependsOnId === source.id) && rows("TaskDependency").some((edge) => edge.taskId === dependent.id && edge.dependsOnId === child.id), "DEPENDENT_NOT_BOUND_TO_BOTH_PARTS");
  }
  for (const task of knownTasks) {
    const entries = rows("PayrollEntry").filter((entry) => entry.taskId === task.id);
    const expected = task.id === dependent.id ? 0 : task.id === fractional[0]?.id ? 30 : task.id === child?.id ? 300 : group ? 700 : 1000;
    record(entries.length === (task.status === "DONE" && expected > 0 ? 1 : 0), "PAYROLL_COUNT_MISMATCH");
    for (const entry of entries) record(amount(entry.amount) === expected && entry.currency === plan.currency && entry.scheme === "PIECE" && entry.userId === task.assigneeId, "PAYROLL_VALUE_MISMATCH");
  }
  const keys = {};
  for (const table of OWNED_TABLES) keys[table] = rows(table).map((row) => keysFor(table).map((key) => row[key])).sort((a, b) => canonical(a).localeCompare(canonical(b)));
  return { phase: "PRESENT", keys, tasks: { source: source.id, dependent: dependent.id, fractional: fractional[0]?.id ?? null, child: child?.id ?? null, group: group?.id ?? null }, diagnostics: [...new Set(diagnostics)] };
}

export async function cleanupOwned(adapter, checkpoint, { actionsDrained = false } = {}) {
  check(actionsDrained, "BROWSER_ACTIONS_NOT_DRAINED");
  const plan = validatePlan(checkpoint.plan);
  return adapter.transaction("write", async (tx) => {
    if (tx.guard) await tx.guard(plan.target, plan.schemaHash, plan.currency);
    const records = await tx.candidates(plan);
    const owned = deriveOwnership(plan, records);
    check(equal(await tx.fingerprints(owned.keys), plan.baseline), "FOREIGN_ROWS_CHANGED");
    if (owned.phase === "ABSENT") return { phase: "CLEANED", deleted: {}, scenarioDiagnostics: checkpoint.ownership?.diagnostics ?? [] };
    check(checkpoint.phase === "CAPTURED" && equal(owned.keys, checkpoint.ownership.keys), "CLEANUP_RECEIPT_DRIFT");
    for (const table of ["Notification", "ChangeLog", "DomainEvent", "UserPreference", "PayrollEntry", "TimeEntry", "TaskDependency", "Task", "TaskAllocationGroup", "Work", "Project", "User"]) {
      check(await tx.deleteExact(table, owned.keys[table]) === owned.keys[table].length, "EXACT_DELETE_COUNT_MISMATCH");
    }
    check(equal(await tx.fingerprints({}), plan.baseline), "CLEANUP_POSTCHECK_FAILED");
    return { phase: "CLEANED", deleted: Object.fromEntries(Object.entries(owned.keys).map(([table, keys]) => [table, keys.length])), scenarioDiagnostics: owned.diagnostics };
  });
}

function runtimeTarget(request, options) {
  check(["local", "staging"].includes(request.target), "TARGET_FORBIDDEN");
  // Environment substitution is only a DI boundary for in-memory unit tests.
  const env = options.adapter ? (options.env ?? process.env) : process.env;
  if (request.target === "staging") {
    check(!Object.hasOwn(options, "authSecret") && !Object.hasOwn(request, "authSecret"), "STAGING_SECRET_OVERRIDE_FORBIDDEN");
    check(env.S3_BUCKET === "pero-crm-staging", "STAGING_BUCKET_REQUIRED");
    const url = new URL(env.DATABASE_URL ?? "");
    check(["postgresql:", "postgres:"].includes(url.protocol) && url.hash === "", "STAGING_URL_INVALID");
    check(url.hostname === "db" && url.pathname === "/crm" && url.username === "crm" && (!url.port || url.port === "5432"), "STAGING_DATABASE_REQUIRED");
    const optionKeys = [...url.searchParams.keys()];
    check(new Set(optionKeys).size === optionKeys.length && optionKeys.every((key) => ["schema", "connection_limit", "pool_timeout", "connect_timeout", "socket_timeout", "sslmode"].includes(key)), "DATABASE_OPTIONS_FORBIDDEN");
    check(!url.searchParams.has("schema") || url.searchParams.get("schema") === "public", "STAGING_SCHEMA_REQUIRED");
    return { binding: { kind: "EXISTING_STAGING", database: "crm", username: "crm", bucket: "pero-crm-staging" }, datasourceUrl: url.href, secret: env.AUTH_SECRET };
  }
  check(env.CRM_LOCAL_CONTAINER_ID === LOCAL_CONTAINER_ID, "LOCAL_CONTAINER_ACK_REQUIRED");
  const inspected = options.adapter ? options.localContainer : JSON.parse(execFileSync("docker", ["--context", "desktop-linux", "inspect", "pero_crm_pg"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }))[0];
  check(inspected?.Id === LOCAL_CONTAINER_ID && inspected.Name === "/pero_crm_pg" && inspected.State?.Running === true, "LOCAL_CONTAINER_MISMATCH");
  check(equal(inspected.HostConfig?.PortBindings?.["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: "5433" }]), "LOCAL_BINDING_MISMATCH");
  check(inspected.Mounts?.some((m) => m.Type === "volume" && m.Name === "pero_crm_v2_pgdata" && m.Destination === "/var/lib/postgresql/data"), "LOCAL_VOLUME_MISMATCH");
  const settings = Object.fromEntries(inspected.Config.Env.map((value) => { const at = value.indexOf("="); return [value.slice(0, at), value.slice(at + 1)]; }));
  check(settings.POSTGRES_DB === "pero_crm" && settings.POSTGRES_USER === "pero" && settings.POSTGRES_PASSWORD, "LOCAL_DATABASE_MISMATCH");
  const url = new URL("postgresql://127.0.0.1:5433/pero_crm");
  url.username = settings.POSTGRES_USER; url.password = settings.POSTGRES_PASSWORD;
  return { binding: { kind: "EXISTING_LOCAL", database: "pero_crm", username: "pero", container: LOCAL_CONTAINER_ID, volume: "pero_crm_v2_pgdata" }, datasourceUrl: url.href, secret: options.authSecret ?? env.AUTH_SECRET };
}

function predicate(table, keys, start = 1) {
  check(TABLES.includes(table), "TABLE_NOT_ALLOWED");
  const columns = keysFor(table);
  const values = [];
  const clauses = keys.map((key) => {
    check(Array.isArray(key) && key.length === columns.length && key.every((value) => typeof value === "string"), "EXACT_KEY_INVALID");
    return `(${columns.map((column, index) => { values.push(key[index]); return `"${column}"=$${start + values.length - 1}`; }).join(" AND ")})`;
  });
  return { sql: clauses.length ? clauses.join(" OR ") : "FALSE", values };
}

async function createPrismaAdapter(target) {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: target.datasourceUrl, log: [] });
  return {
    close: () => db.$disconnect(),
    transaction: (mode, operation) => db.$transaction(async (database) => {
      await database.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
      await database.$executeRawUnsafe("SET LOCAL statement_timeout='30s'");
      if (mode === "read") await database.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const [identity] = await database.$queryRawUnsafe("SELECT current_database() AS database,current_user AS username,current_schema() AS schema");
      check(identity.database === target.binding.database && identity.username === target.binding.username && identity.schema === "public", "DATABASE_IDENTITY_MISMATCH");
      const [migration] = await database.$queryRawUnsafe('SELECT count(*)::int AS count FROM public."_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL', REQUIRED_MIGRATION);
      check(migration.count === 1, "REQUIRED_MIGRATION_NOT_APPLIED");
      if (mode === "write") {
        // Short QA-only write window. Locks prevent FK cascades/concurrent changes
        // from invalidating the foreign-row pre/post checks. No production target.
        await database.$queryRawUnsafe("SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)");
        await database.$executeRawUnsafe(`LOCK TABLE ${TABLES.map((table) => `public."${table}"`).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
      }
      const sqlRows = async (table, where = "TRUE", values = []) => {
        check(TABLES.includes(table), "TABLE_NOT_ALLOWED");
        return (await database.$queryRawUnsafe(`SELECT to_jsonb(t) AS row FROM public."${table}" t WHERE ${where}`, ...values)).map((result) => result.row);
      };
      const tx = {
        guard: async (binding, schemaHash, currency) => {
          check(identity.database === binding.database && identity.username === binding.username, "DATABASE_IDENTITY_MISMATCH");
          const catalog = await database.$queryRawUnsafe("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'_prisma_migrations' ORDER BY table_name");
          check(equal(catalog.map((row) => row.table_name).sort(), [...TABLES].sort()), "UNKNOWN_SCHEMA_TABLES");
          const [schema] = await database.$queryRawUnsafe("SELECT md5(string_agg(concat_ws(':',table_name,column_name,data_type,udt_name,is_nullable,coalesce(column_default,'')),'' ORDER BY table_name,ordinal_position)) AS hash FROM information_schema.columns WHERE table_schema='public'");
          if (schemaHash) check(schema.hash === schemaHash, "SCHEMA_CHANGED");
          const settings = await database.$queryRawUnsafe('SELECT value FROM public."OrgSetting" WHERE key=\'payrollCurrency\'');
          const currentCurrency = settings[0]?.value ?? "BYN";
          check(["BYN", "RUB", "USD", "EUR"].includes(currentCurrency), "PAYROLL_CURRENCY_UNSUPPORTED");
          if (currency) check(currency === currentCurrency, "PAYROLL_CURRENCY_CHANGED");
          // Registry inspected: file-stages 0.1.0 has no hooks. demo does have a
          // hook and writes PluginRunLog without eventId, so it is not admissible.
          const plugins = await database.$queryRawUnsafe('SELECT id,version,"apiVersion" FROM public."Plugin" WHERE enabled=true ORDER BY id');
          check(plugins.every((plugin) => plugin.id === "file-stages" && plugin.version === "0.1.0" && plugin.apiVersion === 1), "UNATTRIBUTABLE_PLUGIN_HOOKS");
          return { schemaHash: schema.hash, currency: currentCurrency };
        },
        references: async () => {
          const [manager] = await database.$queryRawUnsafe('SELECT id,roles::text[] AS roles,"sessionVersion" FROM public."User" WHERE active=true AND \'MANAGER\'=ANY(roles) ORDER BY id LIMIT 1');
          const [client] = await database.$queryRawUnsafe('SELECT id FROM public."Client" ORDER BY id LIMIT 1');
          const [priceItem] = await database.$queryRawUnsafe('SELECT id FROM public."PriceItem" WHERE active=true ORDER BY id LIMIT 1');
          const [outstanding] = await database.$queryRawUnsafe('SELECT count(*)::int AS count FROM public."User" WHERE position=$1', "LOCAL QA universal-work-shares");
          check(outstanding.count === 0, "EXISTING_QA_RUN_PRESENT");
          check(manager && client, "EXISTING_REFERENCES_REQUIRED");
          return { manager, clientId: client.id, priceItemId: priceItem?.id ?? null };
        },
        fingerprints: async (excluded) => {
          const result = {};
          for (const table of TABLES) {
            const filter = predicate(table, excluded[table] ?? []);
            // Hash User rows server-side: no real email/passwordHash is returned.
            // Plugin startup metadata is intentionally excluded; IDs/enabled and
            // all PluginSetting rows remain protected by the snapshot.
            // API recordUse changes only lastUsedAt during ordinary requests.
            // Subtract that one field; token identity, security fields and count stay protected.
            const json = table === "Plugin" ? "jsonb_build_object('id',t.id,'enabled',t.enabled)"
              : "to_jsonb(t)" + fingerprintOmittedColumns(table).map((column) => ` - '${column}'`).join("");
            const order = keysFor(table).map((key) => `t."${key}"`).join(",");
            const [summary] = await database.$queryRawUnsafe(`SELECT count(*)::int AS count, md5(coalesce(string_agg(md5((${json})::text),'' ORDER BY ${order}),'')) AS hash FROM public."${table}" t WHERE NOT (${filter.sql})`, ...filter.values);
            result[table] = summary;
          }
          return result;
        },
        candidates: async (plan) => {
          const users = plan.users.map((user) => user.id);
          const owned = {};
          owned.User = await sqlRows("User", 'id=ANY($1::text[])', [users]);
          owned.Project = await sqlRows("Project", 'id=$1 OR "managerId"=ANY($2::text[]) OR "createdById"=ANY($2::text[])', [plan.project.id, users]);
          owned.Work = await sqlRows("Work", 'id=$1 OR "projectId"=$2 OR "createdById"=ANY($3::text[])', [plan.work.id, plan.project.id, users]);
          owned.TaskAllocationGroup = await sqlRows("TaskAllocationGroup", '"workId"=$1 OR "createdById"=ANY($2::text[])', [plan.work.id, users]);
          const groups = owned.TaskAllocationGroup.map((group) => group.id);
          owned.Task = await sqlRows("Task", 'id=ANY($1::text[]) OR "projectId"=$2 OR "workId"=$3 OR "assigneeId"=ANY($4::text[]) OR "createdById"=ANY($4::text[]) OR "allocationGroupId"=ANY($5::text[])', [[plan.source.id, plan.dependent.id], plan.project.id, plan.work.id, users, groups]);
          const tasks = [...new Set([plan.source.id, plan.dependent.id, ...owned.Task.map((task) => task.id)])];
          owned.TaskDependency = await sqlRows("TaskDependency", '"taskId"=ANY($1::text[]) OR "dependsOnId"=ANY($1::text[])', [tasks]);
          owned.TimeEntry = await sqlRows("TimeEntry", '"taskId"=ANY($1::text[]) OR "userId"=ANY($2::text[])', [tasks, users]);
          owned.PayrollEntry = await sqlRows("PayrollEntry", '"taskId"=ANY($1::text[]) OR "userId"=ANY($2::text[]) OR "projectId"=$3 OR "workId"=$4', [tasks, users, plan.project.id, plan.work.id]);
          owned.UserPreference = await sqlRows("UserPreference", '"userId"=ANY($1::text[])', [users]);
          owned.ChangeLog = await sqlRows("ChangeLog", '"entityId"=ANY($1::text[]) OR "actorId"=ANY($2::text[]) OR "newValue"->>\'project\'=$3', [[...tasks, plan.project.id, plan.work.id, ...groups, ...users], users, plan.project.number]);
          owned.DomainEvent = await sqlRows("DomainEvent", 'actor=ANY($1::text[]) OR payload->>\'taskId\'=ANY($2::text[]) OR payload->>\'projectId\'=$3 OR payload->>\'childTaskId\'=ANY($2::text[])', [users, tasks, plan.project.id]);
          const bodies = [plan.source.title, plan.dependent.title, plan.fractionalTitle].map((title) => `Сдельно · ${title} · ${plan.project.number}`);
          owned.Notification = await sqlRows("Notification", '"userId"=ANY($1::text[]) OR link=$2 OR body=ANY($3::text[])', [users, `/projects/${plan.project.id}`, bodies]);
          return owned;
        },
        insertPlan: async (plan) => {
          for (const user of plan.users) await database.$executeRawUnsafe('INSERT INTO public."User" (id,email,name,"passwordHash",roles,"payScheme","sessionVersion",active,position,"updatedAt") VALUES ($1,$2,$3,$4,ARRAY[$5]::public."Role"[],\'PIECE\',0,true,$6,now())', user.id, user.email, user.name, user.passwordHash, user.roles[0], user.position);
          const p = plan.project;
          await database.$executeRawUnsafe('INSERT INTO public."Project" (id,number,"numberInt",title,"clientId","managerId","createdById",currency,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$6,$7,now())', p.id, p.number, p.numberInt, p.title, p.clientId, p.managerId, p.currency);
          await database.$executeRawUnsafe('INSERT INTO public."Work" (id,"projectId","priceItemId",title,quantity,"priceSnapshot",total,"createdById") VALUES ($1,$2,$3,$4,10.30,100,1030,$5)', plan.work.id, p.id, plan.work.priceItemId, plan.work.title, plan.manager.id);
          for (const [index, task] of [plan.source, plan.dependent].entries()) await database.$executeRawUnsafe('INSERT INTO public."Task" (id,"projectId",title,type,status,"assigneeId","workId",quantity,"requiresPhoto","estimateMinutes","createdById","dueAt","updatedAt") VALUES ($1,$2,$3,$4,\'NEW\',$5,$6,$7::numeric,false,$8,$9,$10::timestamp,now())', task.id, p.id, task.title, plan.taskType, plan.users[index].id, index === 0 ? plan.work.id : null, index === 0 ? "10.00" : null, index === 0 ? 10 : 1, plan.manager.id, plan.dueAt);
          await database.$executeRawUnsafe('INSERT INTO public."TaskDependency" ("taskId","dependsOnId") VALUES ($1,$2)', plan.dependent.id, plan.source.id);
        },
        deleteExact: async (table, keys) => {
          check(OWNED_TABLES.includes(table), "DELETE_TABLE_FORBIDDEN");
          const where = predicate(table, keys);
          return database.$executeRawUnsafe(`DELETE FROM public."${table}" WHERE ${where.sql}`, ...where.values);
        },
      };
      return operation(tx);
    // ReadCommitted takes a fresh snapshot AFTER waiting for the writer locks;
    // those locks keep every protected table stable until the postcheck/commit.
    }, { isolationLevel: mode === "write" ? "ReadCommitted" : "RepeatableRead", maxWait: 5000, timeout: 60000 }),
  };
}

function observations(plan, records, owned) {
  const taskRows = records.Task ?? [];
  const payrollRows = records.PayrollEntry ?? [];
  return {
    taskCount: taskRows.length, groupCount: (records.TaskAllocationGroup ?? []).length,
    dataChecks: owned.diagnostics.length ? "FAIL" : "PASS", diagnostics: owned.diagnostics,
    settlementComplete: Boolean(owned.tasks.child && owned.tasks.fractional && [owned.tasks.source, owned.tasks.child, owned.tasks.fractional].every((id) => taskRows.find((task) => task.id === id)?.status === "DONE")),
    tasks: Object.fromEntries(Object.entries(owned.tasks).filter(([name]) => name !== "group").map(([name, id]) => {
      const row = taskRows.find((task) => task.id === id);
      return [name, row ? { id, status: row.status, quantity: row.quantity, shareAmount: row.shareAmount, shareUnits: row.shareUnits,
        payroll: payrollRows.filter((entry) => entry.taskId === id).map((entry) => ({ id: entry.id, amount: entry.amount, currency: entry.currency })) } : null];
    })), currency: plan.currency, browserAssertions: "NOT_RUN_BY_HELPER",
  };
}

/** Root-only transport: privatePayload must never be printed to a user-visible log.
 * @param {Record<string, unknown>} request
 * @param {Record<string, unknown>} options
 */
export async function executeOwnedQa(request, options = {}) {
  let adapter;
  let ownsAdapter = false;
  try {
    check(["plan", "prepare", "capture", "inspect", "cleanup", "sessions"].includes(request.operation), "OPERATION_FORBIDDEN");
    const target = runtimeTarget(request, options);
    check(typeof target.secret === "string" && target.secret.length >= 32, "SIGNING_SECRET_REQUIRED");
    let checkpoint;
    if (request.operation !== "plan") {
      checkpoint = openEnvelope(request.envelope, target.secret);
      validatePlan(checkpoint.plan);
      check(equal(checkpoint.plan.target, target.binding), "MANIFEST_TARGET_MISMATCH");
    } else check(!request.envelope, "ACTIVE_PLAN_MUST_NOT_BE_REPLACED");
    if (request.operation === "prepare") check(checkpoint.phase === "PLANNED" && request.durablePlanSha256 === envelopeSha256(request.envelope), "DURABLE_PLAN_READBACK_REQUIRED");
    if (request.operation === "cleanup") check(request.durableCheckpointSha256 === envelopeSha256(request.envelope), "DURABLE_CAPTURE_READBACK_REQUIRED");
    adapter = options.adapter ?? await createPrismaAdapter(target);
    ownsAdapter = !options.adapter;
    if (request.operation === "cleanup") {
      const cleanup = await cleanupOwned(adapter, checkpoint, { actionsDrained: request.actionsDrained === true });
      const envelope = sealEnvelope({ ...checkpoint, phase: "CLEANED", cleanup }, target.secret);
      return { publicSummary: { status: "PASS", operation: "cleanup", runId: checkpoint.plan.runId, ...cleanup }, privatePayload: { envelope } };
    }
    if (request.operation === "plan") {
      const plan = await adapter.transaction("read", async (tx) => {
        const facts = await tx.guard(target.binding);
        const refs = await tx.references();
        const runId = randomUUID();
        const now = new Date();
        const users = [];
        for (const role of ["WORKER", "MOUNTER"]) {
          const password = randomBytes(64);
          let passwordHash;
          try { passwordHash = options.adapter && options.hashPassword ? await options.hashPassword(password) : await (await import("@node-rs/argon2")).hash(password); }
          finally { password.fill(0); }
          users.push({ id: randomUUID(), name: `LOCAL QA ${runId} ${role}`, email: `work-shares-${runId}-${role.toLowerCase()}@qa.invalid`, passwordHash,
            roles: [role], payScheme: "PIECE", active: true, sessionVersion: 0, position: "LOCAL QA universal-work-shares",
            phone: null, telegram: null, payPercent: null, legacyId: null, legacyTable: null });
        }
        return { version: 1, runId, target: target.binding, migration: REQUIRED_MIGRATION, schemaHash: facts.schemaHash,
          currency: facts.currency, manager: refs.manager, users, limits: { tasks: 4, groups: 1 },
          project: { id: randomUUID(), number: `LOCAL-QA-${runId}`, numberInt: -2000000000, title: `LOCAL QA ${runId} — universal work shares`, clientId: refs.clientId, managerId: refs.manager.id, createdById: refs.manager.id, currency: facts.currency, stage: "LEAD" },
          work: { id: randomUUID(), title: `LOCAL QA ${runId} Work 10.30 × 100`, priceItemId: refs.priceItemId },
          source: { id: randomUUID(), title: `LOCAL QA ${runId} SourceTaskA` }, dependent: { id: randomUUID(), title: `LOCAL QA ${runId} DependentTaskB` },
          fractionalTitle: `LOCAL QA ${runId} FractionalTaskC`, taskType: `LOCAL QA ${runId}`, dueAt: new Date(now.getTime() + 86400000).toISOString(),
          baseline: await tx.fingerprints({}) };
      });
      validatePlan(plan);
      const envelope = sealEnvelope({ phase: "PLANNED", plan }, target.secret);
      return { publicSummary: { status: "PASS", operation: "plan", runId: plan.runId, persisted: false, plannedEntities: 6 }, privatePayload: { envelope, canonicalUtf8: canonicalEnvelope(envelope), sha256: envelopeSha256(envelope) } };
    }
    const result = await adapter.transaction(request.operation === "prepare" ? "write" : "read", async (tx) => {
      const plan = checkpoint.plan;
      await tx.guard(target.binding, plan.schemaHash, plan.currency);
      let records = await tx.candidates(plan);
      let owned = deriveOwnership(plan, records);
      check(equal(await tx.fingerprints(owned.keys), plan.baseline), "FOREIGN_ROWS_CHANGED");
      if (request.operation === "prepare") {
        check(owned.phase === "ABSENT", "PREPARE_ALREADY_PRESENT_USE_INSPECT");
        await tx.insertPlan(plan);
        records = await tx.candidates(plan);
        owned = deriveOwnership(plan, records);
        check(owned.phase === "PRESENT" && equal(await tx.fingerprints(owned.keys), plan.baseline), "PREPARE_POSTCHECK_FAILED");
      }
      return { plan, records, owned };
    });
    if (request.operation === "sessions") {
      check(result.owned.phase === "PRESENT", "SESSIONS_REQUIRE_PREPARED_ROWS");
      const origin = new URL(request.baseUrl);
      check(target.binding.kind === "EXISTING_STAGING" ? origin.origin === "https://staging-crm.peromebel.by" : origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname), "SESSION_ORIGIN_FORBIDDEN");
      const cookieName = origin.protocol === "https:" ? "__Secure-authjs.session-token" : "authjs.session-token";
      const { encode } = await import("@auth/core/jwt");
      const actors = [result.plan.manager, ...result.plan.users];
      const sessions = await Promise.all(actors.map(async (actor, index) => ({ role: ["manager", "worker", "mounter"][index], userId: actor.id,
        cookie: { name: cookieName, value: await encode({ token: { id: actor.id, roles: actor.roles, sessionVersion: actor.sessionVersion }, secret: target.secret, salt: cookieName, maxAge: 900 }),
          domain: origin.hostname, path: "/", httpOnly: true, secure: origin.protocol === "https:", sameSite: "Lax" } })));
      return { publicSummary: { status: "PASS", operation: "sessions", runId: result.plan.runId, count: 3, ttlSeconds: 900, passwordLogin: "NOT_TESTED" }, privatePayload: { sessions } };
    }
    const phase = result.owned.phase === "ABSENT" ? "ABSENT" : request.operation === "capture" ? "CAPTURED" : "PREPARED";
    const observed = observations(result.plan, result.records, result.owned);
    const envelope = sealEnvelope({ plan: result.plan, phase, ownership: result.owned, observations: observed }, target.secret);
    return { publicSummary: { status: "PASS", operation: request.operation, runId: result.plan.runId, phase, dataChecks: observed.dataChecks, diagnostics: observed.diagnostics, settlementComplete: observed.settlementComplete, taskCount: observed.taskCount }, privatePayload: { envelope, canonicalUtf8: canonicalEnvelope(envelope), sha256: envelopeSha256(envelope), observations: observed } };
  } catch (error) {
    return { publicSummary: { status: "STOP", code: error instanceof QaStop ? error.code : "QA_OPERATION_FAILED" }, privatePayload: null };
  } finally {
    if (ownsAdapter) {
      try { await adapter.close(); }
      catch { throw new QaStop("DISCONNECT_FAILED_INSPECT_OUTCOME"); }
    }
  }
}
