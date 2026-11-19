import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { liveTaskWhere, liveWorkWhere, activeTaskDependencyWhere } from "../../src/server/access/live-entities";
import { taskVisibilityWhere, fileVisibilityWhere } from "../../src/server/access/visibility";
import { deleteTaskInTransaction } from "../../src/server/tasks/delete-core";
import { changeWorkTaskLifecycle } from "../../src/server/tasks/lifecycle-core";
import { updateTaskInTransaction } from "../../src/server/tasks/update-core";
import { addWorkCore } from "../../src/server/works/core";
import { updateWorkCore } from "../../src/server/works/update-core";
import { workPlanRevision } from "../../src/server/works/plan";
import { previewJournalReversalInTransaction, reverseJournalActionInTransaction } from "../../src/server/changelog/reversal-core";

export async function verifyWorkTaskReversalNative(tx: Prisma.TransactionClient) {
  const run = randomUUID();
  const actorRow = await tx.user.create({ data: { name: "Проверка №250", email: `${run}@example.invalid`, passwordHash: "QA250_NO_LOGIN", roles: ["DIRECTOR"] } });
  const actor = { id: actorRow.id, name: actorRow.name, roles: actorRow.roles, source: "web" as const };
  const worker = await tx.user.create({ data: { name: "Проверка №250", email: `${run}-worker@example.invalid`, passwordHash: "QA250_NO_LOGIN", roles: ["WORKER"] } });
  const client = await tx.client.create({ data: { name: "Проверка №250", phone: "QA250" } });
  const numberInt = 1_500_000_000 + Number.parseInt(run.slice(0, 7), 16);
  const project = await tx.project.create({ data: { clientId: client.id, title: "Проверка №250", numberInt, number: String(numberInt), currency: "BYN", stage: "CONTRACT" } });
  const product = await tx.product.create({ data: { projectId: project.id, title: "Проверка №250", number: `${numberInt}.1`, suffixInt: 1, status: "PRODUCTION" } });
  const tariff = await tx.priceItem.create({ data: { name: "Проверка №250", price: "5.00", unit: "шт" } });
  const transaction = async <T>(operation: (db: Prisma.TransactionClient) => Promise<T>) => operation(tx);
  const created = await addWorkCore(actor, { projectId: project.id, productId: product.id, priceItemId: tariff.id, quantity: 10 }, transaction);
  if (!created.ok) throw Error(created.error);
  const workId = created.workId;
  const reverse = async (entityId: string, action: string) => {
    const row = await tx.changeLog.findFirstOrThrow({ where: { entityId, action, reversal: { not: Prisma.DbNull } }, orderBy: [{createdAt:"desc"},{id:"desc"}] });
    const command = { entryId: row.id, requestId: randomUUID(), scope: { kind: "product", id: product.id } };
    await previewJournalReversalInTransaction(tx, actor.id, command);
    return reverseJournalActionInTransaction(tx, actor.id, command);
  };
  const createReversed = await reverse(workId, "create");
  assert.equal(await tx.work.count({ where: { ...liveWorkWhere, id: workId } }), 0);
  await reverseJournalActionInTransaction(tx, actor.id, { entryId: createReversed.reversalId, requestId: randomUUID(), scope: { kind: "product", id: product.id } });
  assert.equal(await tx.work.count({ where: { ...liveWorkWhere, id: workId } }), 1);
  const task = (title: string) => tx.task.create({ data: { projectId: project.id, productId: product.id, workId, title, type: "Производство",
    assigneeId: worker.id, status: "NEW", quantity: "1.00", dueAt: new Date("2026-11-20T11:00:00Z") } });
  const before = await task("Предшественник"), middle = await task("Замена"), after = await task("Зависимая задача");
  await tx.taskDependency.createMany({ data: [{ taskId: middle.id, dependsOnId: before.id }, { taskId: after.id, dependsOnId: middle.id }] });
  const file = await tx.file.create({ data: { projectId: project.id, productId: product.id, taskId: middle.id,
    fileName: "Проверка №250.pdf", storedName: `qa250-${run}.pdf`, mimeType: "application/pdf", size: 1, section: "PRODUCTION" } });
  assert.equal((await updateTaskInTransaction(tx, actor, middle.id, { title: "Изменённый заголовок" })).ok, true);
  await tx.task.update({ where: { id: middle.id }, data: { dueAt: new Date("2026-11-21T11:00:00Z") } });
  await reverse(middle.id, "update");
  const editUndone = await tx.task.findUniqueOrThrow({ where: { id: middle.id } });
  assert.equal(editUndone.title, middle.title);
  assert.equal(editUndone.dueAt?.toISOString(), "2026-11-21T11:00:00.000Z");
  const work = await tx.work.findUniqueOrThrow({ where: { id: workId }, include: { tasks: { where: { deletedAt: null } } } });
  const edited = await updateWorkCore(actor, { workId, projectId: project.id, productId: product.id, quantity: 12,
    expectedRevision: workPlanRevision(work), clientMutationId: randomUUID() }, transaction);
  assert.equal(edited.ok, true);
  await reverse(workId, "update");
  assert.equal((await tx.work.findUniqueOrThrow({ where: { id: workId } })).quantity.toFixed(2), "10.00");
  assert.equal((await deleteTaskInTransaction(tx, actor, middle.id)).ok, true);
  assert.equal(await tx.task.count({ where: { ...liveTaskWhere, id: middle.id } }), 0);
  assert.equal(await tx.task.count({ where: { AND: [taskVisibilityWhere(worker), { id: middle.id }] } }), 0);
  assert.equal(await tx.file.count({ where: { AND: [fileVisibilityWhere(worker), { id: file.id }] } }), 0);
  assert.equal((await tx.file.findUniqueOrThrow({ where: { id: file.id } })).taskId, middle.id);
  const edges = { OR: [{ taskId: middle.id }, { dependsOnId: middle.id }] };
  assert.equal(await tx.taskDependency.count({ where: edges }), 2);
  assert.equal(await tx.taskDependency.count({ where: { AND: [edges, activeTaskDependencyWhere] } }), 0);
  const restored = await reverse(middle.id, "delete");
  assert.ok(restored.reversalId);
  assert.equal(await tx.taskDependency.count({ where: { AND: [edges, activeTaskDependencyWhere] } }), 2);
  assert.equal(await tx.task.count({ where: { ...liveTaskWhere, id: middle.id } }), 1);
  assert.equal((await tx.file.findUniqueOrThrow({ where: { id: file.id } })).taskId, middle.id);
  await assert.rejects(() => changeWorkTaskLifecycle(tx, actor, "work", workId), /действующие задачи/);
  await tx.task.update({ where: { id: after.id }, data: { status: "DONE" } });
  const refused = await deleteTaskInTransaction(tx, actor, middle.id);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? "" : refused.error, /выработка/);
  return { workCreateUndoRedo: true, workEdit: true, taskEditWithIndependentChange: true, taskDeleteRestore: true, fileAndEdges: true };
}
