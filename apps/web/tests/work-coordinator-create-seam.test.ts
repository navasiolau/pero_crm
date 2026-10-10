import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type Role } from "@prisma/client";
import { canCreateOrdinaryWork, canEditOrdinaryWork } from "../src/lib/ordinary-work-access";
import { canAddProductWork } from "../src/server/works/access";
import { addWorkCore } from "../src/server/works/core";
import { listWorkPriceOptions } from "../src/server/works/queries";
import { taskExecutionWhere } from "../src/server/access/visibility";
import { matches, type FixtureRow } from "./helpers/visibility-fixture";

test("coordinator engineer creates on own visible PRODUCTION, without edit/execution, and stale removal denies", async () => {
  let currentRoles: Role[] = ["ENGINEER", "WORK_COORDINATOR"];
  const actor = { id: "engineer", name: "Инженер", roles: [...currentRoles], source: "web" as const };
  const project = { id: "project", number: "121", currency: "BYN", deletedAt: null, products: [], tasks: [] };
  const product = { id: "product", projectId: project.id, project, quantity: 2, engineerId: actor.id,
    status: "PRODUCTION", deletedAt: null, tasks: [] };
  const price = { id: "tariff", name: "Сборка", unit: "шт.", price: new Prisma.Decimal("50"), active: true };
  const works: FixtureRow[] = [], logs: FixtureRow[] = [];
  const db = {
    $queryRaw: async () => [],
    user: { findUnique: async () => ({ id: actor.id, name: actor.name, active: true, roles: currentRoles }) },
    task: { findMany: async () => [] },
    productPercentageParticipant: { findMany: async () => [] },
    project: { findUnique: async ({ where }: { where: FixtureRow }) => matches(project, where) ? project : null },
    product: { findFirst: async ({ where }: { where: FixtureRow }) => matches(product, where) ? product : null },
    orgSetting: { findUnique: async () => ({ value: "BYN" }) },
    priceItem: { findUnique: async () => price, findMany: async () => [price] },
    work: { create: async ({ data }: { data: FixtureRow }) => { const row = { id: `work-${works.length}`, ...data }; works.push(row); return row; } },
    changeLog: { create: async ({ data }: { data: FixtureRow }) => { logs.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  const input = { projectId: project.id, productId: product.id, priceItemId: price.id, quantityPerUnit: 1 };
  const created = await addWorkCore(actor, input, callback => callback(db));
  assert.ok(created.ok, created.ok ? undefined : created.error);
  assert.equal(works.length, 1);
  assert.equal(String(works[0].priceSnapshot), "50");
  assert.equal(new Prisma.Decimal(String(works[0].total)).equals("100"), true);
  assert.equal(canCreateOrdinaryWork(actor.roles), true);
  assert.equal(canAddProductWork(actor.roles, product.status), true, "The visible product enables the create button");
  assert.equal((await listWorkPriceOptions(actor, product.id, db)).length, 1);
  assert.equal(canEditOrdinaryWork(actor.roles, product.status), false);
  assert.equal(matches({ id: "ordinary-task", assigneeId: actor.id, productId: product.id, product, project }, taskExecutionWhere(actor)), false);
  product.engineerId = "other";
  assert.equal((await addWorkCore(actor, input, callback => callback(db))).ok, false, "Knowing a foreign product ID never grants creation");
  product.engineerId = actor.id;
  currentRoles = ["ENGINEER"];
  assert.equal((await addWorkCore(actor, input, callback => callback(db))).ok, false, "The transaction uses current roles after addon removal");
  assert.deepEqual(await listWorkPriceOptions(actor, product.id, db), []);
  assert.equal(works.length, 1);
  assert.equal(logs.length, 1);
});
