import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { PrismaClient, ProductStatus } from "@prisma/client";
import { engineerFixture, fixtureModel, type FixtureRow } from "./helpers/visibility-fixture";

const base = engineerFixture();
const rows: FixtureRow[] = Array.from({ length: 8 }, (_, index) => {
  const project = { ...base.projects[0], id: `p${index}`, numberInt: index, clientId: `c${index}`, deletedAt: index === 7 ? new Date(0) : null };
  return { ...base.products[0], id: `product-${index}`, projectId: project.id, project, suffixInt: 1,
    engineerId: index === 3 ? "e3" : index % 2 ? "e2" : "e1", status: index === 1 ? "DONE" : index === 2 ? "PRODUCTION" : "DESIGN",
    deletedAt: index === 6 ? new Date(0) : null };
});
const participants: FixtureRow[] = [
  { userId: "e2", config: { kind: "ENGINEERING", productId: "product-3", product: rows[3] } },
  { userId: "e2", config: { kind: "ENGINEERING", productId: "product-6", product: rows[6] } },
];
const db = { ...base.db, product: fixtureModel(rows), productPercentageParticipant: fixtureModel(participants), task: fixtureModel([]) } as unknown as PrismaClient;
let queries: typeof import("../src/server/products/queries");
before(async () => {
  (globalThis as { prisma?: PrismaClient }).prisma = db;
  queries = await import("../src/server/products/queries");
});

test("product parser reads arrays/scalars, ignores empty/invalid axes and defaults to inactive filter", () => {
  const result = queries.parseProductListParams({ status: '["PRODUCTION","DESIGN"]', project: '["p2","p1"]', client: "c1", engineer: '["e2","e1"]', active: "1" });
  assert.deepEqual(result.filters.statuses, ["DESIGN", "PRODUCTION"]);
  assert.deepEqual(result.filters.projectIds, ["p1", "p2"]);
  assert.deepEqual(result.filters.clientIds, ["c1"]);
  assert.deepEqual(result.filters.engineerIds, ["e1", "e2"]);
  assert.equal(result.filters.activeOnly, true);
  assert.equal(queries.parseProductListParams({}).filters.activeOnly, false);
  assert.equal(queries.parseProductListParams({ active: "0" }).filters.activeOnly, false);
  const ignored = queries.parseProductListParams({ status: '["bad"]', project: "[]", engineer: '[1]', client: "c1" });
  assert.equal(ignored.filters.statuses, undefined);
  assert.equal(ignored.filters.projectIds, undefined);
  assert.equal(ignored.filters.engineerIds, undefined);
  assert.deepEqual(ignored.filters.clientIds, ["c1"]);
});

test("product status/project/client/engineer arrays OR within each axis and AND across search/activity", async () => {
  const filters = { activeOnly: false, statuses: ["DESIGN", "DONE"] as ProductStatus[], projectIds: ["p0", "p1", "p3", "p5"], clientIds: ["c0", "c1", "c2", "c3", "c4"], engineerIds: ["e1", "e2"] };
  const result = await queries.listProducts("manager", ["MANAGER"], filters, { page: 1, pageSize: 10 });
  assert.deepEqual(new Set(result.rows.map((row) => row.id)), new Set(["product-0", "product-1", "product-3"]));
  assert.equal(result.total, 3);
  assert.equal((await queries.listProducts("manager", ["MANAGER"], { ...filters, activeOnly: true })).total, 2);
  assert.equal((await queries.listProducts("manager", ["MANAGER"], { ...filters, q: "own" })).total, 3);
  assert.equal((await queries.listProducts("manager", ["MANAGER"], { ...filters, q: "missing" })).total, 0);
});

test("empty product axes preserve other restrictions and allow unassigned visible products", async () => {
  const unassigned = { ...rows[0], id: "unassigned", engineerId: null };
  rows.push(unassigned);
  try {
    for (const key of ["statuses", "projectIds", "clientIds", "engineerIds"] as const) {
      assert.equal((await queries.listProducts("manager", ["MANAGER"], { activeOnly: false, [key]: [] })).total, 7, key);
      const partial = await queries.listProducts("manager", ["MANAGER"], { activeOnly: false, ...(key === "projectIds" ? { clientIds: ["c1"] } : { projectIds: ["p1"] }), [key]: [] });
      assert.equal(partial.total, 1, key);
    }
  } finally { rows.pop(); }
});

test("selected engineer participants union across users but cannot bypass roles or deleted products/projects", async () => {
  const original = rows[5].engineerId;
  rows[5].engineerId = "e3";
  participants.push({ userId: "e1", config: { kind: "ENGINEERING", productId: "product-5", product: rows[5] } });
  try {
    const filters = { activeOnly: false, engineerIds: ["e1", "e2"] };
    const manager = await queries.listProducts("manager", ["MANAGER"], filters);
    assert.deepEqual(new Set(manager.rows.map((row) => row.id)), new Set(["product-0", "product-1", "product-2", "product-3", "product-4", "product-5"]));
    const engineer = await queries.listProducts("e1", ["ENGINEER"], filters);
    assert.deepEqual(new Set(engineer.rows.map((row) => row.id)), new Set(["product-0", "product-2", "product-4"]));
    assert.equal((await queries.listProducts("e1", ["ENGINEER"], { activeOnly: false, engineerIds: ["e2"] })).total, 0);
    const worker = await queries.listProducts("field", ["WORKER"], filters);
    assert.deepEqual(worker.rows.map((row) => row.id), ["product-2","product-1"]);
    assert.ok(worker.rows.every(row=>row.expectedPrice===null));
    assert.equal((await queries.listProducts("field", ["MOUNTER"], filters)).total, 2);
  } finally { rows[5].engineerId = original; participants.pop(); }
});

test("scalar product callers remain compatible while explicit plural empty overrides them", async () => {
  assert.equal((await queries.listProducts("manager", ["MANAGER"], { activeOnly: false, status: "DONE", projectId: "p1", clientId: "c1", engineerId: "e2" })).total, 1);
  assert.equal((await queries.listProducts("manager", ["MANAGER"], { activeOnly: false, engineerId: "e2", engineerIds: [], projectIds: ["p0"] })).total, 1);
});
