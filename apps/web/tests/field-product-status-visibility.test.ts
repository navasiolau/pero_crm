import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, test } from "node:test";
import type { PrismaClient, ProductStatus, Role } from "@prisma/client";
import { PRODUCT_STATUSES, visibleProductStatuses } from "../src/lib/product-statuses";
import {
  assignedProductVisibilityWhere, fileVisibilityWhere, productVisibilityWhere,
  taskExecutionWhere, workVisibilityWhere,
} from "../src/server/access/visibility";
import { engineerFixture, fixtureModel, matches, type FixtureRow } from "./helpers/visibility-fixture";

const fixture = engineerFixture();
const parent = fixture.projects[0];
const actorId = "engineer";
const originals = { product: fixture.products[0], task: fixture.tasks[0], file: fixture.files[0] };
const products = PRODUCT_STATUSES.map(({ id }): FixtureRow => ({
  ...originals.product, id, number: `119-${id}`, title: id, status: id,
  project: parent, projectId: parent.id, engineerId: "other", assemblerId: actorId,
  assembler: { active: true, roles: ["WORKER"] }, mounterId: actorId,
  tasks: [], works: [], files: [], percentageConfigs: [],
}));
const works = products.map((product): FixtureRow => ({
  id: `work-${product.id}`, projectId: parent.id, project: parent,
  productId: product.id, product, paymentKind: "LEGACY", stagePayPoolId: null,
  poolWeightUnits: null, priceSnapshot: "10", total: "10", tasks: [],
}));
const tasks = products.map((product, index): FixtureRow => ({
  ...originals.task, id: `task-${product.id}`, productId: product.id, product,
  project: parent, projectId: parent.id, assigneeId: actorId,
  workId: works[index].id, work: works[index], dependencies: [], quantity: "1",
}));
const files = products.map((product): FixtureRow => ({
  ...originals.file, id: `file-${product.id}`, projectId: parent.id, project: parent,
  productId: product.id, product, taskId: null, task: null,
  mimeType: "image/jpeg", size: 100, storedName: "119.jpg",
}));
for (const [index, product] of products.entries()) {
  product.tasks = [tasks[index]]; product.works = [works[index]]; product.files = [files[index]];
  works[index].tasks = [tasks[index]];
}
// Even a common assigned project task and every kind of assignment cannot widen status access.
tasks.push({ ...originals.task, id: "common-task", productId: null, product: null,
  project: parent, projectId: parent.id, assigneeId: actorId });
fixture.products.splice(0, fixture.products.length, ...products);
fixture.tasks.splice(0, fixture.tasks.length, ...tasks);
fixture.files.splice(0, fixture.files.length, ...files);
parent.products = fixture.products; parent.tasks = fixture.tasks; parent.files = fixture.files;
parent.works = works;
const db = { ...fixture.db, work: fixtureModel(works) } as unknown as PrismaClient;
let queries: typeof import("../src/server/products/queries");
let projects: typeof import("../src/server/projects/queries");
let fileRoute: typeof import("../src/app/api/files/[id]/route");
let storageReads = 0;
const worker = { id: actorId, roles: ["WORKER"] as Role[] };
const require = createRequire(import.meta.url);
function inject(name: string, exports: Record<string, unknown>) {
  const file = require.resolve(name), stub = new Module(file);
  stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub;
}
before(async () => {
  (globalThis as { prisma?: PrismaClient }).prisma = db;
  queries = await import("../src/server/products/queries");
  projects = await import("../src/server/projects/queries");
  inject("../src/auth", { auth: async () => ({ user: worker }) });
  inject("../src/lib/s3", {
    UPLOADS_ROOT: "never-used", s3Enabled: () => true, fileKey: () => "", thumbKey: () => "",
    s3Get: async () => { storageReads++; throw Error("STORAGE_READ_FORBIDDEN"); },
  });
  fileRoute = require("../src/app/api/files/[id]/route");
});

test("field status matrix controls list, direct product and files despite assignment shortcuts", async () => {
  const matrix: { roles: Role[]; statuses: ProductStatus[] }[] = [
    { roles: ["WORKER"], statuses: ["PRODUCTION", "STORAGE"] },
    { roles: ["MOUNTER"], statuses: ["INSTALLATION"] },
    { roles: ["WORKER", "MOUNTER"], statuses: ["PRODUCTION", "STORAGE", "INSTALLATION"] },
  ];
  for (const { roles, statuses } of matrix) {
    const actor = { id: actorId, roles, fieldParticipantProductIds: products.map(row => String(row.id)),
      engineeringParticipantTaskIds: ["task-DESIGN"] };
    const allowed = new Set(statuses);
    const result = await queries.listProducts(actor.id, roles, { activeOnly: false });
    assert.deepEqual(new Set(result.rows.map(row => row.status)), allowed, `${roles.join("+")} product list`);
    assert.deepEqual(new Set(visibleProductStatuses(roles).map(row => row.id)), allowed, "UI has the same status matrix");
    for (const product of products) {
      const expected = allowed.has(product.status as ProductStatus);
      assert.equal(matches(product, productVisibilityWhere(actor)), expected);
      assert.equal(matches(product, assignedProductVisibilityWhere(actor)), expected);
      assert.equal(matches(tasks.find(row => row.productId === product.id)!, taskExecutionWhere(actor)), expected);
      assert.equal(matches(works.find(row => row.productId === product.id)!, workVisibilityWhere(actor)), expected);
      assert.equal(matches(files.find(row => row.productId === product.id)!, fileVisibilityWhere(actor)), expected);
    }
  }
  assert.equal(await queries.getProductFor(worker.id, worker.roles, "INSTALLATION"), null);
  assert.equal((await queries.listProducts(worker.id, worker.roles, { activeOnly: false, status: "INSTALLATION" })).total, 0);
  const project = await projects.getProjectFor(worker.id, worker.roles, String(parent.id));
  assert.ok(project);
  assert.deepEqual(new Set(project.products.map(row => row.status)), new Set(["PRODUCTION", "STORAGE"]));
  const projectList = await projects.listProjects(worker.id, worker.roles, { activeOnly: false });
  assert.equal(projectList.rows.find(row => row.id === parent.id)?._count.products, 2);
  assert.deepEqual(new Set((await queries.listProductOptions(String(parent.id), worker)).map(row => row.id)), new Set(["PRODUCTION", "STORAGE"]));
  for (const suffix of ["", "?preview=thumbnail"]) {
    const response = await fileRoute.GET(new Request(`https://qa.invalid/api/files/file-INSTALLATION${suffix}`), { params: Promise.resolve({ id: "file-INSTALLATION" }) });
    assert.equal(response.status, 404);
  }
  assert.equal(storageReads, 0, "A forbidden file never reaches storage");
  assert.equal(matches({ ...files.find(row => row.productId === "INSTALLATION")!, taskId: "task-PRODUCTION", task: tasks.find(row => row.productId === "PRODUCTION") }, fileVisibilityWhere(worker)), false);
  const unassigned = { ...works.find(row => row.productId === "STORAGE")!, tasks: [] };
  assert.equal(matches(unassigned, workVisibilityWhere(worker)), true, "Ordinary work is readable before taking a task");
  const stale = { ...products.find(row => row.status === "PRODUCTION")!, status: "INSTALLATION" };
  assert.equal(matches(stale, assignedProductVisibilityWhere(worker)), false, "A former assignment does not preserve status access");
});
