import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { engineerFixture, fixtureModel, type FixtureRow } from "./helpers/visibility-fixture";

// Настоящие query/visibility строят выборку; adapter только исполняет её на
// связанных строках, не открывая БД и не подменяя правила доступа.
const base = engineerFixture();
const numberSearch = { activeOnly: false, searchScope: "number" as const };
const projects: FixtureRow[] = [];
const products: FixtureRow[] = [];
for (const [id, number, title, clientName, engineer, stage] of [
  ["own", "199", "Стеллаж 77777 IdentityToken", "CustomerToken 88888", "engineer", "IN_WORK"],
  ["parent", "300", "ParentToken 77777", "Другой клиент", "engineer", "IN_WORK"],
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
    suffixInt: 5, title: id === "own" || id === "hidden" || id === "deleted" ? "Стеллаж 77777 IdentityToken" : "Другая позиция",
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
const projectIds = async (q: string) => (await projectQueries.listProjects("manager", ["MANAGER"], { ...numberSearch, q })).rows.map(row => row.id);
const productIds = async (q: string) => (await productQueries.listProducts("manager", ["MANAGER"], { ...numberSearch, q })).rows.map(row => row.id);

test("list number search matches only own numbers and rejects title/client text and numeric tokens", async () => {
  assert.deepEqual(await projectIds("199"), ["own"]);
  assert.deepEqual(await productIds("199.5"), ["product-partial", "product-own"]);
  for (const query of ["стеллаж", "IDENTITYTOKEN", "77777", "88888", "199 missing", "１９９"]) {
    assert.deepEqual(await projectIds(query), [], `project ${query}`);
    assert.deepEqual(await productIds(query), [], `product ${query}`);
  }
  assert.deepEqual(await projectIds("199.5"), []);
  assert.deepEqual(await productIds("199.5 missing"), []);
  assert.deepEqual(await projectIds("00199"), []);
  assert.deepEqual(await projectIds("123456789"), []);
  assert.deepEqual(await productIds("123456789.1"), []);
  for (const query of [projectQueries.listProjects, productQueries.listProducts]) {
    const result = await query("manager", ["MANAGER"], { ...numberSearch, q: "CustomerToken" }, { page: 1, pageSize: 10 });
    assert.deepEqual(result.rows, []);
    assert.equal(result.total, 0);
  }
});

test("number search ignores descriptions, all client names and parent project names/numbers", async () => {
  for (const query of ["TechnicalToken", "CustomerToken", "SurnameToken", "MiddleToken"]) {
    assert.deepEqual(await projectIds(query), [], `project ${query}`);
    assert.deepEqual(await productIds(query), [], `product ${query}`);
  }
  assert.deepEqual(await productIds("ParentToken"), []);
  // Номер родителя не даёт совпадение, если он не содержится в собственном номере.
  const product = products[1]; const previous = product.number; product.number = "301.5";
  try { assert.deepEqual(await productIds("300"), []); }
  finally { product.number = previous; }
});

test("number scope preserves role visibility, soft deletion and every filter axis", async () => {
  assert.deepEqual((await projectQueries.listProjects("engineer", ["ENGINEER"], { ...numberSearch, q: "199" })).rows.map(row => row.id), ["own"]);
  assert.deepEqual(new Set((await productQueries.listProducts("engineer", ["ENGINEER"], { ...numberSearch, q: "199.5" })).rows.map(row => row.id)), new Set(["product-own", "product-partial"]));
  assert.equal((await productQueries.listProducts("engineer", ["ENGINEER"], { ...numberSearch, q: "999.5" })).total, 1);
  assert.equal((await projectQueries.listProjects("engineer", ["ENGINEER"], { ...numberSearch, q: "999" })).total, 1);
  assert.equal((await productQueries.listProducts("engineer", ["ENGINEER"], { ...numberSearch, q: "998.5" })).total, 0);
  assert.equal((await projectQueries.listProjects("engineer", ["ENGINEER"], { ...numberSearch, q: "998" })).total, 0);
  assert.equal((await productQueries.listProducts("accountant", ["ACCOUNTANT"], { ...numberSearch, q: "199.5" })).total, 0);
  assert.equal((await projectQueries.listProjects("accountant", ["ACCOUNTANT"], { ...numberSearch, q: "199" })).total, 0);
  const projectFilter = { ...numberSearch, q: "199", clientIds: ["client-own"], managerIds: ["manager-1"], engineerIds: ["engineer"], stages: ["IN_WORK" as const], activeOnly: true };
  assert.deepEqual((await projectQueries.listProjects("manager", ["MANAGER"], projectFilter)).rows.map(row => row.id), ["own"]);
  for (const changed of [{ clientIds: ["client-hidden"] }, { managerIds: ["manager-2"] }, { engineerIds: ["missing"] }, { stages: ["DONE" as const] }])
    assert.equal((await projectQueries.listProjects("engineer", ["ENGINEER"], { ...projectFilter, ...changed })).total, 0);
  const productFilter = { ...numberSearch, q: "199.5", clientIds: ["client-own"], projectIds: ["own"], engineerIds: ["engineer"], statuses: ["DESIGN" as const], activeOnly: true };
  assert.equal((await productQueries.listProducts("manager", ["MANAGER"], productFilter)).total, 2);
  for (const changed of [{ clientIds: ["client-client"] }, { projectIds: ["parent"] }, { engineerIds: ["other"] }, { statuses: ["DONE" as const] }])
    assert.equal((await productQueries.listProducts("manager", ["MANAGER"], { ...productFilter, ...changed })).total, 0);
});

test("number search preserves string legacy product identifiers and clearing only removes search", async () => {
  const legacy = ["3.01", "108.13.2", "108-A.01"].map(number => ({ ...products[0], id: `legacy-${number}`, number }));
  products.push(...legacy);
  try {
    for (const number of legacy.map(row => row.number))
      assert.deepEqual(await productIds(` ${number} `), [`legacy-${number}`]);
    assert.deepEqual(await productIds("3.0"), ["legacy-3.01"]);
  } finally { products.splice(products.length - legacy.length, legacy.length); }
  const unfilteredProjects = (await projectQueries.listProjects("manager", ["MANAGER"], numberSearch)).rows.map(row => row.id);
  const unfilteredProducts = (await productQueries.listProducts("manager", ["MANAGER"], numberSearch)).rows.map(row => row.id);
  for (const q of ["", "   "]) {
    assert.deepEqual(await projectIds(q), unfilteredProjects);
    assert.deepEqual(await productIds(q), unfilteredProducts);
    assert.equal((await projectQueries.listProjects("manager", ["MANAGER"], { ...numberSearch, q, clientIds: ["client-own"] })).total, 1);
    assert.equal((await productQueries.listProducts("manager", ["MANAGER"], { ...numberSearch, q, projectIds: ["own"] })).total, 2);
  }
});

test("default callers retain related search and URL cannot enable a search scope", async () => {
  assert.equal((await projectQueries.listProjects("manager", ["MANAGER"], { activeOnly: false, q: "CustomerToken" })).total, 3);
  assert.equal((await productQueries.listProducts("manager", ["MANAGER"], { activeOnly: false, q: "CustomerToken" })).total, 4);
  assert.deepEqual((await productQueries.listProducts("manager", ["MANAGER"], { activeOnly: false, q: "ParentToken" })).rows.map(row => row.id), ["product-parent"]);
  assert.equal("searchScope" in projectQueries.parseProjectListParams({ searchScope: "number" }).filters, false);
  assert.equal("searchScope" in productQueries.parseProductListParams({ searchScope: "number" }).filters, false);
});
