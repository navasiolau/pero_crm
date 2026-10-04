import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { engineerFixture, fixtureModel, type FixtureRow } from "./helpers/visibility-fixture";

const base = engineerFixture();
const rows: FixtureRow[] = Array.from({ length: 8 }, (_, index) => {
  const project: FixtureRow = {
    ...base.projects[0], id: `p${index}`, number: `P${index}`, numberInt: index, title: `Project ${index}`,
    clientId: `c${index}`, managerId: index === 4 ? "m2" : "m1", stage: index === 1 ? "DONE" : index === 2 ? "REFUSED" : "IN_WORK",
    initialPrice: 0, delivery: 0, unloading: 0, installation: 0,
    products: [], tasks: [], works: [], files: [], stageHistory: [],
  };
  project.products = [{ ...base.products[0], id: `product-${index}`, projectId: project.id, project,
    engineerId: index === 3 ? "e3" : index % 2 ? "e2" : "e1", status: "DESIGN", quantity: 1,
    deletedAt: index === 6 ? new Date(0) : null }];
  if (index === 7) project.deletedAt = new Date(0);
  return project;
});
const participants: FixtureRow[] = [
  { userId: "e2", config: { kind: "ENGINEERING", productId: "product-3", product: (rows[3].products as FixtureRow[])[0] } },
  { userId: "e2", config: { kind: "ENGINEERING", productId: "product-6", product: (rows[6].products as FixtureRow[])[0] } },
];
const db = { ...base.db, project: fixtureModel(rows), productPercentageParticipant: fixtureModel(participants), task: fixtureModel([]) } as unknown as PrismaClient;
let queries: typeof import("../src/server/projects/queries");
before(async () => {
  (globalThis as { prisma?: PrismaClient }).prisma = db;
  queries = await import("../src/server/projects/queries");
});

test("project parser accepts arrays and legacy scalars with all/none and new activity default", () => {
  const result = queries.parseProjectListParams({ client: '["c5","c1","c3","c2","c4"]', engineer: '["e2","e1"]', manager: "m1", stage: '["DONE","IN_WORK"]', active: "1" });
  assert.deepEqual(result.filters.clientIds, ["c1", "c2", "c3", "c4", "c5"]);
  assert.deepEqual(result.filters.engineerIds, ["e1", "e2"]);
  assert.deepEqual(result.filters.managerIds, ["m1"]);
  assert.deepEqual(result.filters.stages, ["DONE", "IN_WORK"]);
  assert.equal(result.filters.activeOnly, true);
  assert.equal(queries.parseProjectListParams({}).filters.activeOnly, false);
  assert.equal(queries.parseProjectListParams({ active: "0" }).filters.activeOnly, false);
  assert.equal(queries.parseProjectListParams({}).filters.clientIds, undefined);
  assert.deepEqual(queries.parseProjectListParams({ client: "[]", stage: '["bad"]', engineer: '[1]' }).filters.clientIds, []);
  assert.deepEqual(queries.parseProjectListParams({ stage: '["bad"]' }).filters.stages, []);
});

test("two engineers and five clients union within each axis and intersect manager/stage axes", async () => {
  const filters = { activeOnly: false, engineerIds: ["e1", "e2"], clientIds: ["c0", "c1", "c2", "c3", "c4"], managerIds: ["m1"], stages: ["IN_WORK", "DONE"] as const };
  const result = await queries.listProjects("manager", ["MANAGER"], { ...filters, stages: [...filters.stages] }, { page: 1, pageSize: 10 });
  assert.deepEqual(new Set(result.rows.map((row) => row.id)), new Set(["p0", "p1", "p3"]));
  assert.equal(result.total, 3);
  assert.equal((await queries.listProjects("manager", ["MANAGER"], { ...filters, stages: [...filters.stages], activeOnly: true })).total, 2);
});

test("explicit none for any axis returns no rows; absent axes include unassigned projects", async () => {
  for (const key of ["stages", "clientIds", "managerIds", "engineerIds"] as const) {
    const result = await queries.listProjects("manager", ["MANAGER"], { activeOnly: false, [key]: [] });
    assert.equal(result.total, 0, key);
  }
  const unassigned = { ...rows[0], id: "unassigned", numberInt: 99, clientId: null, managerId: null, products: [] };
  rows.push(unassigned);
  try {
    assert.ok((await queries.listProjects("manager", ["MANAGER"], { activeOnly: false })).rows.some((row) => row.id === "unassigned"));
  } finally { rows.pop(); }
});

test("multi-engineer participants cannot bypass project/product visibility or live filters", async () => {
  const filters = { activeOnly: false, engineerIds: ["e1", "e2", "e3"] };
  const engineer = await queries.listProjects("e1", ["ENGINEER"], filters);
  assert.deepEqual(new Set(engineer.rows.map((row) => row.id)), new Set(["p0", "p2", "p4"]));
  assert.ok(engineer.rows.every((row) => row.products.every((product) => ["product-0", "product-2", "product-4"].includes(product.id))));
  assert.equal((await queries.listProjects("e1", ["ENGINEER"], { activeOnly: false, engineerIds: ["e2"] })).total, 0);
  const manager = await queries.listProjects("manager", ["MANAGER"], filters);
  assert.deepEqual(new Set(manager.rows.map((row) => row.id)), new Set(["p0", "p1", "p2", "p3", "p4", "p5"]));
});

test("engineer filter unions participant products of every selected engineer", async () => {
  const product = (rows[5].products as FixtureRow[])[0];
  const originalEngineer = product.engineerId;
  product.engineerId = "e3";
  participants.push({ userId: "e1", config: { kind: "ENGINEERING", productId: product.id, product } });
  try {
    const selected = await queries.listProjects("manager", ["MANAGER"], { activeOnly: false, engineerIds: ["e1", "e2"], clientIds: ["c3", "c5"] });
    assert.deepEqual(new Set(selected.rows.map((row) => row.id)), new Set(["p3", "p5"]));
    assert.equal((await queries.listProjects("manager", ["MANAGER"], { activeOnly: false, engineerIds: ["e1"], clientIds: ["c3", "c5"] })).total, 1);
    assert.equal((await queries.listProjects("manager", ["MANAGER"], { activeOnly: false, engineerIds: ["e2"], clientIds: ["c3", "c5"] })).total, 1);
  } finally { product.engineerId = originalEngineer; participants.pop(); }
});

test("legacy scalar callers still filter and explicit plural selection takes precedence", async () => {
  assert.equal((await queries.listProjects("manager", ["MANAGER"], { activeOnly: false, clientId: "c1", engineerId: "e2", stage: "DONE" })).total, 1);
  assert.equal((await queries.listProjects("manager", ["MANAGER"], { activeOnly: false, clientId: "c1", clientIds: [] })).total, 0);
});
