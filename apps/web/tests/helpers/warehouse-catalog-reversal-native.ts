import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { previewJournalReversalInTransaction, reverseJournalActionInTransaction } from "../../src/server/changelog/reversal-core";
import { writeChangeLogInTransaction } from "../../src/server/changelog/writer";
import { createMaterialUnitInTransaction, deleteMaterialUnitInTransaction } from "../../src/server/warehouse/unit-core";
import { createMaterialInTransaction } from "../../src/server/warehouse/material-core";
import { addMaterialNorm, updateMaterialNorm, deleteMaterialNorm } from "../../src/server/warehouse/norm-core";
import { catalogCommand, needSnapshot } from "../../src/server/warehouse/catalog-reversal-contract";
import { journalProductContext } from "../../src/server/finance/journal";

export async function verifyWarehouseCatalogNative(tx: Prisma.TransactionClient) {
  const run = randomUUID();
  const user = await tx.user.create({ data: { email: `${run}@example.invalid`, name: "Проверка №256", passwordHash: "QA256_NO_LOGIN", roles: ["ADMIN"] } });
  const actor = { id: user.id, name: user.name, roles: user.roles, source: "web" as const };
  const reverse = async (entryId: string, scope: { kind: "global" } | { kind: "product"; id: string } = { kind: "global" }) => {
    const request = { entryId, requestId: randomUUID(), scope };
    await previewJournalReversalInTransaction(tx, actor.id, request);
    const result = await reverseJournalActionInTransaction(tx, actor.id, request);
    assert.equal((await reverseJournalActionInTransaction(tx, actor.id, request)).reversalId, result.reversalId);
    return result;
  };
  const findRoot = (entityId: string, action: string) => tx.changeLog.findFirstOrThrow({ where: { entityId, action }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const unitInput = { name: `QA256-${run.slice(0, 8)}` };
  const unit = await createMaterialUnitInTransaction(tx, actor, unitInput);
  const undoCreate = await reverse((await findRoot(unit.id, "create")).id);
  assert.ok((await tx.materialUnit.findUniqueOrThrow({ where: { id: unit.id } })).deletedAt);
  await reverse(undoCreate.reversalId);
  assert.equal((await tx.materialUnit.findUniqueOrThrow({ where: { id: unit.id } })).deletedAt, null);
  await deleteMaterialUnitInTransaction(tx, actor, unit.id);
  assert.equal((await createMaterialUnitInTransaction(tx, actor, unitInput)).id, unit.id);

  const result = await createMaterialInTransaction(actor, { name: "Проверка №256", unitId: unit.id }, tx);
  if (!result.ok) throw Error(result.error);
  const materialId = result.material.id;
  await assert.rejects(() => deleteMaterialUnitInTransaction(tx, actor, unit.id), /используется/);
  const client = await tx.client.create({ data: { name: "Проверка №256", phone: "QA256" } });
  const numberInt = 1_800_000_000 + Number.parseInt(run.slice(0, 7), 16);
  const project = await tx.project.create({ data: { number: String(numberInt), numberInt, clientId: client.id, title: "Проверка №256", currency: "BYN" } });
  const product = await tx.product.create({ data: { number: `${numberInt}.1`, suffixInt: 1, projectId: project.id,
    title: "Проверка №256", quantity: 2, status: "PRODUCTION" } });
  const scope = { kind: "product" as const, id: product.id }, input = { productId: product.id, materialId, quantityPerUnit: 1 };
  await assert.rejects(() => addMaterialNorm(tx, { ...input, productId: "missing" }, actor), /Изделие не найдено/);
  const { line } = await addMaterialNorm(tx, input, actor);
  const removed = await deleteMaterialNorm(tx, line.id, actor);
  const deletion = await writeChangeLogInTransaction(tx, { actorType: "user", actorId: actor.id, entity: "projectMaterial",
    entityId: line.id, action: "delete", reversal: await catalogCommand(tx, { entity: "projectMaterial", before: removed.line, after: removed.after }) },
    { kind: "event", entity: { label: "Потребность" }, contexts: [journalProductContext(product)],
      before: needSnapshot(removed.line), after: needSnapshot(removed.after) });
  assert.ok((await tx.projectMaterial.findUniqueOrThrow({ where: { id: line.id } })).deletedAt);
  await reverse(deletion.id, scope);
  const restored = await tx.projectMaterial.findUniqueOrThrow({ where: { id: line.id } });
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.quantity.toFixed(3), "2.000");
  await deleteMaterialNorm(tx, line.id, actor);
  const readded = await addMaterialNorm(tx, { ...input, quantityPerUnit: 3 }, actor);
  assert.equal(readded.line.id, line.id);
  assert.equal(readded.line.quantity.toFixed(3), "6.000");
  const edited = await updateMaterialNorm(tx, { id: line.id, quantityPerUnit: 4 }, actor);
  const editLog = await writeChangeLogInTransaction(tx, { actorType: "user", actorId: actor.id, entity: "projectMaterial",
    entityId: line.id, action: "update", reversal: await catalogCommand(tx, { entity: "projectMaterial", before: edited.line, after: edited.updated }) },
    { kind: "event", entity: { label: "Потребность" }, contexts: [journalProductContext(product)],
      before: needSnapshot(edited.line), after: needSnapshot(edited.updated) });
  const movement = await tx.stockMovement.create({ data: { materialId, productId: product.id, projectMaterialId: line.id,
    type: "EXPENSE", quantity: "0.125", unitPrice: "1.00", totalByn: "0.13" } });
  await assert.rejects(() => previewJournalReversalInTransaction(tx, actor.id, { entryId: editLog.id, scope }), /складские движения/);
  assert.equal((await tx.stockMovement.findUniqueOrThrow({ where: { id: movement.id } })).projectMaterialId, line.id);
  return { stableUnitId: true, stableNeedId: true, protectedUnitReferences: true, lockedAfterLaterMovement: true };
}
