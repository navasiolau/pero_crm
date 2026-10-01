import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { PrismaClient, Role } from "@prisma/client";
import { canEditProductTechnicalBlock, fileVisibilityWhere, productEditWhere, productVisibilityWhere } from "../src/server/access/visibility";
import { resolveUploadContext } from "../src/server/files/upload-context";
import { scopeNotificationContent } from "../src/server/access/notification-visibility";
import { engineerFixture, fixtureModel, matches } from "./helpers/visibility-fixture";

const fixture = engineerFixture();
const db = fixture.db as unknown as PrismaClient;
const engineer = { id: "engineer", roles: ["ENGINEER" as Role] };
let products: typeof import("../src/server/products/queries");
let projects: typeof import("../src/server/projects/queries");

before(async () => {
  // Imported query modules see only this adapter. No PrismaClient/network exists.
  (globalThis as { prisma?: PrismaClient }).prisma = db;
  products = await import("../src/server/products/queries");
  projects = await import("../src/server/projects/queries");
});

test("queries return only own DESIGN and filters cannot overwrite access", async () => {
  const result = await products.listProducts(engineer.id, engineer.roles, { activeOnly: false }, { page: 1, pageSize: 10 });
  assert.deepEqual(result.rows.map((p) => p.id), ["own"]);
  assert.equal(result.total, 1);
  for (const filter of [{ engineerId: "other" }, { status: "PRODUCTION" as const }, { projectId: "hidden" }]) {
    assert.equal((await products.listProducts(engineer.id, engineer.roles, { activeOnly: false, ...filter })).total, 0);
  }
  for (const key of ["foreign", "production", "hidden-product"]) assert.equal(await products.getProductFor(engineer.id, engineer.roles, key), null);
});

test("project query scopes children, files, dependencies and financial aggregates", async () => {
  const project = await projects.getProjectFor(engineer.id, engineer.roles, "mixed");
  assert.ok(project);
  assert.deepEqual(project.products.map((p) => p.id), ["own"]);
  assert.deepEqual(project.tasks.map((t) => t.id), ["task-own"]);
  assert.deepEqual(new Set(project.files.map((f) => f.id)), new Set(["file-own", "file-general"]));
  assert.equal(project.tasks[0].dependencies.length, 0);
  for (const field of ["initialPrice", "delivery", "unloading", "installation"] as const) assert.equal(project[field], null);
  assert.equal(await projects.getProjectFor(engineer.id, engineer.roles, "hidden"), null);
  const result = await projects.listProjects(engineer.id, engineer.roles, { activeOnly: false });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].totalPrice, 100);
  assert.deepEqual(result.rows[0]._count, { tasks: 1, products: 1, files: 2 });
  assert.equal((await projects.listProjects(engineer.id, engineer.roles, { activeOnly: false, engineerId: "other" })).total, 0);
});

test("filter options and client counts use the same visible project set", async () => {
  const options = await products.listProductFilterOptions(engineer.id, engineer.roles);
  assert.deepEqual(options.projects.map((p) => p.id), ["mixed"]);
  const clients = await projects.listClients(engineer);
  assert.equal(clients[0]._count.projects, 1);
  assert.deepEqual((await products.listProductOptions("mixed", engineer)).map((p) => p.id), ["own"]);
  assert.deepEqual(await products.listProductOptions("hidden", engineer), []);
});

test("role grants are united, while empty roles fail closed even inside AND", async () => {
  for (const roles of [["ADMIN"], ["DIRECTOR"], ["MANAGER", "ENGINEER"], ["ACCOUNTANT", "ENGINEER"]] as Role[][]) {
    assert.equal((await products.listProducts(engineer.id, roles, { activeOnly: false })).total, 5);
  }
  for (const role of ["WORKER", "MOUNTER"] as Role[]) {
    const result = await products.listProducts(engineer.id, [role, "ENGINEER"], { activeOnly: false });
    assert.deepEqual(new Set(result.rows.map((p) => p.id)), new Set(["own", "production", "field-product"]));
  }
  assert.equal((await products.listProducts(engineer.id, [], { activeOnly: false })).total, 0);
});

test("accounting and field read grants do not widen engineering technical edits", () => {
  for (const roles of [["ENGINEER"], ["ENGINEER", "ACCOUNTANT"], ["ENGINEER", "WORKER"], ["ENGINEER", "MOUNTER"]] as Role[][]) {
    const actor = { id: engineer.id, roles };
    assert.deepEqual(fixture.products.filter((p) => matches(p, productEditWhere(actor))).map((p) => p.id), ["own"]);
    assert.equal(canEditProductTechnicalBlock(actor, { engineerId: engineer.id, status: "DESIGN" }), true);
    assert.equal(canEditProductTechnicalBlock(actor, { engineerId: engineer.id, status: "PRODUCTION" }), false);
    assert.equal(canEditProductTechnicalBlock(actor, { engineerId: "other", status: "DESIGN" }), false);
  }
  assert.deepEqual(productEditWhere({ id: engineer.id, roles: ["MANAGER", "ENGINEER"] }), {});
  assert.equal(fixture.products.filter((p) => matches(p, productEditWhere({ id: engineer.id, roles: ["ACCOUNTANT"] }))).length, 0);
});

test("file policy checks both direct product and indirect task", () => {
  const result = fixture.files.filter((file) => matches(file, fileVisibilityWhere(engineer)));
  assert.deepEqual(result.map((file) => file.id), ["file-own", "file-general"]);
});

test("upload rejects hidden task and mismatched product before any write", async () => {
  for (const actor of [engineer, { ...engineer, roles: ["ACCOUNTANT", "ENGINEER"] as Role[] }]) {
    for (const context of [
      { projectId: "mixed", productId: "own", taskId: "task-foreign" },
      { projectId: "mixed", productId: null, taskId: "task-production" },
      { projectId: "hidden", productId: null, taskId: null },
    ]) assert.equal(await resolveUploadContext(db, actor, context), null);
  }
  const inferred = await resolveUploadContext(db, engineer, { projectId: "mixed", productId: null, taskId: "task-own" });
  assert.equal(inferred?.productId, "own");
  assert.ok(await resolveUploadContext(db, engineer, { projectId: "mixed", productId: null, taskId: null }));
  assert.equal(await resolveUploadContext(db, { ...engineer, roles: ["ACCOUNTANT"] }, { projectId: "hidden", productId: null, taskId: null }), null);
});

test("field upload grant retains project access from own tasks without widening to other projects", async () => {
  const actor = { ...engineer, roles: ["ENGINEER", "WORKER"] as Role[] };
  assert.ok(await resolveUploadContext(db, actor, { projectId: "field", productId: "field-product", taskId: "task-field-product" }));
  assert.ok(await resolveUploadContext(db, actor, { projectId: "field", productId: "field-product", taskId: null }));
  assert.equal(await resolveUploadContext(db, actor, { projectId: "hidden", productId: null, taskId: null }), null);
});

test("a common task cannot inherit the grant for an unbound shared project file", async () => {
  const sample = engineerFixture();
  sample.tasks.push(
    { id: "common-foreign", projectId: "mixed", project: sample.projects[0], productId: null, product: null, assigneeId: "other" },
    { id: "common-own", projectId: "mixed", project: sample.projects[0], productId: null, product: null, assigneeId: engineer.id },
  );
  const sampleDb = sample.db as unknown as PrismaClient;
  for (const roles of [["ENGINEER"], ["ENGINEER", "ACCOUNTANT"], ["ENGINEER", "WORKER"], ["ENGINEER", "MOUNTER"]] as Role[][]) {
    const actor = { id: engineer.id, roles };
    assert.equal(await resolveUploadContext(sampleDb, actor, { projectId: "mixed", productId: null, taskId: "common-foreign" }), null);
    assert.ok(await resolveUploadContext(sampleDb, actor, { projectId: "mixed", productId: null, taskId: null }), "Shared project files remain allowed");
  }
  assert.equal(await resolveUploadContext(sampleDb, { ...engineer, roles: ["ENGINEER", "ACCOUNTANT"] }, { projectId: "mixed", productId: null, taskId: "common-own" }), null, "Read-only accounting does not grant task uploads");
  assert.ok(await resolveUploadContext(sampleDb, { ...engineer, roles: ["ENGINEER", "WORKER"] }, { projectId: "mixed", productId: null, taskId: "common-own" }), "Own field tasks retain their independent grant");
  assert.ok(await resolveUploadContext(sampleDb, { ...engineer, roles: ["MANAGER", "ENGINEER"] }, { projectId: "mixed", productId: null, taskId: "common-foreign" }), "Managers retain their independent grant");
});

test("change of status is effective for the next access check without cached grants", () => {
  const row = { ...fixture.products[0] };
  assert.equal(matches(row, productVisibilityWhere(engineer)), true);
  row.status = "PRODUCTION";
  assert.equal(matches(row, productVisibilityWhere(engineer)), false);
  assert.equal(matches(row, productEditWhere(engineer)), false);
});

test("nested work, sketch and task file cannot smuggle a hidden product into a visible card", async () => {
  const own = fixture.products[0];
  const task = fixture.tasks[0];
  const original = { sketchFile: own.sketchFile, work: task.work, workId: task.workId, files: task.files };
  try {
    own.sketchFile = fixture.files[1];
    task.work = { id: "secret-work", title: "Secret work", product: fixture.products[1], project: fixture.projects[0] };
    task.workId = "secret-work";
    task.files = [fixture.files[1]];
    const result = await products.getProductFor(engineer.id, engineer.roles, "own");
    assert.ok(result);
    assert.equal(result.sketchFile, null);
    assert.equal(result.tasks[0].work, null);
    assert.deepEqual(result.tasks[0].files, []);
    const { mapTaskDetails } = await import("../src/server/tasks/queries");
    const mapped = await mapTaskDetails(result.tasks);
    assert.equal(mapped[0].workId, null);
    assert.equal(mapped[0].workTitle, null);
  } finally {
    own.sketchFile = original.sketchFile;
    task.work = original.work;
    task.workId = original.workId;
    task.files = original.files;
  }
});

test("hidden material shortages do not affect the project badge", async () => {
  const original = fixture.db.projectMaterial;
  try {
    fixture.db.projectMaterial = fixtureModel([{ product: fixture.products[1], materialId: "material", quantity: 5, issuedQty: 0 }]);
    assert.equal((await projects.listProjects(engineer.id, engineer.roles, { activeOnly: false })).rows[0].hasMaterialShortage, false);
    fixture.db.projectMaterial = fixtureModel([{ product: fixture.products[0], materialId: "material", quantity: 5, issuedQty: 0 }]);
    assert.equal((await projects.listProjects(engineer.id, engineer.roles, { activeOnly: false })).rows[0].hasMaterialShortage, true);
  } finally {
    fixture.db.projectMaterial = original;
  }
});

test("sorting and pagination by product count use only accessible products", async () => {
  const hidden = fixture.products[3];
  const oldEngineer = hidden.engineerId;
  try {
    hidden.engineerId = engineer.id;
    const result = await projects.listProjects(engineer.id, engineer.roles, { activeOnly: false, sort: "products", dir: "desc" }, { page: 1, pageSize: 1 });
    assert.equal(result.total, 2);
    assert.deepEqual(result.rows.map((p) => p.id), ["hidden"]);
    assert.equal(result.rows[0]._count.products, 1);
  } finally {
    hidden.engineerId = oldEngineer;
  }
});

test("notification redaction respects current entity access and legacy /my fallback", async () => {
  const items = [
    { type: "task.assigned", title: "Own title", body: "Own body", link: "/products/own" },
    { type: "task.statusChanged", title: "Former title", body: "Hidden detail", link: "/products/production" },
    { type: "task.assigned", title: "Foreign title", body: "Hidden detail", link: "/projects/hidden" },
    { type: "task.assigned", title: "Legacy title", body: "Unknown project", link: "/my" },
    { type: "payroll.accrued", title: "Earned salary", body: "Historical amount", link: "/payroll" },
    { type: "user.accountChanged", title: "Account", body: "Your details", link: null },
  ];
  const original = structuredClone(items);
  const result = await scopeNotificationContent(engineer, items, db);
  assert.deepEqual(result[0], items[0]);
  for (const index of [1, 2, 3]) {
    assert.equal(result[index].title, "Список доступных задач обновлён");
    assert.equal(result[index].body, null);
    assert.equal(result[index].link, "/my");
  }
  assert.deepEqual(result.slice(4), items.slice(4));
  assert.deepEqual(items, original, "stored notification history is not mutated");
  assert.deepEqual(await scopeNotificationContent({ ...engineer, roles: ["MANAGER", "ENGINEER"] }, items, db), items);
  assert.deepEqual(await scopeNotificationContent({ ...engineer, roles: ["ACCOUNTANT", "ENGINEER"] }, items, db), items);
});

test("own historical payslip is preserved although its project is inaccessible", async () => {
  assert.equal(await projects.getProjectFor(engineer.id, engineer.roles, "hidden"), null);
  const { getMyPayroll } = await import("../src/server/payroll/queries");
  const result = await getMyPayroll(engineer.id, "2000-01");
  assert.equal(result.accrued, 500);
  assert.equal(result.paid, 100);
  assert.equal(result.debt, 400);
  assert.deepEqual(result.entries.map((entry) => entry.id), ["historical-earned"]);
});
