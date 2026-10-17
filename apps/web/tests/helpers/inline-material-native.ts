import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "../../src/server/actor";
import { warehouseMetadataGate } from "../../src/server/warehouse/gate";
import { createMaterialInTransaction } from "../../src/server/warehouse/material-core";

/** Только guarded outer rollback оркестратора; используются существующие единицы, новые не создаются. */
export async function verifyInlineMaterialNative(tx: Prisma.TransactionClient, actor: DomainActor) {
  await warehouseMetadataGate(tx);
  const unit = await tx.materialUnit.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  assert.ok(unit, "QA179_EXISTING_UNIT_REQUIRED");
  const before = await Promise.all([tx.material.count(), tx.changeLog.count(), tx.payment.count(), tx.payout.count(), tx.stockMovement.count(), tx.warehouseBalance.count(), tx.materialUnit.count()]);
  const name = "QA179 " + randomUUID();
  const created = await createMaterialInTransaction(actor, { name: "  " + name + "  ", unitId: unit.id, sku: "  QA179  ", minStock: 0.125, comment: "  Примечание  " }, tx);
  assert.ok(created.ok); if (!created.ok) return;
  assert.equal(created.material.name, name); assert.equal(created.material.unit, unit.name); assert.equal(created.material.sku, "QA179"); assert.equal(created.material.stock, 0);
  const record = await tx.material.findUniqueOrThrow({ where: { id: created.material.id } });
  assert.equal(record.purchasePrice?.toFixed(2), "0.00"); assert.equal(record.minStock?.toString(), "0.125"); assert.equal(record.comment, "Примечание");
  const audit = await tx.changeLog.findFirstOrThrow({ where: { entity: "material", entityId: record.id, action: "create", actorId: actor.id } });
  assert.equal((audit.newValue as { unit: string }).unit, unit.name);
  assert.equal((await createMaterialInTransaction({ ...actor, roles: ["ACCOUNTANT"] }, { name, unitId: unit.id }, tx)).ok, false);
  assert.equal((await createMaterialInTransaction(actor, { name, unitId: unit.id, categoryId: randomUUID() }, tx)).ok, false);
  await assert.rejects(createMaterialInTransaction(actor, { name, unitId: randomUUID() }, tx), /Единица/);
  const broken = new Proxy(tx, { get(target, key) {
    if (key === "changeLog") return new Proxy(target.changeLog, { get(delegate, method) {
      if (method === "create") return () => { throw Error("QA179_AUDIT_FAILURE"); };
      return Reflect.get(delegate, method);
    } });
    return Reflect.get(target, key);
  } });
  await tx.$executeRawUnsafe("SAVEPOINT qa179_audit");
  try { await assert.rejects(createMaterialInTransaction(actor, { name: "QA179 rollback " + randomUUID(), unitId: unit.id }, broken), /QA179_AUDIT_FAILURE/); }
  finally { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT qa179_audit"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT qa179_audit"); }
  assert.deepEqual(await Promise.all([tx.material.count(), tx.changeLog.count(), tx.payment.count(), tx.payout.count(), tx.stockMovement.count(), tx.warehouseBalance.count(), tx.materialUnit.count()]), [before[0] + 1, before[1] + 1, ...before.slice(2)]);
  return { canonicalOption: true, existingUnit: true, zeroStockAndPrice: true, warehouseRoleBoundary: true, auditRollback: true, noMoneyOrStockMovement: true };
}
