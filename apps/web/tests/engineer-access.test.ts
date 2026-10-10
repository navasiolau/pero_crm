import {liveProductWhere} from "../src/server/access/live-entities";
import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { PrismaClient, Role } from "@prisma/client";
import { canEditProductTechnicalBlock, fileVisibilityWhere, productEditWhere, productVisibilityWhere } from "../src/server/access/visibility";
import { resolveUploadContext } from "../src/server/files/upload-context";
import { scopeNotificationContent } from "../src/server/access/notification-visibility";
import { engineerFixture, fixtureModel, matches } from "./helpers/visibility-fixture";

const fixture = engineerFixture();
// The workspace now contains real priced Work tasks; generic orphan fixtures
// remain present so the read query must omit them without changing old payroll.
const ownTask = fixture.tasks.find(task => task.id === "task-own")!;
ownTask.workId = "work-own";
ownTask.quantity = "2";
ownTask.work = { id: "work-own", title: "Work", productId: ownTask.productId,
  projectId: ownTask.projectId, product: ownTask.product, project: ownTask.project,
  priceSnapshot: "10", total: "20", paymentKind: "LEGACY" };
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

test("queries return current own DESIGN and PRODUCTION and filters cannot overwrite access", async () => {
  const result = await products.listProducts(engineer.id, engineer.roles, { activeOnly: false }, { page: 1, pageSize: 10 });
  assert.deepEqual(result.rows.map((p) => p.id), ["own", "production"]);
  assert.equal(result.total, 2);
  for (const filter of [{ engineerId: "other" }, { projectId: "hidden" }]) {
    assert.equal((await products.listProducts(engineer.id, engineer.roles, { activeOnly: false, ...filter })).total, 0);
  }
  for (const key of ["foreign", "hidden-product"]) assert.equal(await products.getProductFor(engineer.id, engineer.roles, key), null);
});

test("project query scopes children, files, dependencies and financial aggregates", async () => {
  const project = await projects.getProjectFor(engineer.id, engineer.roles, "mixed");
  assert.ok(project);
  assert.deepEqual(project.products.map((p) => p.id), ["own", "production"]);
  assert.deepEqual(project.tasks.map((t) => t.id), ["task-own"]);
  assert.deepEqual(new Set(project.files.map((f) => f.id)), new Set(["file-own", "file-general", "file-production"]));
  assert.equal(project.tasks[0].dependencies.length, 0);
  for (const field of ["initialPrice", "delivery", "unloading", "installation"] as const) assert.equal(project[field], null);
  assert.equal(await projects.getProjectFor(engineer.id, engineer.roles, "hidden"), null);
  const result = await projects.listProjects(engineer.id, engineer.roles, { activeOnly: false });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].totalPrice, null);
  assert.ok(result.rows[0].products.every(product=>product.expectedPrice===null));
  assert.deepEqual(result.rows[0]._count, { tasks: 1, products: 2, files: 3 });
  assert.equal((await projects.listProjects(engineer.id, engineer.roles, { activeOnly: false, engineerId: "other" })).total, 0);
});

test("workspace omits a visible orphan without deleting its original row or financial facts",async()=>{
  const orphan={...ownTask,id:"task-orphan-visible",workId:null,work:null};
  fixture.tasks.push(orphan);(fixture.projects[0].tasks as typeof fixture.tasks).push(orphan);
  const project=await projects.getProjectFor(engineer.id,engineer.roles,"mixed");
  assert.ok(project);assert.deepEqual(project.tasks.map(task=>task.id),["task-own"]);
  assert(fixture.tasks.includes(orphan));
});
test("frozen reward cannot expose a Task whose Work is unbound or belongs to another Product/Project",async()=>{
  const work=ownTask.work as Record<string,unknown>;
  const variants=[{productId:null},{productId:"foreign"},{projectId:"hidden"}];
  const originals=variants.map((patch,index)=>({...ownTask,id:`task-frozen-invalid-${index}`,allocationGroupId:"old-fixed",shareAmount:"17.89",allocationGroup:{currency:"USD",budgetSource:"TASK_FIXED"},work:{...work,priceSnapshot:null,...patch}}));
  fixture.tasks.push(...originals);(fixture.projects[0].tasks as typeof fixture.tasks).push(...originals);
  const project=await projects.getProjectFor(engineer.id,engineer.roles,"mixed");assert.ok(project);
  assert.deepEqual(project.tasks.map(task=>task.id),["task-own"]);
  assert(originals.every(task=>fixture.tasks.includes(task)&&task.shareAmount==="17.89"));
});

test("filter options and client counts use the same visible project set", async () => {
  const options = await products.listProductFilterOptions(engineer.id, engineer.roles);
  assert.deepEqual(options.projects.map((p) => p.id), ["mixed"]);
  const clients = await projects.listClients(engineer);
  assert.equal(clients[0]._count.projects, 1);
  assert.deepEqual((await products.listProductOptions("mixed", engineer)).map((p) => p.id), ["own", "production"]);
  assert.deepEqual(await products.listProductOptions("hidden", engineer), []);
});

test("role grants are united, while empty roles fail closed even inside AND", async () => {
  assert.equal((await products.listProducts(engineer.id, ["ACCOUNTANT", "ENGINEER"], { activeOnly: false })).total, 2);
  assert.equal((await products.listProducts(engineer.id, ["ACCOUNTANT"], { activeOnly: false })).total, 0);
  for (const roles of [["ADMIN"], ["DIRECTOR"], ["MANAGER", "ENGINEER"], ["PROCUREMENT", "ENGINEER"]] as Role[][]) {
    assert.equal((await products.listProducts(engineer.id, roles, { activeOnly: false })).total, 5);
  }
  for (const role of ["WORKER", "MOUNTER"] as Role[]) {
    const result = await products.listProducts(engineer.id, [role, "ENGINEER"], { activeOnly: false });
    assert.deepEqual(new Set(result.rows.map((p) => p.id)), new Set(role === "WORKER"
      ? ["own", "production", "field-product"] : ["own", "production"]));
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
  assert.deepEqual(productEditWhere({ id: engineer.id, roles: ["MANAGER", "ENGINEER"] }), {AND:[liveProductWhere,{status:{not:"DRAFT"}},{}]});
  assert.equal(fixture.products.filter((p) => matches(p, productEditWhere({ id: engineer.id, roles: ["ACCOUNTANT"] }))).length, 0);
});

test("file policy checks both direct product and indirect task", () => {
  const result = fixture.files.filter((file) => matches(file, fileVisibilityWhere(engineer)));
  assert.deepEqual(result.map((file) => file.id), ["file-own", "file-production", "file-general"]);
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
  assert.equal(matches(row, productVisibilityWhere(engineer)), true);
  assert.equal(matches(row, productEditWhere(engineer)), false);
});

test("nested work, sketch and task file cannot smuggle a hidden product into a visible card", async () => {
  const own = fixture.products[0];
  const task = fixture.tasks[0];
  const original = { sketchFile: own.sketchFile, work: task.work, workId: task.workId, files: task.files };
  try {
    own.sketchFile = fixture.files[1];
    task.work = { id: "secret-work", title: "Secret work", productId:"foreign",projectId:"mixed",priceSnapshot:"10",product: fixture.products[1], project: fixture.projects[0] };
    task.workId = "secret-work";
    task.files = [fixture.files[1]];
    const result = await products.getProductFor(engineer.id, engineer.roles, "own");
    assert.ok(result);
    assert.equal(result.sketchFile, null);
    assert.deepEqual(result.tasks, []);
    const { mapTaskDetails } = await import("../src/server/tasks/queries");
    const mapped = await mapTaskDetails(result.tasks);
    assert.deepEqual(mapped, []);
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
    assert.deepEqual(result.rows.map((p) => p.id), ["mixed"]);
    assert.equal(result.rows[0]._count.products, 2);
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
  assert.deepEqual(result[1], items[1]);
  for (const index of [2, 3]) {
    assert.equal(result[index].title, "Список доступных задач обновлён");
    assert.equal(result[index].body, null);
    assert.equal(result[index].link, "/my");
  }
  assert.deepEqual(result.slice(4), items.slice(4));
  assert.deepEqual(items, original, "stored notification history is not mutated");
  assert.deepEqual(await scopeNotificationContent({ ...engineer, roles: ["MANAGER", "ENGINEER"] }, items, db), items);
  assert.deepEqual(await scopeNotificationContent({ ...engineer, roles: ["ACCOUNTANT", "ENGINEER"] }, items, db), result, "Financial role does not widen engineering notification access");
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
