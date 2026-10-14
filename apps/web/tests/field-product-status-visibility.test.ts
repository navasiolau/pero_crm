import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { PrismaClient, ProductStatus, Role } from "@prisma/client";
import { PRODUCT_STATUSES, visibleProductStatuses } from "../src/lib/product-statuses";
import { engineerFixture, fixtureModel, type FixtureRow } from "./helpers/visibility-fixture";
import { productEditWhere, taskExecutionWhere } from "../src/server/access/visibility";
import { resolveUploadContext } from "../src/server/files/upload-context";
import { matches } from "./helpers/visibility-fixture";

const fixture = engineerFixture(), parent = fixture.projects[0], actorId = "unassigned";
const sample = fixture.products[0];
const products = PRODUCT_STATUSES.map(({ id }): FixtureRow => ({ ...sample, id, number: "119-" + id, title: id, status: id,
  project: parent, projectId: parent.id, engineerId: "other", assemblerId: "other",
  assembler: { active: true, roles: ["WORKER"] }, mounterId: "other", description: "PRIVATE_TECH",
  tasks: [], works: [], files: [], percentageConfigs: [] }));
fixture.products.splice(0, fixture.products.length, ...products); parent.products = fixture.products;
const db = { ...fixture.db, work: fixtureModel([]) } as unknown as PrismaClient;
let queries: typeof import("../src/server/products/queries"), projects: typeof import("../src/server/projects/queries");
before(async () => {
  (globalThis as { prisma?: PrismaClient }).prisma = db;
  queries = await import("../src/server/products/queries"); projects = await import("../src/server/projects/queries");
});

test("field role/status matrix controls actual list, direct card and parent counts", async () => {
  const cases: { roles: Role[]; statuses: ProductStatus[] }[] = [
    { roles: ["WORKER"], statuses: ["PRODUCTION", "STORAGE"] },
    { roles: ["MOUNTER"], statuses: ["INSTALLATION"] },
    { roles: ["WORKER", "MOUNTER"], statuses: ["PRODUCTION", "STORAGE", "INSTALLATION"] },
  ];
  for (const { roles, statuses } of cases) {
    const result = await queries.listProducts(actorId, roles, { activeOnly: false });
    assert.deepEqual(new Set(result.rows.map(row => row.status)), new Set(statuses));
    assert.deepEqual(visibleProductStatuses(roles).map(row => row.id), statuses);
  }
  const actor = { id: actorId, roles: ["WORKER"] as Role[] };
  assert.equal(await queries.getProductFor(actor.id, actor.roles, "INSTALLATION"), null);
  assert.equal((await queries.listProducts(actor.id, actor.roles, { activeOnly: false, status: "DESIGN" })).total, 0);
  const card = await queries.getProductFor(actor.id, actor.roles, "PRODUCTION"); assert.ok(card);
  assert.equal(card.description, null); assert.equal(card.expectedPrice, null); assert.deepEqual(card.tasks, []);
  const project = await projects.getProjectFor(actor.id, actor.roles, String(parent.id)); assert.ok(project);
  assert.deepEqual(new Set(project.products.map(row => row.status)), new Set(["PRODUCTION", "STORAGE"]));
  assert.deepEqual(project.payments, []);
  const list = await projects.listProjects(actor.id, actor.roles, { activeOnly: false });
  assert.equal(list.rows.find(row => row.id === parent.id)?._count.products, 2);
  assert.deepEqual(new Set((await queries.listProductOptions(String(parent.id), actor)).map(row => row.id)), new Set(["PRODUCTION", "STORAGE"]));
  const row = products.find(item => item.id === "PRODUCTION")!;
  assert.equal(matches(row, productEditWhere(actor)), false);
  assert.equal(matches({ id: "foreign-task", assigneeId: "other", product: row }, taskExecutionWhere(actor)), false);
  assert.equal(await resolveUploadContext(db, actor, { projectId: String(parent.id), productId: "PRODUCTION", taskId: null }), null);
});
