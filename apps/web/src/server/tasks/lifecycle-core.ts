import type { Prisma } from "@prisma/client";
import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";
import { allocatedWorkQuantity, quantityAtoms } from "@/lib/work-shares";
import { scaleNorm } from "@/lib/product-quantity";
import type { DomainActor } from "@/server/actor";
import { liveChildWhere, liveWorkWhere } from "@/server/access/live-entities";
import { taskVisibilityWhere, workVisibilityWhere } from "@/server/access/visibility";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { journalSnapshot, journalTaskReferences, journalUserReferences, operationJournalContext, TASK_JOURNAL_FIELDS, WORK_JOURNAL_FIELDS } from "./journal";
import { workTaskLifecycleCommand, type WorkTaskLifecycle } from "./lifecycle-contract";
import { taskRecipientError } from "./share-policy";

export class WorkTaskLifecycleRefusal extends Error {}

async function loadActor(tx: Prisma.TransactionClient, actorId: string) {
  const current = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, name: true, roles: true, active: true } });
  if (!current?.active || !hasAnyRole(current.roles, MANAGER_ROLES)) throw new WorkTaskLifecycleRefusal("Недостаточно прав");
  return current;
}

const ownerInclude = {
  project: { select: { id: true, number: true } },
  product: { select: { id: true, number: true, quantity: true, status: true, engineerId: true, projectId: true } },
} as const;

async function inspect(tx: Prisma.TransactionClient, actorId: string, entity: WorkTaskLifecycle["entity"], id: string, expected?: WorkTaskLifecycle) {
  const actor = await loadActor(tx, actorId);
  const restoring = expected?.deleted === true;
  if (entity === "work") {
    const row = await tx.work.findUnique({
      where: { ...liveChildWhere, id, ...(!restoring && { AND: [workVisibilityWhere(actor)] }) },
      include: { ...ownerInclude, _count: { select: { paymentConversions: true, settlementShares: true, allocationGroups: true,
        tasks: { where: { deletedAt: null } } } } },
    });
    if (!row || Boolean(row.deletedAt) !== restoring || (expected && row.journalRevision !== expected.revision))
      throw new WorkTaskLifecycleRefusal("Работа отсутствует или изменилась");
    if (row.paymentKind !== "LEGACY" || row.stagePayPoolId || row.poolWeightUnits !== null ||
        row._count.paymentConversions || row._count.settlementShares || row._count.allocationGroups)
      throw new WorkTaskLifecycleRefusal("История процентной или распределённой работы защищена");
    if (!restoring && row._count.tasks) throw new WorkTaskLifecycleRefusal("К работе привязаны действующие задачи — сначала удалите их");
    if (await tx.payrollEntry.count({ where: { workId: id } })) throw new WorkTaskLifecycleRefusal("По работе уже есть начисления");
    if (restoring && row.product && row.quantityPerUnit &&
        !row.quantity.eq(scaleNorm(row.quantityPerUnit.toString(), row.product.quantity, 2, 10)))
      throw new WorkTaskLifecycleRefusal("Количество изделия изменилось. Исторический объём работы больше не совпадает с текущей нормой");
    return { entity, actor, row, references: [] };
  }

  const row = await tx.task.findUnique({
    where: { ...liveChildWhere, id, ...(!restoring && { AND: [taskVisibilityWhere(actor)] }) },
    include: { ...ownerInclude, work: { select: { paymentKind: true } },
      _count: { select: { payrollEntries: true, timeEntries: true, stageSettlementShares: true } },
      dependencies: { where: { deletedAt: null }, select: { dependsOnId: true } },
      dependents: { where: { deletedAt: null }, select: { taskId: true, task: { select: { deletedAt: true, status: true,
        _count: { select: { payrollEntries: true, stageSettlementShares: true } } } } } },
    },
  });
  if (!row || Boolean(row.deletedAt) !== restoring || (expected && row.journalRevision !== expected.revision))
    throw new WorkTaskLifecycleRefusal("Задача отсутствует или изменилась");
  if (row.work?.paymentKind === "ENGINEERING" || row.allocationGroupId)
    throw new WorkTaskLifecycleRefusal("Задача входит в распределение работы — её долю можно передать или перераспределить");
  if (row.status === "DONE" || row._count.payrollEntries || row._count.stageSettlementShares)
    throw new WorkTaskLifecycleRefusal("Выполненную или начисленную задачу изменить нельзя");
  if (row._count.timeEntries) throw new WorkTaskLifecycleRefusal("Задачу с историческими записями времени изменить нельзя");
  if (row.dependents.some(({ task }) => !task.deletedAt && (task.status === "DONE" || task._count.payrollEntries || task._count.stageSettlementShares)))
    throw new WorkTaskLifecycleRefusal("У зависимой задачи уже есть выработка — изменение предшественника недоступно");
  if (restoring && row.dependents.some(({ task }) => !task.deletedAt && task.status === "IN_PROGRESS"))
    throw new WorkTaskLifecycleRefusal("Зависимая задача уже выполняется — восстановление изменит её предпосылки");
  if (restoring && row.workId) {
    const work = await tx.work.findUnique({ where: { ...liveWorkWhere, id: row.workId },
      include: { tasks: { where: { deletedAt: null }, select: { quantity: true, allocationGroupId: true } } } });
    if (!work || work.projectId !== row.projectId || work.productId !== row.productId)
      throw new WorkTaskLifecycleRefusal("Сначала восстановите связанную работу");
    let allocation: string;
    try { allocation = allocatedWorkQuantity([...work.tasks, row]); }
    catch { throw new WorkTaskLifecycleRefusal("Не удалось проверить прежний объём работы"); }
    if (quantityAtoms(allocation) > quantityAtoms(work.quantity))
      throw new WorkTaskLifecycleRefusal("Объём связанной работы уже распределён между другими задачами");
  }
  if (restoring && row.assigneeId) {
    const assignee = await tx.user.findUnique({ where: { id: row.assigneeId }, select: { id: true, active: true, roles: true } });
    const error = assignee ? taskRecipientError(assignee, row.product) : "Исполнитель не найден";
    if (error) throw new WorkTaskLifecycleRefusal(error);
  }
  const references = await journalTaskReferences(tx, [
    ...row.dependencies.map(edge => edge.dependsOnId), ...row.dependents.map(edge => edge.taskId),
  ]);
  references.push(...await journalUserReferences(tx, [row.assigneeId]));
  return { entity, actor, row, references };
}

export async function previewWorkTaskLifecycle(tx: Prisma.TransactionClient, actorId: string, command: WorkTaskLifecycle) {
  await inspect(tx, actorId, command.entity, command.id, command);
}

export async function changeWorkTaskLifecycle(tx: Prisma.TransactionClient, actor: DomainActor, entity: WorkTaskLifecycle["entity"], id: string,
  expected?: WorkTaskLifecycle, operation = "delete", recordRoot = true) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
  if (entity === "task") {
    await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${id} FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT id FROM "Work" WHERE id = ${id} FOR UPDATE`;
  }
  const state = await inspect(tx, actor.id, entity, id, expected);
  const { row } = state;
  const data = row.deletedAt ? { deletedAt: null, deletedById: null } : { deletedAt: new Date(), deletedById: actor.id };
  const updated = entity === "work" ? await tx.work.update({ where: { id }, data }) : await tx.task.update({ where: { id }, data });
  const fields = [...(entity === "work" ? WORK_JOURNAL_FIELDS : TASK_JOURNAL_FIELDS), "deletedAt"];
  const before = journalSnapshot(row, fields), after = journalSnapshot(updated, fields);
  const hints = await operationJournalContext(tx, { type: entity, id, label: row.title }, [row], state.references);
  const inverse = { entity, id, revision: updated.journalRevision, deleted: updated.deletedAt !== null };
  if (recordRoot) await writeChangeLogInTransaction(tx, {
    entity, entityId: id, action: operation, actorType: "user", actorId: actor.id, actorName: state.actor.name,
    source: actor.source, oldValue: before, newValue: after, reversal: workTaskLifecycleCommand(inverse),
  }, { ...hints, before, after, kind: "event" });
  return { row, before, after, hints, inverse,
    cachePaths: ["/tasks", "/my", "/calendar", "/changelog", `/projects/${row.projectId}`,
      ...(row.productId ? [`/products/${row.productId}`, `/products/${row.product?.number ?? row.productId}`] : [])] };
}
