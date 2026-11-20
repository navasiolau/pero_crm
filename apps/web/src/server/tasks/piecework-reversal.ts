import { Prisma } from "@prisma/client";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { liveWorkWhere } from "@/server/access/live-entities";
import { allocatedWorkQuantity, FULL_SHARE_UNITS, moneyAtoms, quantityAtoms } from "@/lib/work-shares";
import { journalSnapshot, operationJournalContext, TASK_JOURNAL_FIELDS } from "./journal";
import { pieceworkRecipientError } from "./piecework-policy";
import { pieceworkUndoKind, pieceworkUndoSchema, taskShareSnapshot, type PieceworkUndo } from "./piecework-reversal-contract";

const stale = "Состав или доли работы изменились. Откройте актуальную запись";
const payroll = { payrollEntries: true, stageSettlementShares: true, timeEntries: true } as const;
function refuse(message: string): never { throw new JournalReversalRefusal(message); }

async function inspect(tx: Prisma.TransactionClient, data: PieceworkUndo) {
  const work = await tx.work.findUnique({
    where: { ...liveWorkWhere, id: data.workId },
    include: {
      product: { select: { id: true, number: true, status: true, engineerId: true, projectId: true } },
      project: { select: { id: true, currency: true, number: true } },
      tasks: { where: { deletedAt: null }, include: { _count: { select: payroll } } },
      _count: { select: { settlementShares: true, paymentConversions: true } },
    },
  });
  if (!work?.product || work.paymentKind !== "LEGACY" || work.stagePayPoolId || work.poolWeightUnits !== null ||
      work._count.settlementShares || work._count.paymentConversions || work.project.currency !== "BYN")
    refuse("Связанная работа недоступна или защищена расчётом");
  if (data.ordinaryRate !== null && (work.priceSnapshot === null || !new Prisma.Decimal(work.priceSnapshot).eq(data.ordinaryRate)))
    refuse("Ставка обычной работы изменилась");
  const group = await tx.taskAllocationGroup.findUnique({ where: { id: data.groupId } });
  if (!group || group.workId !== work.id || group.budgetSource !== "TASK_FIXED" || group.currency !== data.currency ||
      group.quantity === null || !new Prisma.Decimal(group.quantity).eq(data.quantity) ||
      group.budget === null || !new Prisma.Decimal(group.budget).eq(data.budget))
    refuse("Исходный денежный снимок группы изменился");
  const expected = new Map(data.tasks.map(task => [task.id, task]));
  const rows = await tx.task.findMany({
    where: { id: { in: data.tasks.map(task => task.id) } },
    include: {
      _count: { select: payroll },
      assignee: { select: { id: true, active: true, roles: true, payScheme: true } },
      dependencies: { where: { deletedAt: null }, select: { dependsOn: { select: { deletedAt: true, projectId: true, productId: true } } } },
      dependents: { where: { deletedAt: null, task: { deletedAt: null } }, select: { taskId: true, task: { select: { status: true, _count: { select: payroll } } } } },
    },
  });
  const active = work.tasks.filter(task => task.allocationGroupId === group.id);
  const expectedActive = new Set(data.activeGroupIds);
  if (active.length !== expectedActive.size || active.some(row => !expectedActive.has(row.id)) || rows.length !== expected.size ||
      rows.some(row => row.workId !== work.id || row.productId !== work.productId || row.projectId !== work.projectId ||
        row.journalRevision !== expected.get(row.id)?.revision || Boolean(row.deletedAt) !== expected.get(row.id)?.deleted))
    refuse(stale);
  if ([...active, ...rows].some(row => row.status === "DONE" || row._count.payrollEntries ||
      row._count.stageSettlementShares || row._count.timeEntries))
    refuse("В группе есть закрытая задача, начисление или учёт времени");
  for (const row of rows) {
    const action = expected.get(row.id)!;
    if (action.deleted !== action.restoreDeleted &&
        row.dependents.some(({ taskId, task }) => !data.affectedDependents.includes(taskId) || task.status !== "NEW" ||
          task._count.payrollEntries || task._count.stageSettlementShares || task._count.timeEntries))
      refuse("Есть зависимая задача, которая уже выполняется или была добавлена позже");
    if (action.deleted && !action.restoreDeleted) {
      if (row.dependencies.some(({ dependsOn }) => dependsOn.deletedAt || dependsOn.projectId !== row.projectId ||
          dependsOn.productId !== row.productId)) refuse("Одна из исходных зависимостей недоступна");
      const error = row.assignee ? pieceworkRecipientError(row.assignee, work.product) : "Исполнитель недоступен";
      if (error) refuse(error);
    }
  }
  const projected = [...work.tasks.filter(row => !expected.has(row.id)), ...rows.flatMap(row => {
    const action = expected.get(row.id)!;
    return action.restoreDeleted ? [] : [{ ...row, ...(action.restoreShare ?? {}) }];
  })];
  let nextQuantity: string;
  try { nextQuantity = allocatedWorkQuantity(projected); }
  catch { refuse("Объём связанной работы не согласован"); }
  if (quantityAtoms(nextQuantity) > quantityAtoms(work.quantity)) refuse("Свободный объём связанной работы уже распределён");
  const nextGroup = projected.filter(row => row.allocationGroupId === group.id);
  if (nextGroup.length && (nextGroup.some(row => row.physicalOnlyShare || row.stageShareUnits !== null ||
      row.quantity === null || !new Prisma.Decimal(row.quantity).eq(group.quantity!) || row.shareUnits === null || row.shareAmount === null) ||
      nextGroup.reduce((sum, row) => sum + row.shareUnits!, 0) !== FULL_SHARE_UNITS ||
      nextGroup.reduce((sum, row) => sum + moneyAtoms(row.shareAmount!), BigInt(0)) !== moneyAtoms(group.budget!)))
    refuse("После отката объём, доли и бюджет группы не совпадут");
  return { work, rows, expected, nextGroup };
}

export const pieceworkReversal = defineJournalReversal({
  kind: pieceworkUndoKind,
  version: 1,
  schema: pieceworkUndoSchema,
  async preview(ctx, data) {
    try {
      await inspect(ctx.tx, data);
      return null;
    } catch (error) {
      if (error instanceof JournalReversalRefusal) return error.message;
      throw error;
    }
  },
  async apply(ctx, data) {
    const { tx, actor } = ctx;
    await tx.$queryRaw`SELECT id FROM "Work" WHERE id = ${data.workId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Task" WHERE id IN (${Prisma.join(data.tasks.map(task => task.id))}) ORDER BY id FOR UPDATE`;
    const { work, rows, expected, nextGroup } = await inspect(tx, data);
    const updated = [];
    for (const row of rows) {
      const action = expected.get(row.id)!;
      const visibility = action.deleted === action.restoreDeleted ? {} : action.restoreDeleted
        ? { deletedAt: new Date(), deletedById: actor.id } : { deletedAt: null, deletedById: null };
      const after = await tx.task.update({ where: { id: row.id, journalRevision: action.revision },
        data: { ...visibility, ...(action.restoreShare ?? {}), splitRevision: { increment: 1 } } });
      updated.push(after);
    }
    const hints = await operationJournalContext(tx, { type: "taskAllocationGroup", id: data.groupId, label: work.title },
      [{ ...work, product: work.product, project: work.project }], rows.map(row => ({ type: "task", id: row.id, label: row.title })));
    const fields = [...TASK_JOURNAL_FIELDS, "deletedAt"];
    return {
      inverse: { ...data, activeGroupIds: nextGroup.map(row => row.id), tasks: updated.map(row => {
        const prior = rows.find(previous => previous.id === row.id)!;
        return { id: row.id, revision: row.journalRevision, deleted: Boolean(row.deletedAt), restoreDeleted: Boolean(prior.deletedAt),
          restoreShare: expected.get(row.id)?.restoreShare ? taskShareSnapshot(prior) : null };
      }) },
      hints,
      oldValue: { tasks: rows.map(row => ({ taskId: row.id, ...journalSnapshot(row, fields) })) },
      newValue: { tasks: updated.map(row => ({ taskId: row.id, ...journalSnapshot(row, fields) })) },
      cachePaths: ["/tasks", "/my", "/calendar", "/changelog", `/projects/${work.projectId}`, `/products/${work.productId}`,
        `/products/${work.product?.number ?? work.productId}`],
    };
  },
});