import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { Prisma, type PayrollEntry } from "@prisma/client";
import type { DomainActor } from "@/server/actor";
import {operationJournalContext,journalSnapshot,journalUserReferences,systemJournalActor,PAYROLL_JOURNAL_FIELDS} from './journal';

export class TaskPayrollTransferError extends Error {}

type TaskBinding = { id: string; assigneeId: string | null; projectId: string; productId: string | null; workId: string | null };

/** Переносится только сохранённое обычное начисление самой задачи. */
export async function readTaskPayroll(tx: Prisma.TransactionClient, task: TaskBinding): Promise<PayrollEntry[]> {
  const entries = await tx.payrollEntry.findMany({ where: { taskId: task.id }, orderBy: { id: "asc" } });
  if (entries.some(row => row.compensatesId)) {
    throw Error("У начисления задачи есть компенсация. Проверьте историю в Журнале.");
  }
  if (entries.some(entry => entry.scheme !== "PIECE" || entry.userId !== task.assigneeId ||
    entry.workId !== null && entry.workId !== task.workId || entry.projectId !== null && entry.projectId !== task.projectId ||
    entry.productId !== null && entry.productId !== task.productId || entry.settlementShareId !== null ||
    entry.percentageCompletionShareId !== null || entry.percentageAdjustmentId !== null)) {
    throw new TaskPayrollTransferError("Начисление задачи связано с другой работой или исполнителем");
  }
  return entries;
}

function snapshot(entry: PayrollEntry) {
  return { userId: entry.userId, taskId: entry.taskId, amount: entry.amount.toString(), bynAmount: entry.bynAmount?.toString() ?? null,
    projectAmount: entry.projectAmount?.toString() ?? null, currency: entry.currency, month: entry.month };
}

async function audit(tx: Prisma.TransactionClient, actor: DomainActor, operationId: string, before: PayrollEntry, after: PayrollEntry, child?: PayrollEntry) {
  await writeChangeLogInTransaction(tx, { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "payrollEntry", entityId: before.id, action: "taskTransfer", oldValue: snapshot(before),
    newValue: { ...snapshot(after), operationId, ...(child ? { childEntryId:child.id } : {}) } },
    {...await operationJournalContext(tx,{type:'payrollEntry',id:before.id,label:'Начисление по задаче'},[before],await journalUserReferences(tx,[before.userId,after.userId,child?.userId])),
      ...systemJournalActor(actor,child?'Разделение задачи и её начисления':'Переназначение задачи'),
      before:child?{entries:[{id:before.id,...journalSnapshot(before,PAYROLL_JOURNAL_FIELDS)}]}:journalSnapshot(before,PAYROLL_JOURNAL_FIELDS),
      after:child?{entries:[{id:after.id,...journalSnapshot(after,PAYROLL_JOURNAL_FIELDS)},{id:child.id,...journalSnapshot(child,PAYROLL_JOURNAL_FIELDS)}]}:journalSnapshot(after,PAYROLL_JOURNAL_FIELDS)});
}

export async function moveTaskPayroll(tx: Prisma.TransactionClient, actor: DomainActor, entries: PayrollEntry[], recipientId: string, operationId: string) {
  for (const entry of entries) {
    const updated = await tx.payrollEntry.update({ where: { id: entry.id }, data: { userId: recipientId } });
    await audit(tx, actor, operationId, entry, updated);
  }
}

function splitAmount(value: Prisma.Decimal, percent: string) {
  const transferred = new Prisma.Decimal(value).mul(percent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  return { remaining: new Prisma.Decimal(value).sub(transferred).toFixed(2), transferred: transferred.toFixed(2) };
}

function splitNullable(value: Prisma.Decimal | null, percent: string) {
  return value === null ? { remaining: null, transferred: null } : splitAmount(value, percent);
}

export async function splitTaskPayroll(tx: Prisma.TransactionClient, actor: DomainActor, entries: PayrollEntry[], recipientId: string,
  childTaskId: string, percent: string, operationId: string) {
  for (const entry of entries) {
    const amount = splitAmount(entry.amount, percent), byn = splitNullable(entry.bynAmount, percent), project = splitNullable(entry.projectAmount, percent);
    const updated = await tx.payrollEntry.update({ where: { id: entry.id },
      data: { amount: amount.remaining, bynAmount: byn.remaining, projectAmount: project.remaining } });
    const child = await tx.payrollEntry.create({ data: { userId: recipientId, taskId: childTaskId, workId: entry.workId,
      productId: entry.productId, projectId: entry.projectId, amount: amount.transferred, bynAmount: byn.transferred,
      projectAmount: project.transferred, projectCurrency: entry.projectCurrency, currency: entry.currency,
      scheme: entry.scheme, month: entry.month, comment: entry.comment } });
    await audit(tx, actor, operationId, entry, updated, child);
  }
}
