import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assertCompositionQaTarget, validateCompositionQaPlan, compositionFingerprints,
  captureCompositionGraph, assertCompositionQaTriggers, COMPOSITION_TRIGGER_SOURCE } from "./composition-owned-fixtures.mjs";

const target = { kind: "EXISTING_LOCAL", containerId: "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5",
  host: "127.0.0.1", port: 5433, database: "pero_crm" };
const tables = ["User", "Client", "Project", "Product", "Task", "ProductCompositionRevision", "ProductCompositionItem", "ChangeLog", "PayrollEntry", "Work"];
type Snapshot = { tableNames: string[]; rows: Record<string, Record<string, unknown>[]> };
function plan() {
  const runId = randomUUID();
  const users = ["MANAGER", "ENGINEER", "WORKER"].map((role, index) => ({ id: randomUUID(), name: `QA ${runId} ${role}`,
    email: `${runId}-${index}@qa.invalid`, roles: [role], active: true, payScheme: "NONE", passwordHash: "$argon2id$test" }));
  const project = { id: randomUUID(), number: `QA-COMP-${runId}`, numberInt: -1, title: `QA ${runId} order`, currency: "BYN",
    clientId: "existing-client", managerId: users[0].id };
  const product = { id: randomUUID(), projectId: project.id, number: `${project.number}-1`, title: `QA ${runId} product`,
    engineerId: users[1].id, status: "DESIGN" };
  const task = { id: randomUUID(), projectId: project.id, productId: product.id, title: `QA ${runId} composition read`,
    type: "Проверка состава", status: "NEW", assigneeId: users[2].id, createdById: users[0].id,
    workId: null, dueAt: "2035-01-01T00:00:00.000Z", estimateMinutes: 30 };
  return { format: "pero-composition-owned-qa/v1", runId, target, users, project, product, task,
    baseline: compositionFingerprints(rawSnapshot({ tableNames: tables, rows: {} })) };
}
function rawSnapshot(value: Snapshot) {
  return { tableNames: value.tableNames, rows: Object.fromEntries(value.tableNames.map((table) => [table,
    (value.rows[table] ?? []).map((original) => {
      const row = { ...original };
      Object.defineProperty(row, "__raw", { value: JSON.stringify(original), enumerable: false, configurable: true });
      return row;
    })])) };
}
function capture(value: ReturnType<typeof snapshot>, p: ReturnType<typeof plan>) {
  return captureCompositionGraph(rawSnapshot(value), p);
}
function snapshot(p: ReturnType<typeof plan>): Snapshot {
  return { tableNames: tables, rows: {
    User: p.users.map((user) => ({ ...user })),
    Project: [{ ...p.project }], Product: [{ ...p.product }],
    Task: [{ ...p.task, quantity: null, allocationGroupId: null, doneAt: null }],
    ProductCompositionRevision: [], ProductCompositionItem: [], ChangeLog: [],
  } };
}

test("target and planned identities reject production, missing IDs and broad database names", () => {
  const p = plan();
  assert.equal(validateCompositionQaPlan(p), p);
  assert.throws(() => assertCompositionQaTarget({ ...target, kind: "PRODUCTION" }), /TARGET_FORBIDDEN/);
  assert.throws(() => assertCompositionQaTarget({ ...target, database: "main" }), /TARGET_FORBIDDEN/);
  assert.throws(() => validateCompositionQaPlan({ ...p, product: { ...p.product, id: "" } }), /PLANNED_IDS_INVALID/);
  assert.throws(() => validateCompositionQaPlan({ ...p, task: { ...p.task, assigneeId: p.users[0].id } }), /QA_TASK_INVALID/);
});

test("initial and partial snapshots keep exact business fingerprint and bounded ownership", () => {
  const p = plan(); const rows = snapshot(p);
  const initial = capture(rows, p);
  assert.equal(initial.phase, "INITIAL");
  assert.deepEqual(initial.owned.Task, [p.task.id]);
  rows.rows.Task[0].dueAt = "2035-01-01T00:00:00";
  assert.equal(capture(rows, p).phase, "INITIAL");
  rows.rows.Task[0].dueAt = "2035-01-01T00:00:01";
  assert.throws(() => capture(rows, p), /QA_IDENTITY_DRIFT/);
  rows.rows.Task[0].dueAt = p.task.dueAt;
  rows.rows.Task[0].workId = randomUUID();
  assert.throws(() => capture(rows, p), /QA_IDENTITY_DRIFT/);
  rows.rows.Task[0].workId = null;
  rows.rows.ProductCompositionRevision.push({ id: randomUUID(), productId: p.product.id, status: "DRAFT", revisionNo: null,
    baseRevisionId: null, draftVersion: 0, createdById: p.users[0].id });
  rows.rows.ChangeLog.push({ id: randomUUID(), entity: "productComposition", entityId: rows.rows.ProductCompositionRevision[0].id,
    action: "draft.create", actorType: "user", actorId: p.users[0].id, source: "web", newValue: { productId: p.product.id } });
  assert.equal(capture(rows, p).phase, "DRAFT_1");
  rows.rows.Client = [{ id: "foreign", name: "changed" }];
  assert.throws(() => capture(rows, p), /BUSINESS_FINGERPRINT_DRIFT/);
});

test("foreign item, cycle, excessive rows and unrelated child references fail closed", () => {
  const p = plan(); const rows = snapshot(p);
  const revisionId = randomUUID();
  rows.rows.ProductCompositionRevision.push({ id: revisionId, productId: p.product.id, status: "DRAFT", revisionNo: null,
    baseRevisionId: null, draftVersion: 0, createdById: p.users[0].id });
  rows.rows.ChangeLog.push({ id: randomUUID(), entity: "productComposition", entityId: revisionId,
    action: "draft.create", actorType: "user", actorId: p.users[0].id, source: "web", newValue: { productId: p.product.id } });
  rows.rows.ProductCompositionItem.push({ id: randomUUID(), revisionId: "foreign-revision", lineageId: randomUUID(),
    kind: "PART", parentId: null, designation: "D-1", title: "Other", quantityPerParent: 1, travelsToInstallation: false });
  assert.throws(() => capture(rows, p), /BUSINESS_FINGERPRINT_DRIFT|UNKNOWN_REFERENCES/);
  rows.rows.ProductCompositionItem = [];
  rows.rows.Work = [{ id: randomUUID(), productId: p.product.id }];
  assert.throws(() => capture(rows, p), /UNKNOWN_REFERENCES|BUSINESS_FINGERPRINT_DRIFT/);
});

test("deleted item and discarded draft receipts remain owned, but a foreign revision link stops capture", () => {
  const p = plan(); const rows = snapshot(p);
  const oldRevision = randomUUID(), oldItem = randomUUID();
  const audit = (entityId: string, action: string, revisionId?: string) => ({ id: randomUUID(), entity: "productComposition",
    entityId, action, actorType: "user", actorId: p.users[0].id, source: "web",
    newValue: { productId: p.product.id, ...(revisionId ? { revisionId } : {}) } });
  rows.rows.ChangeLog.push(audit(oldRevision, "draft.create"), audit(oldItem, "item.create", oldRevision),
    { ...audit(oldItem, "item.delete", oldRevision), newValue: { productId: p.product.id, revisionId: oldRevision, count: 1 } },
    { ...audit(oldRevision, "draft.discard"), newValue: { productId: p.product.id, deletedItems: 0 } });
  assert.equal(capture(rows, p).owned.ChangeLog.length, 4);
  rows.rows.ChangeLog.push(audit(randomUUID(), "item.create", "foreign-revision"));
  assert.throws(() => capture(rows, p), /CHANGELOG_GRAPH_UNKNOWN/);
});

test("deleting a QA module with its child keeps both historical item receipts owned", () => {
  const p = plan(); const rows = snapshot(p);
  const revisionId = randomUUID(), moduleId = randomUUID(), childId = randomUUID();
  rows.rows.ProductCompositionRevision.push({ id: revisionId, productId: p.product.id, status: "DRAFT", revisionNo: null,
    baseRevisionId: null, draftVersion: 3, createdById: p.users[0].id });
  const log = (entityId: string, action: string, count?: number) => ({ id: randomUUID(), entity: "productComposition", entityId,
    action, actorType: "user", actorId: p.users[0].id, source: "web",
    newValue: { productId: p.product.id, revisionId, ...(count ? { count } : {}) } });
  rows.rows.ChangeLog.push(log(revisionId, "draft.create"), log(moduleId, "item.create"), log(childId, "item.create"),
    log(moduleId, "item.delete", 2));
  assert.equal(capture(rows, p).owned.ChangeLog.length, 4);
  rows.rows.ChangeLog.push(log(randomUUID(), "item.create"));
  assert.throws(() => capture(rows, p), /CHANGELOG_GRAPH_UNKNOWN/);
  rows.rows.ChangeLog.pop();
  rows.rows.ChangeLog.pop();
  assert.throws(() => capture(rows, p), /CHANGELOG_GRAPH_UNKNOWN/);
});

test("raw table set and large numeric text are preserved exactly", () => {
  assert.throws(() => compositionFingerprints({ tableNames: tables, rows: { User: [] } }), /TABLE_SET_INVALID/);
  const first = rawSnapshot({ tableNames: tables, rows: { PayrollEntry: [{ id: "business" }] } });
  const second = rawSnapshot({ tableNames: tables, rows: { PayrollEntry: [{ id: "business" }] } });
  Object.defineProperty(first.rows.PayrollEntry[0], "__raw", { value: '{"id":"business","amount":100000000000000001.00}' });
  Object.defineProperty(second.rows.PayrollEntry[0], "__raw", { value: '{"id":"business","amount":100000000000000002.00}' });
  assert.notEqual(compositionFingerprints(first).hashes.PayrollEntry, compositionFingerprints(second).hashes.PayrollEntry);
});

test("two confirmed snapshots plus an explicit draft stay within 3 revisions and 12 rows", () => {
  const p = plan(); const rows = snapshot(p);
  const [first, second, draft] = [randomUUID(), randomUUID(), randomUUID()];
  const makeAudit = (entityId: string, action: string) => ({ id: randomUUID(), entity: "productComposition", entityId,
    action, actorType: "user", actorId: p.users[0].id, source: "web", newValue: { productId: p.product.id } });
  for (const [index, id] of [first, second, draft].entries()) {
    rows.rows.ProductCompositionRevision.push({ id, productId: p.product.id, status: index < 2 ? "CONFIRMED" : "DRAFT",
      revisionNo: index < 2 ? index + 1 : null, baseRevisionId: index === 0 ? null : [first, second][index - 1],
      draftVersion: 1, createdById: p.users[0].id, confirmedById: index < 2 ? p.users[0].id : null });
    rows.rows.ChangeLog.push(makeAudit(id, "draft.create"));
    if (index < 2) rows.rows.ChangeLog.push(makeAudit(id, "revision.confirm"));
    const moduleId = randomUUID();
    for (const [position, code] of ["M-1", "P-1", "H-1", ...(index === 2 ? ["P-2"] : [])].entries()) {
      rows.rows.ProductCompositionItem.push({ id: position === 0 ? moduleId : randomUUID(), revisionId: id,
        lineageId: `lineage-${position}`, parentId: position ? moduleId : null, kind: position === 0 ? "MODULE" : position === 2 ? "HARDWARE" : "PART",
        designation: code, normalizedDesignation: code, title: code, quantityPerParent: position === 0 ? 2 : position === 1 ? index === 0 ? 3 : 4 : position === 2 ? 4 : 1,
        travelsToInstallation: position < 2 });
    }
  }
  const current = captureCompositionGraph(rawSnapshot(rows), p, { expectFinal: true });
  assert.equal(current.phase, "TWO_CONFIRMED_AND_DRAFT");
  assert.equal(current.itemCount, 10);
  const cancelled = randomUUID();
  rows.rows.ChangeLog.push(makeAudit(cancelled, "draft.create"), {
    ...makeAudit(cancelled, "draft.discard"), newValue: { productId: p.product.id, deletedItems: 3 },
  });
  assert.throws(() => captureCompositionGraph(rawSnapshot(rows), p), /QA_LIFETIME_LIMIT/);
  rows.rows.ChangeLog.splice(-2);
  rows.rows.ProductCompositionRevision.push({ id: randomUUID(), productId: p.product.id, status: "DRAFT", createdById: p.users[0].id });
  assert.throws(() => captureCompositionGraph(rawSnapshot(rows), p), /REVISION_GRAPH_UNKNOWN/);
});

test("only the two reviewed immutable composition triggers may be disabled and restored", () => {
  const sql = readFileSync("prisma/migrations/20260929120000_product_composition/migration.sql", "utf8");
  for (const [name, source] of Object.entries(COMPOSITION_TRIGGER_SOURCE)) {
    const found = sql.match(new RegExp(`CREATE FUNCTION "${name}"\\(\\) RETURNS trigger AS \\$\\$([\\s\\S]*?)\\$\\$ LANGUAGE`));
    assert.ok(found, name);
    assert.equal(found[1].replace(/\s+/g, " ").trim(), source.replace(/\s+/g, " ").trim(), name);
  }
  const defs = ["ProductCompositionRevision_guard", "ProductCompositionItem_guard"].map((name) => ({
    table_name: name.startsWith("ProductCompositionRevision") ? "ProductCompositionRevision" : "ProductCompositionItem",
    tgname: name, tgenabled: "O", tgisinternal: false, tgtype: 31, tgnargs: 0, tgqual: null,
    fnnamespace: "public", proname: name.startsWith("ProductCompositionRevision") ? "guard_product_composition_revision" : "guard_product_composition_item",
    prosrc: name.startsWith("ProductCompositionRevision") ? COMPOSITION_TRIGGER_SOURCE.guard_product_composition_revision : COMPOSITION_TRIGGER_SOURCE.guard_product_composition_item,
    prosecdef: false,
    definition: `CREATE TRIGGER "${name}" BEFORE INSERT OR UPDATE OR DELETE ON public."${name.startsWith("ProductCompositionRevision") ? "ProductCompositionRevision" : "ProductCompositionItem"}" EXECUTE FUNCTION "${name.startsWith("ProductCompositionRevision") ? "guard_product_composition_revision" : "guard_product_composition_item"}"`,
  }));
  assert.equal(typeof assertCompositionQaTriggers(defs), "string");
  assert.throws(() => assertCompositionQaTriggers([...defs, { ...defs[0], tgname: "unknown" }]), /TRIGGER_SET_MISMATCH/);
  assert.throws(() => assertCompositionQaTriggers(defs.map((row, index) => index ? row : { ...row, tgenabled: "D" })), /TRIGGER_SET_MISMATCH/);
});
