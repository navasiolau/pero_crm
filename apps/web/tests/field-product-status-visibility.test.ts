import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";
import type { PrismaClient, ProductStatus, Role } from "@prisma/client";
import { PRODUCT_STATUSES, visibleProductStatuses } from "../src/lib/product-statuses";
import { engineerFixture, fixtureModel, type FixtureRow } from "./helpers/visibility-fixture";
import { productEditWhere, taskExecutionWhere } from "../src/server/access/visibility";
import { resolveUploadContext } from "../src/server/files/upload-context";
import { matches } from "./helpers/visibility-fixture";
import type { TaskTransaction } from "../src/server/tasks/transaction";

const fixture = engineerFixture(), parent = fixture.projects[0], actorId = "unassigned";
const sample = fixture.products[0];
const assigneeId = "other";
const description = "Корпус: дуб";
const products = PRODUCT_STATUSES.map(({ id }): FixtureRow => ({ ...sample, id, number: "119-" + id, title: id, status: id,
  project: parent, projectId: parent.id, engineerId: "other", assemblerId: assigneeId,
  assembler: { active: true, roles: ["WORKER"] }, mounterId: assigneeId, description, initialPrice: 75,
  tasks: [], works: [], files: [], percentageConfigs: [] }));
fixture.products.splice(0, fixture.products.length, ...products); parent.products = fixture.products;
const db = { ...fixture.db, work: fixtureModel([]) } as unknown as PrismaClient;
let queries: typeof import("../src/server/products/queries"), projects: typeof import("../src/server/projects/queries");
let mutations: typeof import("../src/server/products/core");
before(async () => {
  (globalThis as { prisma?: PrismaClient }).prisma = db;
  queries = await import("../src/server/products/queries"); projects = await import("../src/server/projects/queries");
  mutations = await import("../src/server/products/core");
});

const cases: { roles: Role[]; statuses: ProductStatus[] }[] = [
  { roles: ["WORKER"], statuses: ["PRODUCTION", "STORAGE"] },
  { roles: ["MOUNTER"], statuses: ["INSTALLATION"] },
  { roles: ["WORKER", "MOUNTER"], statuses: ["PRODUCTION", "STORAGE", "INSTALLATION"] },
];

test("рабочий и монтажник видят характеристики своих этапов без назначения через карточку, список и проект", async () => {
  for (const { roles, statuses } of cases) {
    const result = await queries.listProducts(actorId, roles, { activeOnly: false });
    assert.deepEqual(new Set(result.rows.map(row => row.status)), new Set(statuses));
    assert.deepEqual(visibleProductStatuses(roles).map(row => row.id), statuses);
    const project = await projects.getProjectFor(actorId, roles, String(parent.id));
    assert.ok(project);
    assert.deepEqual(new Set(project.products.map(row => row.status)), new Set(statuses));
    assert.deepEqual(project.payments, []);
    for (const status of statuses) {
      const card = await queries.getProductFor(actorId, roles, status);
      assert.ok(card);
      assert.deepEqual(card.tasks, []);
      const assignedCard = await queries.getProductFor(assigneeId, roles, status);
      assert.equal(assignedCard?.description, description);
      for (const row of [card, result.rows.find(row => row.status === status), project.products.find(row => row.status === status)]) {
        assert.ok(row);
        assert.equal(row.description, description, `${roles.join("+")} / ${status}`);
        assert.equal(row.expectedPrice, null);
        assert.equal(row.initialPrice, null);
      }
    }
    assert.equal(await queries.getProductFor(actorId, roles, "DESIGN"), null);
  }
  const actor = { id: actorId, roles: ["WORKER"] as Role[] };
  assert.equal(await queries.getProductFor(actor.id, actor.roles, "INSTALLATION"), null);
  assert.equal(await queries.getProductFor(actor.id, ["MOUNTER"], "PRODUCTION"), null);
  assert.equal((await queries.listProducts(actor.id, actor.roles, { activeOnly: false, status: "DESIGN" })).total, 0);
  const list = await projects.listProjects(actor.id, actor.roles, { activeOnly: false });
  assert.equal(list.rows.find(row => row.id === parent.id)?._count.products, 2);
  assert.deepEqual(new Set((await queries.listProductOptions(String(parent.id), actor)).map(row => row.id)), new Set(["PRODUCTION", "STORAGE"]));
  const row = products.find(item => item.id === "PRODUCTION")!;
  assert.equal(matches(row, productEditWhere(actor)), false);
  assert.equal(matches({ id: "foreign-task", assigneeId: "other", product: row }, taskExecutionWhere(actor)), false);
  assert.equal(await resolveUploadContext(db, actor, { projectId: String(parent.id), productId: "PRODUCTION", taskId: null }), null);
});

test("производственные роли не могут менять строку или прежнее описание, в том числе после назначения", async () => {
  const transaction: TaskTransaction = operation => operation(db);
  for (const { roles, statuses } of cases) {
    const productId = statuses[0];
    for (const id of [actorId, assigneeId]) {
      const actor = { id, roles, name: "Исполнитель", source: "web" as const };
      const sectionId = randomUUID();
      const structured = await mutations.patchProductCore(actor, {
        productId, clientMutationId: sectionId, field: "technicalSpecificationRow", sectionId,
        expectedSourceGeneration: 0, expectedLegacyDescription: description, expectedRow: null,
        row: { label: "Петли", value: "С доводчиком" },
      }, transaction);
      assert.equal(structured.kind, "forbidden");
      const legacy = await mutations.patchProductCore(actor, { productId, clientMutationId: randomUUID(),
        field: "description", expectedValue: description, value: "Фасад: ясень" }, transaction);
      assert.equal(legacy.kind, "forbidden");
      const form = await mutations.updateProductCore(actor, productId, { description: "Фасад: ясень" }, { description }, transaction);
      assert.deepEqual(form, { ok: false, error: "Изделие не найдено" });
    }
  }
});
