import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { PostgresRows } from "../integration/postgres.fixture";
import { reverseJournalActionInTransaction } from "../../src/server/changelog/reversal-core";
import { projectProductsVersion, softDeleteProjectCore } from "../../src/server/projects/delete-core";
import { softDeleteProductCore } from "../../src/server/products/delete-core";
import { createProjectInTransaction } from "../../src/server/projects/core";
import { createProductInTransaction } from "../../src/server/products/core";

export async function verifyCardVisibility(tx: Prisma.TransactionClient, rows: PostgresRows) {
  const director = await rows.user("card-director", ["DIRECTOR"]);
  const actor = { id: director.id, name: director.name, roles: director.roles, source: "web" as const };
  const project = await rows.project("card-project");
  const make = (suffixInt: number) => tx.product.create({ data: {
    projectId: project.id, number: `${project.number}.${suffixInt}`, suffixInt, title: "Позиция " + suffixInt,
  } });
  const one = await make(1), two = await make(2), three = await make(3);
  const deleteId = randomUUID();
  const deleted = await softDeleteProductCore(tx, actor, { productId: two.id, clientMutationId: deleteId,
    expectedUpdatedAt: two.updatedAt.toISOString() });
  assert(deleted.ok);
  assert.equal((await tx.product.findUniqueOrThrow({ where: { id: three.id } })).number, two.number);
  await tx.product.update({ where: { id: three.id }, data: { title: "Независимая правка" } });
  const scope = { kind: "global" };
  const undo = await reverseJournalActionInTransaction(tx, director.id, { entryId: "product-delete:" + deleteId, scope, requestId: randomUUID() });
  const restored = await tx.product.findUniqueOrThrow({ where: { id: two.id } });
  const sibling = await tx.product.findUniqueOrThrow({ where: { id: three.id } });
  assert.equal(restored.deletedAt, null); assert.equal(restored.number, two.number);
  assert.equal(sibling.number, three.number); assert.equal(sibling.title, "Независимая правка");
  await reverseJournalActionInTransaction(tx, director.id, { entryId: undo.reversalId, scope, requestId: randomUUID() });
  assert((await tx.product.findUniqueOrThrow({ where: { id: two.id } })).deletedAt);
  const children = await tx.product.findMany({ where: { projectId: project.id } });
  const current = await tx.project.findUniqueOrThrow({ where: { id: project.id } });
  const projectDeleteId = randomUUID();
  const result = await softDeleteProjectCore(tx, actor, { projectId: project.id, clientMutationId: projectDeleteId,
    expectedUpdatedAt: current.updatedAt.toISOString(), expectedProductsVersion: projectProductsVersion(children) });
  assert(result.ok);
  const grouped = await tx.changeLog.findFirstOrThrow({ where: { entity: "product", entityId: one.id, operationRootId: "project-delete:" + projectDeleteId } });
  await reverseJournalActionInTransaction(tx, director.id, { entryId: grouped.id, scope, requestId: randomUUID() });
  const active = await tx.product.findMany({ where: { projectId: project.id, deletedAt: null }, select: { id: true } });
  assert.deepEqual(active.map(row => row.id).sort(), [one.id, three.id].sort());
  assert.equal((await tx.project.findUniqueOrThrow({ where: { id: project.id } })).deletedAt, null);
  const made = await createProjectInTransaction(tx, actor, { title: "Приёмка создания", clientId: project.clientId, currency: "BYN" });
  const createdProject = await tx.changeLog.findFirstOrThrow({ where: { entity: "project", entityId: made.project.id, action: "create" } });
  const added = await createProductInTransaction(tx, actor, { projectId: made.project.id, title: "Приёмка позиции" });
  assert(added.ok);
  await assert.rejects(reverseJournalActionInTransaction(tx, director.id,
    { entryId: createdProject.id, scope, requestId: randomUUID() }), /зависимые|состав/i);
  const createdProduct = await tx.changeLog.findFirstOrThrow({ where: { entity: "product", entityId: added.product.id, action: "create" } });
  const hidden = await reverseJournalActionInTransaction(tx, director.id, { entryId: createdProduct.id, scope, requestId: randomUUID() });
  assert((await tx.product.findUniqueOrThrow({ where: { id: added.product.id } })).deletedAt);
  const hiddenProject = await reverseJournalActionInTransaction(tx, director.id, { entryId: createdProject.id, scope, requestId: randomUUID() });
  assert((await tx.project.findUniqueOrThrow({ where: { id: made.project.id } })).deletedAt);
  await reverseJournalActionInTransaction(tx, director.id, { entryId: hiddenProject.reversalId, scope, requestId: randomUUID() });
  await reverseJournalActionInTransaction(tx, director.id, { entryId: hidden.reversalId, scope, requestId: randomUUID() });
  assert.equal((await tx.product.findUniqueOrThrow({ where: { id: added.product.id } })).deletedAt, null);
  return { restoredSameProduct: true, siblingNumbers: true, independentEdit: true, projectGroup: active.length, priorDeletionPreserved: true, creationAndDependencies: true };
}
