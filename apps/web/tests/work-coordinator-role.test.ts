import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, test } from "node:test";
import type { PrismaClient, Role } from "@prisma/client";
import * as role from "../src/lib/roles";
import { homePathForRoles } from "../src/lib/home-route";
import { navItemsForRole } from "../src/lib/nav";
import { visibleProductStatuses } from "../src/lib/product-statuses";
import { canAccrueOrdinarySalary } from "../src/lib/compensation-policy";
import { authConfig } from "../src/auth.config";
import { workVisibilityWhere, productVisibilityWhere, productAssignmentWriteWhere, hasFullProjectVisibility } from "../src/server/access/visibility";
import { matches } from "./helpers/visibility-fixture";

const coordinator = "WORK_COORDINATOR" as Role;
let roles: Role[] = ["WORKER", coordinator];
const stored = { id: "price", name: "Расценка", unit: "шт.", price: 10, active: true };
const audits: unknown[] = [];
let writes = 0;
const db = {
  priceItem: {
    create: async ({ data }: { data: Partial<typeof stored> }) => { writes++; Object.assign(stored, data); return { ...stored }; },
    findUnique: async () => ({ ...stored }),
    update: async ({ data }: { data: Partial<typeof stored> }) => { writes++; Object.assign(stored, data); return { ...stored }; },
  },
  changeLog: { create: async ({ data }: { data: unknown }) => { audits.push(data); return data; } },
};
let prices: typeof import("../src/server/prices/actions");
const require = createRequire(import.meta.url);
function inject(name: string, exports: Record<string, unknown>) {
  const file = require.resolve(name), stub = new Module(file);
  stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub;
}
before(async () => {
  (globalThis as { prisma?: PrismaClient }).prisma = db as unknown as PrismaClient;
  inject("../src/auth", { auth: async () => ({ user: { id: "employee", name: "Сотрудник", roles } }) });
  inject("next/cache", { revalidatePath: () => {} });
  prices = await import("../src/server/prices/actions");
});

test("coordinator manages a price, keeps base access/pay, and loses catalog writes when removed", async () => {
  assert.equal((await prices.createPriceItem({ name: "Новая расценка", unit: "шт.", price: 100 })).ok, true);
  assert.equal((await prices.updatePriceItem(stored.id, { name: "Новая расценка", unit: "шт.", price: 125 })).ok, true);
  assert.equal(stored.price, 125);
  assert.equal(audits.length, 2, "Price changes retain administrative audit");
  assert.deepEqual(role.normalizeRoles([coordinator, "WORKER", "WORKER"]), ["WORKER", coordinator]);
  assert.equal(role.isValidRolesCombination([coordinator]), false);
  assert.equal(role.isValidRolesCombination(["ADMIN", coordinator]), false);
  assert.equal(role.isValidRolesCombination(["DIRECTOR", coordinator]), false);
  assert.equal(role.isValidRolesCombination(roles), true);
  assert.equal(role.primaryRole(roles), "WORKER");
  assert.equal(role.roleLabels[coordinator], "Ответственный за работы");
  assert.equal(homePathForRoles(roles), "/my");
  assert.equal(canAccrueOrdinarySalary(["ENGINEER", coordinator]), false, "Addition must not change pure engineer compensation");
  assert.deepEqual(visibleProductStatuses(roles).map(row => row.id), ["PRODUCTION", "STORAGE"]);
  assert.deepEqual(visibleProductStatuses(["MOUNTER", coordinator]).map(row => row.id), ["INSTALLATION"]);
  const baseMenu = navItemsForRole(["WORKER"]).map(item => item.href);
  const menu = navItemsForRole(roles).map(item => item.href);
  assert.equal(menu.includes("/prices"), true);
  assert.deepEqual(menu.filter(path => path !== "/prices"), baseMenu);
  const authorize = (actorRoles: Role[], path: string) => authConfig.callbacks.authorized({
    auth: { user: { id: "employee", roles: actorRoles } }, request: { nextUrl: new URL(`https://qa.invalid${path}`) },
  } as never);
  assert.equal(await authorize(roles, "/prices"), true);
  assert.equal(await authorize(["ACCOUNTANT", coordinator], "/prices"), true);
  assert.ok(await authorize(["ACCOUNTANT", coordinator], "/products") instanceof Response);
  assert.ok(await authorize(roles, "/finance") instanceof Response);
  assert.ok(await authorize(roles, "/settings/users") instanceof Response);
  const actor = { id: "engineer", roles: ["ENGINEER", coordinator] as Role[] };
  const product = { id: "p", engineerId: actor.id, status: "PRODUCTION", deletedAt: null, project: { deletedAt: null, stage: "CONTRACT" }, tasks: [] };
  assert.equal(hasFullProjectVisibility(actor), false);
  assert.equal(matches(product, productVisibilityWhere(actor)), true);
  assert.equal(matches({ project: product.project, productId: "p", product, paymentKind: "LEGACY", stagePayPoolId: null, poolWeightUnits: null, tasks: [] }, workVisibilityWhere(actor)), true, "A created ordinary work remains readable on the already visible product");
  assert.equal(matches({ ...product, engineerId: "other" }, productVisibilityWhere(actor)), true);
  assert.equal(matches({ ...product, engineerId: "other" }, productAssignmentWriteWhere(actor)), false);
  roles = ["WORKER"];
  const writesBeforeRemoval = writes;
  await assert.rejects(prices.updatePriceItem(stored.id, { name: "Запрещено", unit: "шт.", price: 999 }), /Недостаточно прав/);
  assert.equal(writes, writesBeforeRemoval);
});
