import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire, Module } from "node:module";
import { PrismaClient } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";
import { isValidRolesCombination, hasWorkCoordinator } from "../src/lib/roles";
import { canAccrueOrdinarySalary } from "../src/lib/compensation-policy";
import { productVisibilityWhere } from "../src/server/access/visibility";

const require = createRequire(import.meta.url);
function inject(name: string, exports: Record<string, unknown>) {
  const file = require.resolve(name), stub = new Module(file);
  stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub;
}

/** Только собственные QA-строки существующей local CRM; внешний rollback обязателен. */
async function main() {
  const db = new PrismaClient({ datasources: { db: { url: existingLocalCrmDatabaseUrl() } } });
  const namespace = `qa-role121-${randomUUID()}`;
  const ids = { user: `${namespace}-user`, client: `${namespace}-client`, project: `${namespace}-project`, product: `${namespace}-product` };
  let priceId = "";
  let checked = false;
  const rollback = new Error("ROLE121_EXPECTED_ROLLBACK");
  try {
    try {
      await db.$transaction(async tx => {
        const labels = await tx.$queryRaw<{ enumlabel: string }[]>`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='Role' AND e.enumlabel='WORK_COORDINATOR'`;
        assert.equal(labels.length, 1, "The owner must apply additive role migration first");
        await tx.user.create({ data: { id: ids.user, email: `${namespace}@qa.invalid`, name: "QA 121", passwordHash: "disabled-native-qa-login", roles: ["WORKER", "WORK_COORDINATOR"], payScheme: "PIECE" } });
        await tx.client.create({ data: { id: ids.client, name: "QA 121", phone: "" } });
        const numberInt = ((await tx.project.aggregate({ _max: { numberInt: true } }))._max.numberInt ?? 0) + 1;
        await tx.project.create({ data: { id: ids.project, number: String(numberInt), numberInt, title: "QA 121", clientId: ids.client, stage: "CONTRACT", currency: "BYN" } });
        await tx.product.create({ data: { id: ids.product, number: `${numberInt}.1`, suffixInt: 1, title: "QA 121", projectId: ids.project, status: "PRODUCTION", quantity: 2 } });
        (globalThis as { prisma?: PrismaClient }).prisma = tx as unknown as PrismaClient;
        inject("../src/auth", { auth: async () => ({ user: await tx.user.findUniqueOrThrow({ where: { id: ids.user }, select: { id: true, name: true, roles: true } }) }) });
        inject("next/cache", { revalidatePath: () => {} });
        const prices = await import("../src/server/prices/actions");
        const { addWorkCore } = await import("../src/server/works/core");
        const created = await prices.createPriceItem({ name: namespace, unit: "шт.", price: 100 });
        assert.ok(created.ok && created.id);
        priceId = created.id;
        const actor = { id: ids.user, name: "QA 121", roles: ["WORKER", "WORK_COORDINATOR"] as const, source: "web" as const };
        const before = await addWorkCore({ ...actor, roles: [...actor.roles] }, { projectId: ids.project, productId: ids.product, priceItemId: priceId, quantityPerUnit: 1 }, callback => callback(tx));
        assert.ok(before.ok, before.ok ? undefined : before.error);
        assert.equal((await tx.work.findUniqueOrThrow({ where: { id: before.workId } })).priceSnapshot?.toString(), "100");
        assert.equal((await prices.updatePriceItem(priceId, { name: namespace, unit: "шт.", price: 125 })).ok, true);
        const after = await addWorkCore({ ...actor, roles: [...actor.roles] }, { projectId: ids.project, productId: ids.product, priceItemId: priceId, quantityPerUnit: 1 }, callback => callback(tx));
        assert.ok(after.ok, after.ok ? undefined : after.error);
        const workRows = await tx.work.findMany({ where: { productId: ids.product }, orderBy: { createdAt: "asc" }, select: { id: true, priceSnapshot: true, total: true } });
        assert.equal(workRows.find(row => row.id === before.workId)?.priceSnapshot?.toString(), "100", "Existing Work snapshot must remain frozen after catalog editing");
        assert.equal(workRows.find(row => row.id === after.workId)?.priceSnapshot?.toString(), "125");
        assert.equal(workRows.find(row => row.id === after.workId)?.total?.toString(), "250");
        assert.equal(await tx.changeLog.count({ where: { entity: "priceItem", entityId: priceId, actorId: ids.user } }), 2);
        assert.equal(await tx.product.count({ where: { AND: [{ id: ids.product }, productVisibilityWhere({ id: ids.user, roles: ["MOUNTER", "WORK_COORDINATOR"] })] } }), 0);
        assert.equal(hasWorkCoordinator(["ENGINEER", "WORK_COORDINATOR"]), true);
        assert.equal(canAccrueOrdinarySalary(["ENGINEER", "WORK_COORDINATOR"]), false);
        assert.equal(isValidRolesCombination(["WORK_COORDINATOR"]), false);
        await tx.user.update({ where: { id: ids.user }, data: { roles: ["WORKER"] } });
        await assert.rejects(prices.updatePriceItem(priceId, { name: namespace, unit: "шт.", price: 999 }), /Недостаточно прав/);
        const current = await tx.user.findUniqueOrThrow({ where: { id: ids.user }, select: { roles: true, payScheme: true } });
        assert.deepEqual(current.roles, ["WORKER"]);
        assert.equal(current.payScheme, "PIECE");
        assert.equal((await tx.priceItem.findUniqueOrThrow({ where: { id: priceId } })).price.toString(), "125");
        checked = true;
        throw rollback;
      }, { timeout: 60_000 });
      throw new Error("Native role QA unexpectedly committed");
    } catch (error) {
      if (error !== rollback) throw error;
    }
    assert.equal(checked, true);
    assert.equal(await db.user.count({ where: { id: ids.user } }), 0);
    assert.equal(await db.project.count({ where: { id: ids.project } }), 0);
    assert.equal(await db.client.count({ where: { id: ids.client } }), 0);
    assert.equal(await db.product.count({ where: { id: ids.product } }), 0);
    assert.equal(await db.priceItem.count({ where: { id: priceId } }), 0);
    assert.equal(await db.work.count({ where: { productId: ids.product } }), 0);
    assert.equal(await db.changeLog.count({ where: { actorId: ids.user } }), 0);
    console.log(JSON.stringify({ ok: true, nativeEnum: true, catalogCreateUpdateRevoke: true,
      oldSnapshotPreserved: true, newSnapshotUsesCurrentPrice: true, paySchemeUnchanged: true,
      baseProductVisibilityPreserved: true, rollbackConfirmed: true }));
  } finally {
    await db.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof assert.AssertionError ? error.message : "Role121 native verification failed");
  process.exitCode = 1;
});
