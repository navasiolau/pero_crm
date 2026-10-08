import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { engineerFixture, fixtureModel, type FixtureRow } from "./helpers/visibility-fixture";

// Настоящие query/visibility строят выборку; adapter только исполняет её на
// связанных строках, не открывая БД и не подменяя правила доступа.
const base = engineerFixture();
const identity = { activeOnly: false, searchScope: "identity" as const };
const projects: FixtureRow[] = [];
const products: FixtureRow[] = [];
for (const [id, number, title, clientName, engineer, stage] of [
  ["own", "199", "Стеллаж IdentityToken", "CustomerToken", "engineer", "IN_WORK"],
  ["parent", "300", "ParentToken", "Другой клиент", "engineer", "IN_WORK"],
  ["client", "400", "Другой заказ", "CustomerToken", "engineer", "DONE"],
  ["hidden", "999", "Стеллаж IdentityToken", "CustomerToken", "other", "IN_WORK"],
  ["deleted", "998", "Стеллаж IdentityToken", "CustomerToken", "engineer", "IN_WORK"],
] as const) {
  const client = { id: `client-${id}`, name: clientName, lastName: "SurnameToken", middleName: "MiddleToken" };
  const project: FixtureRow = { ...base.projects[0], id, number, numberInt: Number(number), title,
    clientId: client.id, client, managerId: id === "parent" ? "manager-2" : "manager-1",
    stage, description: "TechnicalToken", deletedAt: id === "deleted" ? new Date(0) : null,
    initialPrice: 0, delivery: 0, unloading: 0, installation: 0,
    products: [], tasks: [], works: [], files: [], stageHistory: [] };
  const product: FixtureRow = { ...base.products[0], id: `product-${id}`, number: `${number}.5`,
    suffixInt: 5, title: id === "own" || id === "hidden" || id === "deleted" ? "Стеллаж IdentityToken" : "Другая позиция",
    projectId: id, project, engineerId: engineer, status: "DESIGN", quantity: 1,
    description: "TechnicalToken", deletedAt: id === "deleted" ? new Date(0) : null };
  project.products = [product]; projects.push(project); products.push(product);
}
const partial = { ...products[0], id: "product-partial", number: "199.50", suffixInt: 50 };
products.push(partial); (projects[0].products as FixtureRow[]).push(partial);
const db = { ...base.db, project: fixtureModel(projects), product: fixtureModel(products),
  client: fixtureModel(projects.map(row => row.client as FixtureRow)),
  task: fixtureModel([]), productPercentageParticipant: fixtureModel([]) } as unknown as PrismaClient;
let projectQueries: typeof import("../src/server/projects/queries");
let productQueries: typeof import("../src/server/products/queries");
before(async () => {
  (globalThis as { prisma?: PrismaClient }).prisma = db;
  [projectQueries, productQueries] = await Promise.all([
    import("../src/server/projects/queries"), import("../src/server/products/queries"),
  ]);
});
const projectIds = async (q: string) => (await projectQueries.listProjects("manager", ["MANAGER"], { ...identity, q })).rows.map(row => row.id);
const productIds = async (q: string) => (await productQueries.listProducts("manager", ["MANAGER"], { ...identity, q })).rows.map(row => row.id);

test("kanban matches only own project/product numbers and case-insensitive titles", async () => {
  assert.deepEqual(await projectIds("199"), ["own"]);
  assert.deepEqual(await productIds("199.5"), ["product-partial", "product-own"]);
  assert.deepEqual(new Set(await projectIds("стеллаж")), new Set(["own", "hidden"]));
  assert.deepEqual(new Set(await productIds("IDENTITYTOKEN")), new Set(["product-own", "product-partial", "product-hidden"]));
});

test("kanban ignores descriptions, all client names and parent project names", async () => {
  for (const query of ["TechnicalToken", "CustomerToken", "SurnameToken", "MiddleToken"]) {
    assert.deepEqual(await projectIds(query), [], `project ${query}`);
    assert.deepEqual(await productIds(query), [], `product ${query}`);
  }
  assert.deepEqual(await productIds("ParentToken"), []);
  // Номер родителя не даёт совпадение, если он не содержится в собственном номере.
  const product = products[1]; const previous = product.number; product.number = "external-unique";
  try { assert.deepEqual(await productIds("300"), []); }
  finally { product.number = previous; }
});

test("identity scope preserves role visibility, soft deletion and every filter axis", async () => {
  assert.deepEqual(new Set((await projectQueries.listProjects("engineer", ["ENGINEER"], { ...identity, q: "IdentityToken" })).rows.map(row => row.id)), new Set(["own"]));
  assert.deepEqual(new Set((await productQueries.listProducts("engineer", ["ENGINEER"], { ...identity, q: "IdentityToken" })).rows.map(row => row.id)), new Set(["product-own", "product-partial"]));
  assert.equal((await productQueries.listProducts("engineer", ["ENGINEER"], { ...identity, q: "999.5" })).total, 0);
  assert.equal((await projectQueries.listProjects("engineer", ["ENGINEER"], { ...identity, q: "999" })).total, 0);
  const projectFilter = { ...identity, q: "IdentityToken", clientIds: ["client-own"], managerIds: ["manager-1"], engineerIds: ["engineer"], stages: ["IN_WORK" as const], activeOnly: true };
  assert.deepEqual((await projectQueries.listProjects("manager", ["MANAGER"], projectFilter)).rows.map(row => row.id), ["own"]);
  for (const changed of [{ clientIds: ["client-hidden"] }, { managerIds: ["manager-2"] }, { engineerIds: ["missing"] }, { stages: ["DONE" as const] }])
    assert.equal((await projectQueries.listProjects("engineer", ["ENGINEER"], { ...projectFilter, ...changed })).total, 0);
  const productFilter = { ...identity, q: "199.5", clientIds: ["client-own"], projectIds: ["own"], engineerIds: ["engineer"], statuses: ["DESIGN" as const], activeOnly: true };
  assert.equal((await productQueries.listProducts("manager", ["MANAGER"], productFilter)).total, 2);
  for (const changed of [{ clientIds: ["client-client"] }, { projectIds: ["parent"] }, { engineerIds: ["other"] }, { statuses: ["DONE" as const] }])
    assert.equal((await productQueries.listProducts("manager", ["MANAGER"], { ...productFilter, ...changed })).total, 0);
});

test("default callers retain related search and URL cannot enable a search scope", async () => {
  assert.equal((await projectQueries.listProjects("manager", ["MANAGER"], { activeOnly: false, q: "CustomerToken" })).total, 3);
  assert.equal((await productQueries.listProducts("manager", ["MANAGER"], { activeOnly: false, q: "CustomerToken" })).total, 4);
  assert.deepEqual((await productQueries.listProducts("manager", ["MANAGER"], { activeOnly: false, q: "ParentToken" })).rows.map(row => row.id), ["product-parent"]);
  assert.equal("searchScope" in projectQueries.parseProjectListParams({ searchScope: "identity" }).filters, false);
  assert.equal("searchScope" in productQueries.parseProductListParams({ searchScope: "identity" }).filters, false);
});
