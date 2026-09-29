/** Opt-in composition QA library. Import performs no I/O, connection or write. */
import { createHash } from "node:crypto";

const FORMAT = "pero-composition-owned-qa/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const LOCAL = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const STAGE = "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a";
const REQUIRED_TABLES = ["User", "Client", "Project", "Product", "Task", "ProductCompositionRevision", "ProductCompositionItem", "ChangeLog"];
const OWNED_TABLES = ["User", "Project", "Product", "Task", "ProductCompositionRevision", "ProductCompositionItem", "ChangeLog", "UserPreference"];
const TRIGGERS = [["ProductCompositionRevision", "ProductCompositionRevision_guard", "guard_product_composition_revision"],
  ["ProductCompositionItem", "ProductCompositionItem_guard", "guard_product_composition_item"]];
const sha = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const same = (left, right) => canonical(left) === canonical(right);

export class CompositionQaStop extends Error {
  constructor(code) { super(code); this.name = "CompositionQaStop"; this.code = code; }
}
function check(ok, code) { if (!ok) throw new CompositionQaStop(code); }
function validId(value) { return typeof value === "string" && UUID.test(value); }
function utcTimestamp(value) {
  if (typeof value !== "string") return null;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(zoned);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function key(table, row) { return table === "UserPreference" ? `${row.userId}|${row.key}` : row.id; }
function plainManifest(manifest) { const value = { ...manifest }; delete value.manifestHash; return value; }

export function assertCompositionQaTarget(target) {
  check(target && typeof target === "object", "TARGET_MISSING");
  if (target.kind === "EXISTING_LOCAL")
    check(target.containerId === LOCAL && target.host === "127.0.0.1" && target.port === 5433 && target.database === "pero_crm" &&
      Object.keys(target).length === 5, "TARGET_FORBIDDEN");
  else if (target.kind === "EXISTING_STAGING")
    check(target.containerId === STAGE && target.guest === "crm-staging" && target.host === "db" && target.port === 5432 &&
      target.database === "crm" && Object.keys(target).length === 6, "TARGET_FORBIDDEN");
  else throw new CompositionQaStop("TARGET_FORBIDDEN");
  return target;
}

export function validateCompositionQaPlan(plan) {
  check(plan?.format === FORMAT && validId(plan.runId), "PLAN_INVALID");
  assertCompositionQaTarget(plan.target);
  const ids = [plan.project?.id, plan.product?.id, plan.task?.id, ...(plan.users ?? []).map((user) => user.id)];
  check(ids.length === 6 && ids.every(validId) && new Set(ids).size === 6, "PLANNED_IDS_INVALID");
  check(plan.users.length === 3 && same(plan.users.map((user) => user.roles), [["MANAGER"], ["ENGINEER"], ["WORKER"]]) &&
    plan.users.every((user) => user.active === true && user.payScheme === "NONE" && user.name?.includes(plan.runId) &&
      user.email?.includes(plan.runId) && user.email.endsWith(".invalid") && user.passwordHash?.startsWith("$argon2")), "QA_USERS_INVALID");
  check(plan.project.managerId === plan.users[0].id && plan.product.engineerId === plan.users[1].id &&
    plan.product.projectId === plan.project.id && plan.project.number === `QA-COMP-${plan.runId}` &&
    plan.product.number === `${plan.project.number}-1` && plan.project.title.includes(plan.runId) &&
    plan.product.title.includes(plan.runId) && plan.project.currency === "BYN" && plan.product.status === "DESIGN" &&
    typeof plan.project.clientId === "string" && plan.project.clientId.length > 0 &&
    Number.isInteger(plan.project.numberInt) && plan.project.numberInt < 0 && plan.project.numberInt >= -2147483648,
  "QA_CONTEXT_INVALID");
  check(plan.task.projectId === plan.project.id && plan.task.productId === plan.product.id &&
    plan.task.assigneeId === plan.users[2].id && plan.task.createdById === plan.users[0].id &&
    plan.task.title === `QA ${plan.runId} composition read` && plan.task.type === "Проверка состава" &&
    plan.task.status === "NEW" && plan.task.workId === null &&
    plan.task.dueAt === "2035-01-01T00:00:00.000Z" && plan.task.estimateMinutes === 30, "QA_TASK_INVALID");
  check(plan.baseline && Array.isArray(plan.baseline.tableNames) && REQUIRED_TABLES.every((name) => plan.baseline.tableNames.includes(name)) &&
    new Set(plan.baseline.tableNames).size === plan.baseline.tableNames.length &&
    plan.baseline.tableNames.every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && HASH.test(plan.baseline.hashes?.[name] ?? "")),
  "BASELINE_INVALID");
  return plan;
}

export function publicCompositionQaPlan(plan) {
  return { format: FORMAT, runId: plan.runId, target: plan.target, baseline: plan.baseline,
    ids: { project: plan.project.id, product: plan.product.id, task: plan.task.id, users: plan.users.map((user) => user.id) },
    project: { id: plan.project.id, number: plan.project.number, numberInt: plan.project.numberInt, title: plan.project.title,
      clientId: plan.project.clientId, managerId: plan.project.managerId, currency: plan.project.currency },
    product: { id: plan.product.id, projectId: plan.product.projectId, number: plan.product.number, title: plan.product.title,
      engineerId: plan.product.engineerId, status: plan.product.status },
    task: { ...plan.task },
    users: plan.users.map(({ id, name, email, roles, payScheme, active, passwordHash }) => ({ id, name, email,
      roles, payScheme, active, passwordDigest: sha(passwordHash) })) };
}
export function compositionPlanSha256(plan) { validateCompositionQaPlan(plan); return sha(canonical(publicCompositionQaPlan(plan))); }

export function compositionFingerprints(snapshot, excluded = {}) {
  const names = [...snapshot.tableNames].sort();
  check(new Set(names).size === names.length && names.every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)), "TABLE_SET_INVALID");
  check(same(Object.keys(snapshot.rows).sort(), names) && names.every((name) => Array.isArray(snapshot.rows[name])), "TABLE_SET_INVALID");
  return { tableNames: names, hashes: Object.fromEntries(names.map((name) => {
    check(snapshot.rows[name].every((row) => typeof row.__raw === "string"), "RAW_ROW_REQUIRED");
    const owned = new Set(excluded[name] ?? []);
    const raw = snapshot.rows[name].filter((row) => !owned.has(key(name, row)))
      .map((row) => row.__raw).sort();
    return [name, sha(raw.join("\n") + "\n")];
  })) };
}

export async function readCompositionQaSnapshot(db) {
  const tables = await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const tableNames = tables.map((row) => row.tablename);
  check(REQUIRED_TABLES.every((name) => tableNames.includes(name)) &&
    tableNames.every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)), "TABLE_SET_INVALID");
  const rows = {};
  for (const name of tableNames) {
    const records = await db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS raw FROM public."${name}" t`);
    rows[name] = records.map(({ raw }) => {
      check(typeof raw === "string", "SNAPSHOT_INVALID");
      const row = JSON.parse(raw);
      Object.defineProperty(row, "__raw", { value: raw, enumerable: false });
      return row;
    });
  }
  return { tableNames, rows };
}

export async function baselineCompositionQa(db, target) {
  assertCompositionQaTarget(target);
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return compositionFingerprints(await readCompositionQaSnapshot(tx));
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 120000 });
}

function graph(snapshot, input) {
  const plan = input.manifestHash ? verifiedManifest(input) : publicCompositionQaPlan(validateCompositionQaPlan(input));
  check(same([...snapshot.tableNames].sort(), plan.baseline.tableNames), "TABLE_SET_DRIFT");
  const rows = (table) => snapshot.rows[table] ?? [];
  const ids = new Set(plan.users.map((user) => user.id));
  const users = rows("User").filter((row) => ids.has(row.id));
  const project = rows("Project").filter((row) => row.id === plan.project.id);
  const product = rows("Product").filter((row) => row.id === plan.product.id);
  const task = rows("Task").filter((row) => row.id === plan.task.id);
  check(users.length === 3 && project.length === 1 && product.length === 1 && task.length === 1 &&
    users.every((row) => {
      const expected = plan.users.find((user) => user.id === row.id);
      return expected && row.name === expected.name && row.email === expected.email && same(row.roles, expected.roles) &&
        row.payScheme === expected.payScheme && row.active === expected.active && sha(row.passwordHash ?? "") === expected.passwordDigest;
    }) && project[0].number === plan.project.number && project[0].clientId === plan.project.clientId &&
    project[0].managerId === plan.project.managerId && product[0].number === plan.product.number &&
    product[0].projectId === plan.project.id && product[0].engineerId === plan.product.engineerId &&
    task[0].projectId === plan.project.id && task[0].productId === plan.product.id &&
    task[0].assigneeId === plan.users[2].id && task[0].createdById === plan.users[0].id &&
    task[0].title === plan.task.title && task[0].type === plan.task.type && task[0].status === "NEW" &&
    task[0].workId === null && utcTimestamp(task[0].dueAt) === plan.task.dueAt && task[0].estimateMinutes === 30 &&
    task[0].quantity === null && task[0].allocationGroupId === null && task[0].doneAt === null,
  "QA_IDENTITY_DRIFT");
  const revisions = rows("ProductCompositionRevision").filter((row) => row.productId === plan.product.id);
  check(revisions.length <= 3 && revisions.filter((row) => row.status === "DRAFT").length <= 1 &&
    revisions.every((row) => ["DRAFT", "CONFIRMED"].includes(row.status) &&
      ids.has(row.createdById) && row.createdById !== plan.users[2].id &&
      (!row.confirmedById || ids.has(row.confirmedById) && row.confirmedById !== plan.users[2].id)), "REVISION_GRAPH_UNKNOWN");
  const confirmed = revisions.filter((row) => row.status === "CONFIRMED").sort((a, b) => a.revisionNo - b.revisionNo);
  check(confirmed.length <= 2 && confirmed.every((row, index) => row.revisionNo === index + 1) &&
    revisions.every((row) => row.baseRevisionId === null || confirmed.some((base) => base.id === row.baseRevisionId)),
  "REVISION_SEQUENCE_UNKNOWN");
  const revisionIds = new Set(revisions.map((row) => row.id));
  const items = rows("ProductCompositionItem").filter((row) => revisionIds.has(row.revisionId));
  check(items.length <= 12, "ITEM_LIMIT_EXCEEDED");
  const depth = new Map();
  const effective = new Map();
  for (const revision of revisions) {
    const own = items.filter((row) => row.revisionId === revision.id);
    const byId = new Map(own.map((row) => [row.id, row]));
    const codes = new Set(), lineages = new Set();
    for (const row of own) {
      check(["MODULE", "PART", "HARDWARE"].includes(row.kind) && Number.isInteger(row.quantityPerParent) &&
        row.quantityPerParent >= 1 && row.quantityPerParent <= 1000000 && typeof row.travelsToInstallation === "boolean" &&
        typeof row.designation === "string" && row.designation.trim() && typeof row.title === "string" && row.title.trim() &&
        row.normalizedDesignation === row.designation.normalize("NFKC").trim().toUpperCase() &&
        typeof row.lineageId === "string" && row.lineageId.length > 0 &&
        !codes.has(row.normalizedDesignation) && !lineages.has(row.lineageId), "ITEM_GRAPH_UNKNOWN");
      codes.add(row.normalizedDesignation); lineages.add(row.lineageId);
    }
    const visiting = new Set();
    function visit(row) {
      if (visiting.has(row.id)) throw new CompositionQaStop("ITEM_CYCLE");
      if (depth.has(row.id)) return { level: depth.get(row.id), quantity: effective.get(row.id) };
      visiting.add(row.id);
      const parent = row.parentId ? byId.get(row.parentId) : null;
      check(!row.parentId || parent?.kind === "MODULE", "ITEM_PARENT_UNKNOWN");
      const parentResult = parent ? visit(parent) : null;
      const level = parentResult ? parentResult.level + 1 : 1;
      const quantity = BigInt(row.quantityPerParent) * (parentResult?.quantity ?? 1n);
      check(level <= 16 && quantity <= 2147483647n, "ITEM_DEPTH_OR_COUNT_UNKNOWN");
      visiting.delete(row.id); depth.set(row.id, level); effective.set(row.id, quantity);
      return { level, quantity };
    }
    for (const row of own) visit(row);
  }
  const itemIds = new Set(items.map((row) => row.id));
  const logs = rows("ChangeLog").filter((row) => row.entity === "productComposition" &&
    (revisionIds.has(row.entityId) || itemIds.has(row.entityId) || row.newValue?.productId === plan.product.id));
  const discardedIds = new Set(logs.filter((row) => row.action === "draft.discard").map((row) => row.entityId));
  const knownRevisionIds = new Set([...revisionIds, ...discardedIds]);
  const liveItemRevision = new Map(items.map((row) => [row.id, row.revisionId]));
  const deletionReceipts = logs.filter((row) => row.action === "item.delete" || row.action === "draft.discard");
  check(deletionReceipts.every((row) => Number.isSafeInteger(row.action === "item.delete" ? row.newValue?.count : row.newValue?.deletedItems) &&
    (row.action === "item.delete" ? row.newValue.count >= 1 : row.newValue.deletedItems >= 0)), "CHANGELOG_GRAPH_UNKNOWN");
  const missingByRevision = new Map();
  for (const row of logs.filter((entry) => entry.action.startsWith("item.") && !itemIds.has(entry.entityId))) {
    const revisionId = row.newValue?.revisionId;
    if (!missingByRevision.has(revisionId)) missingByRevision.set(revisionId, new Set());
    missingByRevision.get(revisionId).add(row.entityId);
  }
  const deletionBudget = new Map([...knownRevisionIds].map((id) => [id, 0]));
  for (const row of deletionReceipts) {
    const revisionId = row.action === "item.delete" ? row.newValue.revisionId : row.entityId;
    deletionBudget.set(revisionId, (deletionBudget.get(revisionId) ?? 0) +
      (row.action === "item.delete" ? row.newValue.count : row.newValue.deletedItems));
  }
  check(logs.every((row) => ids.has(row.actorId) && row.actorId !== plan.users[2].id && row.actorType === "user" && row.source === "web" &&
    row.newValue?.productId === plan.product.id &&
    ["draft.create", "draft.discard", "item.create", "item.update", "item.delete", "revision.confirm"].includes(row.action) &&
    (row.action.startsWith("item.") ? knownRevisionIds.has(row.newValue?.revisionId)
      : row.action === "revision.confirm" ? revisionIds.has(row.entityId)
        : knownRevisionIds.has(row.entityId))) &&
    logs.every((row) => !row.action.startsWith("item.") ||
      (row.action !== "item.delete" || !itemIds.has(row.entityId)) &&
      (!itemIds.has(row.entityId) || liveItemRevision.get(row.entityId) === row.newValue?.revisionId)) &&
    [...missingByRevision].every(([revisionId, missingIds]) => knownRevisionIds.has(revisionId) &&
      missingIds.size <= (deletionBudget.get(revisionId) ?? 0)) &&
    logs.every((row) => row.action !== "draft.discard" || !revisionIds.has(row.entityId)) &&
    [...discardedIds].every((id) => logs.some((row) => row.entityId === id && row.action === "draft.create")) &&
    revisions.every((row) => logs.some((log) => log.entityId === row.id && log.action === "draft.create") &&
      (row.status !== "CONFIRMED" || logs.some((log) => log.entityId === row.id && log.action === "revision.confirm"))),
  "CHANGELOG_GRAPH_UNKNOWN");
  const deletedCount = deletionReceipts.reduce((sum, row) => sum + (row.action === "item.delete" ? row.newValue.count : row.newValue.deletedItems), 0);
  check(revisions.length + discardedIds.size <= 4 && items.length + deletedCount <= 12, "QA_LIFETIME_LIMIT");
  const prefs = rows("UserPreference").filter((row) => ids.has(row.userId));
  const owned = Object.fromEntries(OWNED_TABLES.map((table) => [table, []]));
  Object.assign(owned, { User: users.map((row) => row.id), Project: project.map((row) => row.id), Product: product.map((row) => row.id),
    Task: task.map((row) => row.id),
    ProductCompositionRevision: revisions.map((row) => row.id), ProductCompositionItem: items.map((row) => row.id),
    ChangeLog: logs.map((row) => row.id), UserPreference: prefs.map((row) => key("UserPreference", row)) });
  for (const keys of Object.values(owned)) keys.sort();
  const allIds = new Set([plan.project.id, plan.product.id, plan.task.id, ...ids, ...revisionIds, ...itemIds]);
  for (const table of snapshot.tableNames) for (const row of rows(table)) {
    const linked = Object.entries(row).some(([column, value]) => column.endsWith("Id") && allIds.has(value));
    if (linked && !(owned[table] ?? []).includes(key(table, row))) throw new CompositionQaStop("UNKNOWN_REFERENCES");
  }
  const graphRows = Object.fromEntries(OWNED_TABLES.map((table) => [table,
    rows(table).filter((row) => (owned[table] ?? []).includes(key(table, row))).map((row) => row.__raw).sort()]));
  const phase = confirmed.length === 2 && revisions.some((row) => row.status === "DRAFT") ? "TWO_CONFIRMED_AND_DRAFT"
    : confirmed.length ? `CONFIRMED_${confirmed.length}${revisions.some((row) => row.status === "DRAFT") ? "_AND_DRAFT" : ""}`
      : revisions.length ? "DRAFT_1" : "INITIAL";
  return { owned, graphHash: sha(canonical(graphRows)), phase, revisions, items, depth };
}

export function captureCompositionGraph(snapshot, plan, { expectFinal = false } = {}) {
  const captured = graph(snapshot, plan);
  check(same(compositionFingerprints(snapshot, captured.owned), plan.baseline), "BUSINESS_FINGERPRINT_DRIFT");
  if (expectFinal) {
    const counts = captured.revisions.map((row) => captured.items.filter((item) => item.revisionId === row.id).length);
    check(captured.phase === "TWO_CONFIRMED_AND_DRAFT" &&
      same(counts.sort((a, b) => a - b), [3, 3, 4]), "FINAL_SCENARIO_INCOMPLETE");
    const [first, second] = captured.revisions.filter((row) => row.status === "CONFIRMED").sort((a, b) => a.revisionNo - b.revisionNo);
    const draft = captured.revisions.find((row) => row.status === "DRAFT");
    const at = (revision) => captured.items.filter((row) => row.revisionId === revision.id);
    const original = at(first), updated = at(second), pending = at(draft);
    const rootModule = original.find((row) => row.kind === "MODULE" && row.parentId === null && row.quantityPerParent === 2 && row.travelsToInstallation);
    const part = original.find((row) => row.kind === "PART" && row.parentId === rootModule?.id && row.quantityPerParent === 3 && row.travelsToInstallation);
    const hardware = original.find((row) => row.kind === "HARDWARE" && row.parentId === rootModule?.id && row.quantityPerParent === 4);
    check(rootModule && part && hardware && updated.some((row) => row.lineageId === rootModule.lineageId && row.quantityPerParent === 2) &&
      updated.some((row) => row.lineageId === part.lineageId && row.quantityPerParent === 4) &&
      updated.some((row) => row.lineageId === hardware.lineageId && row.quantityPerParent === 4) &&
      pending.some((row) => row.lineageId === part.lineageId && row.quantityPerParent === 4) &&
      pending.some((row) => !updated.some((old) => old.lineageId === row.lineageId)), "FINAL_SCENARIO_INCOMPLETE");
  }
  return { phase: captured.phase, owned: captured.owned, graphHash: captured.graphHash,
    revisionCount: captured.revisions.length, itemCount: captured.items.length };
}

export const COMPOSITION_TRIGGER_SOURCE = Object.freeze({
  guard_product_composition_revision: `BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW."status" <> 'DRAFT' THEN RAISE EXCEPTION 'composition revision must start as draft'; END IF;
      RETURN NEW;
    END IF;
    IF OLD."status" = 'CONFIRMED' THEN RAISE EXCEPTION 'confirmed composition revision is immutable'; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF NEW."id" <> OLD."id" OR NEW."productId" <> OLD."productId" OR
       NEW."baseRevisionId" IS DISTINCT FROM OLD."baseRevisionId" OR
       NEW."createdById" <> OLD."createdById" OR NEW."createdAt" <> OLD."createdAt" OR
       NEW."draftVersion" < OLD."draftVersion" THEN
      RAISE EXCEPTION 'composition revision identity or version changed';
    END IF;
    IF NEW."status" = 'CONFIRMED' AND NOT EXISTS (
      SELECT 1 FROM "ProductCompositionItem" WHERE "revisionId" = OLD."id"
    ) THEN RAISE EXCEPTION 'empty composition cannot be confirmed'; END IF;
    RETURN NEW;
  END;`,
  guard_product_composition_item: `DECLARE
    revision_state "CompositionRevisionStatus";
    parent_kind "CompositionItemKind";
    item_id TEXT;
    item_revision TEXT;
    item_parent TEXT;
  BEGIN
    item_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
    item_revision := CASE WHEN TG_OP = 'DELETE' THEN OLD."revisionId" ELSE NEW."revisionId" END;
    item_parent := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."parentId" END;
    SELECT "status" INTO revision_state FROM "ProductCompositionRevision" WHERE "id" = item_revision FOR UPDATE;
    IF revision_state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'confirmed composition items are immutable'; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF TG_OP = 'UPDATE' AND (NEW."id" <> OLD."id" OR NEW."revisionId" <> OLD."revisionId" OR
      NEW."lineageId" <> OLD."lineageId") THEN RAISE EXCEPTION 'composition item identity changed'; END IF;
    IF TG_OP = 'UPDATE' AND OLD."kind" = 'MODULE' AND NEW."kind" <> 'MODULE' AND EXISTS (
      SELECT 1 FROM "ProductCompositionItem" WHERE "revisionId" = OLD."revisionId" AND "parentId" = OLD."id"
    ) THEN RAISE EXCEPTION 'composition module still has children'; END IF;
    IF item_parent IS NOT NULL THEN
      SELECT "kind" INTO parent_kind FROM "ProductCompositionItem"
        WHERE "revisionId" = item_revision AND "id" = item_parent;
      IF parent_kind IS DISTINCT FROM 'MODULE' THEN RAISE EXCEPTION 'composition parent must be a module'; END IF;
      IF EXISTS (
        WITH RECURSIVE ancestors("id", "parentId", depth) AS (
          SELECT "id", "parentId", 1 FROM "ProductCompositionItem"
            WHERE "revisionId" = item_revision AND "id" = item_parent
          UNION ALL
          SELECT p."id", p."parentId", a.depth + 1 FROM "ProductCompositionItem" p
            JOIN ancestors a ON p."id" = a."parentId" AND p."revisionId" = item_revision
            WHERE a.depth <= 16
        ) SELECT 1 FROM ancestors WHERE "id" = item_id OR depth >= 16
      ) THEN RAISE EXCEPTION 'composition cycle or depth exceeded'; END IF;
    END IF;
    RETURN NEW;
  END;`,
});
const normalized = (source) => source.replace(/\s+/g, " ").trim();
const TRIGGER_QUERY = `SELECT c.relname AS table_name,t.tgname,t.tgenabled,t.tgisinternal,t.tgtype,t.tgnargs,t.tgqual::text AS tgqual,
  nf.nspname AS fnnamespace,p.proname,p.prosrc,p.prosecdef,pg_get_triggerdef(t.oid) AS definition
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace nf ON nf.oid=p.pronamespace
  WHERE n.nspname='public' AND c.relname IN ('ProductCompositionRevision','ProductCompositionItem') AND NOT t.tgisinternal`;

export function assertCompositionQaTriggers(rows) {
  check(Array.isArray(rows) && rows.length === 2, "TRIGGER_SET_MISMATCH");
  for (const [table, name, functionName] of TRIGGERS) {
    const row = rows.find((entry) => entry.table_name === table && entry.tgname === name);
    check(row && row.tgenabled === "O" && row.tgisinternal === false && Number(row.tgtype) === 31 &&
      Number(row.tgnargs) === 0 && row.tgqual === null && row.fnnamespace === "public" &&
      row.proname === functionName && row.prosecdef === false &&
      normalized(row.prosrc ?? "") === normalized(COMPOSITION_TRIGGER_SOURCE[functionName]) &&
      typeof row.definition === "string" && row.definition.includes(name) && row.definition.includes(functionName),
    "TRIGGER_SET_MISMATCH");
  }
  return sha(canonical(rows.map(({ table_name, tgname, tgenabled, tgtype, tgnargs, tgqual, fnnamespace, proname, prosrc, prosecdef, definition }) =>
    ({ table_name, tgname, tgenabled, tgtype, tgnargs, tgqual, fnnamespace, proname, prosrc, prosecdef, definition })).sort((a, b) => a.tgname.localeCompare(b.tgname))));
}

function verifiedManifest(manifest) {
  check(manifest && HASH.test(manifest.manifestHash ?? "") &&
    sha(canonical(plainManifest(manifest))) === manifest.manifestHash, "MANIFEST_INVALID");
  assertCompositionQaTarget(manifest.target);
  check(manifest.format === FORMAT && validId(manifest.runId) && manifest.ids?.project === manifest.project?.id &&
    manifest.ids?.product === manifest.product?.id && manifest.ids?.task === manifest.task?.id && validId(manifest.ids?.task) &&
    Array.isArray(manifest.ids?.users) && manifest.ids.users.length === 3 &&
    manifest.ids.users.every(validId) && manifest.users?.length === 3 &&
    same(manifest.ids.users, manifest.users.map((user) => user.id)) &&
    manifest.baseline?.tableNames?.every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && HASH.test(manifest.baseline.hashes?.[name] ?? "")) &&
    REQUIRED_TABLES.every((name) => manifest.baseline.tableNames.includes(name)), "MANIFEST_INVALID");
  return manifest;
}
export async function prepareCompositionQa({ db, plan, durablePlanSha256 }) {
  validateCompositionQaPlan(plan);
  check(durablePlanSha256 === compositionPlanSha256(plan), "DURABLE_PLAN_PROOF_REQUIRED");
  return db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout='30s'");
    await tx.$executeRawUnsafe(`LOCK TABLE ${plan.baseline.tableNames.map((name) => `public."${name}"`).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    const before = await readCompositionQaSnapshot(tx);
    check(same(compositionFingerprints(before), plan.baseline), "BASELINE_DRIFT_BEFORE_INSERT");
    const planned = new Set([plan.project.id, plan.product.id, plan.task.id, ...plan.users.map((user) => user.id)]);
    check(before.tableNames.every((name) => (before.rows[name] ?? []).every((row) => !planned.has(row.id))) &&
      before.rows.Client?.some((row) => row.id === plan.project.clientId), "PREPARE_COLLISION_OR_CLIENT_MISSING");
    for (const user of plan.users) await tx.user.create({ data: { id: user.id, name: user.name, email: user.email,
      passwordHash: user.passwordHash, roles: user.roles, payScheme: "NONE", active: true } });
    await tx.project.create({ data: { ...plan.project, stage: "LEAD" } });
    await tx.product.create({ data: { ...plan.product, status: "DESIGN" } });
    await tx.task.create({ data: { ...plan.task, dueAt: new Date(plan.task.dueAt) } });
    const after = await readCompositionQaSnapshot(tx);
    const initial = { User: plan.users.map((user) => user.id), Project: [plan.project.id], Product: [plan.product.id], Task: [plan.task.id] };
    check(same(compositionFingerprints(after, initial), plan.baseline), "PREPARE_BUSINESS_DIFF");
    const manifest = publicCompositionQaPlan(plan);
    return { ...manifest, manifestHash: sha(canonical(manifest)) };
  }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 60000 });
}

export async function captureCompositionQa({ db, manifest, expectFinal = false }) {
  verifiedManifest(manifest);
  assertCompositionQaTarget(manifest.target);
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return captureCompositionGraph(await readCompositionQaSnapshot(tx), manifest, { expectFinal });
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 120000 });
}

async function deleteExact(tx, table, keys) {
  if (!keys.length) return;
  const result = table === "UserPreference"
    ? await tx.$queryRawUnsafe(`DELETE FROM public."UserPreference" WHERE ("userId"||'|'||"key")=ANY($1::text[]) RETURNING "userId"`, keys)
    : await tx.$queryRawUnsafe(`DELETE FROM public."${table}" WHERE "id"=ANY($1::text[]) RETURNING "id"`, keys);
  check(result.length === keys.length, "EXACT_DELETE_COUNT_MISMATCH");
}

export async function cleanupCompositionQa({ db, manifest, captured, actionsDrained = false }) {
  verifiedManifest(manifest);
  assertCompositionQaTarget(manifest.target);
  check(actionsDrained && captured?.graphHash && captured?.owned, "CLEANUP_PROOF_REQUIRED");
  return db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout='30s'");
    await tx.$executeRawUnsafe(`LOCK TABLE ${manifest.baseline.tableNames.map((name) => `public."${name}"`).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    await tx.$executeRawUnsafe(`LOCK TABLE public."ProductCompositionRevision",public."ProductCompositionItem" IN ACCESS EXCLUSIVE MODE`);
    const before = await readCompositionQaSnapshot(tx);
    const current = captureCompositionGraph(before, manifest);
    check(current.graphHash === captured.graphHash && same(current.owned, captured.owned), "OWNED_GRAPH_DRIFT");
    const triggerHash = assertCompositionQaTriggers(await tx.$queryRawUnsafe(TRIGGER_QUERY));
    for (const [table, name] of TRIGGERS) await tx.$executeRawUnsafe(`ALTER TABLE public."${table}" DISABLE TRIGGER "${name}"`);
    await deleteExact(tx, "ChangeLog", current.owned.ChangeLog);
    await deleteExact(tx, "UserPreference", current.owned.UserPreference);
    const detail = graph(before, manifest);
    for (let level = 16; level >= 1; level--)
      await deleteExact(tx, "ProductCompositionItem", detail.items.filter((row) => detail.depth.get(row.id) === level).map((row) => row.id));
    const revisions = [...detail.revisions].sort((a, b) => (a.status === "DRAFT" ? -1 : b.status === "DRAFT" ? 1 : b.revisionNo - a.revisionNo));
    for (const revision of revisions) await deleteExact(tx, "ProductCompositionRevision", [revision.id]);
    await deleteExact(tx, "Task", current.owned.Task);
    await deleteExact(tx, "Product", current.owned.Product);
    await deleteExact(tx, "Project", current.owned.Project);
    await deleteExact(tx, "User", current.owned.User);
    for (const [table, name] of TRIGGERS) await tx.$executeRawUnsafe(`ALTER TABLE public."${table}" ENABLE TRIGGER "${name}"`);
    check(assertCompositionQaTriggers(await tx.$queryRawUnsafe(TRIGGER_QUERY)) === triggerHash, "TRIGGER_RESTORE_MISMATCH");
    check(same(compositionFingerprints(await readCompositionQaSnapshot(tx)), manifest.baseline), "CLEANUP_POSTCHECK_FAILED");
    return { phase: "CLEANED", deleted: Object.fromEntries(Object.entries(current.owned).map(([table, keys]) => [table, keys.length])) };
  }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 60000 });
}
