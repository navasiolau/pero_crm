import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { canAssignExpenseProject } from "@/lib/expense-project-assignment";
import { INTERNAL_CURRENCY, PROJECT_CURRENCY_ERROR } from "@/lib/internal-currency";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { journalProjectContext } from "@/server/finance/journal";
import type { DomainActor } from "@/server/actor";

const identifier = z.string().trim().min(1).max(200);
const nullableId = identifier.nullable();
const assignmentInput = z.object({
  paymentId: identifier, expectedProjectId: nullableId, expectedHead: nullableId, projectId: nullableId,
}).strict();

const projectContext = z.object({
  projectId: nullableId, projectAmount: z.string().regex(/^-?\d{1,10}\.\d{2}$/).nullable(), currency: z.string().max(12).nullable(),
}).strict().refine(context => context.projectId === null
  ? context.projectAmount === null && context.currency === null
  : context.projectAmount !== null && context.currency !== null);
type AssignmentContext = z.infer<typeof projectContext>;

const commandSchema = z.object({
  expected: projectContext, target: projectContext, expectedHead: nullableId, priorHead: nullableId,
}).strict();
type AssignmentCommand = z.infer<typeof commandSchema>;

const selectProject = { id: true, number: true, currency: true, deletedAt: true } satisfies Prisma.ProjectSelect;
const paymentSelect = {
  id: true, direction: true, deletedAt: true, deletionId: true, lastActionId: true, amount: true, currency: true, bynAmount: true,
  projectId: true, projectAmount: true, project: { select: selectProject }, logisticsAllocationId: true,
  stockPurchase: { select: { id: true } },
  expenseReceipts: { where: { cancelledAt: null }, take: 1, select: { id: true } },
} satisfies Prisma.PaymentSelect;
type AssignmentPayment = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;
type AssignmentProject = Prisma.ProjectGetPayload<{ select: typeof selectProject }>;

function readPayment(tx: Prisma.TransactionClient, paymentId: string) {
  return tx.payment.findUnique({ where: { id: paymentId }, select: paymentSelect });
}

function expenseProblem(payment: AssignmentPayment | null) {
  if (!payment || payment.deletedAt || payment.deletionId || payment.direction !== "EXPENSE")
    return "Действующий расход не найден";
  if (payment.logisticsAllocationId) return "Проекты расхода по рейсу меняются в логистике";
  if (payment.stockPurchase || payment.expenseReceipts.length) return "Складской расход нельзя переназначить через эту операцию";
  if (payment.project?.deletedAt) return "Проект в архиве. Расход доступен для просмотра";
  return null;
}

function storedContext(payment: AssignmentPayment): AssignmentContext {
  return { projectId: payment.projectId, projectAmount: payment.projectAmount?.toFixed(2) ?? null, currency: payment.project?.currency ?? null };
}

function sameContext(left: AssignmentContext, right: AssignmentContext) {
  return left.projectId === right.projectId && left.projectAmount === right.projectAmount && left.currency === right.currency;
}

async function readProject(tx: Prisma.TransactionClient, id: string | null) {
  return id ? tx.project.findUnique({ where: { id, deletedAt: null }, select: selectProject }) : null;
}

function assignmentHints(payment: AssignmentPayment, project: AssignmentProject | null, before: AssignmentContext, after: AssignmentContext) {
  const contexts = [payment.project, project].flatMap(item => item ? [journalProjectContext(item)] : []);
  const oldValue = { projectId: before.projectId, project: payment.project?.number ?? null, projectAmount: before.projectAmount };
  const newValue = { projectId: after.projectId, project: project?.number ?? null, projectAmount: after.projectAmount };
  return { oldValue, newValue, hints: {
    entity: { label: `Расход ${payment.amount.toString()} ${payment.currency}` },
    contexts, links: contexts.map(context => ({ type: "project", id: context.id, label: context.label, href: context.href })),
    before: oldValue, after: newValue,
  } };
}

export function assignmentCachePaths(projectIds: readonly string[]) {
  return ["/finance/expenses", "/finance/projects", "/finance/accounts/report", "/changelog",
    ...new Set(projectIds.flatMap(id => [`/projects/${encodeURIComponent(id)}`, `/finance/projects/${encodeURIComponent(id)}`]))];
}

// Общий денежный lock защищает Payment и складские операции. Строки проектов
// удерживаем до commit, чтобы архивирование или смена валюты не прошли между проверкой и записью.
async function lockProjects(tx: Prisma.TransactionClient, from: string | null, to: string | null) {
  const ids = [...new Set([from, to].flatMap(id => id ? [id] : []))].sort();
  if (ids.length) await tx.$queryRaw`SELECT id FROM "Project" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`;
}

async function writeAssignment(tx: Prisma.TransactionClient, payment: AssignmentPayment, target: AssignmentContext, head: string | null) {
  const result = await tx.payment.updateMany({
    where: { id: payment.id, direction: "EXPENSE", deletedAt: null, deletionId: null, lastActionId: payment.lastActionId,
      projectId: payment.projectId, projectAmount: payment.projectAmount, logisticsAllocationId: null, stockPurchase: { is: null },
      expenseReceipts: { none: { cancelledAt: null } } },
    data: { projectId: target.projectId, projectAmount: target.projectAmount, lastActionId: head },
  });
  if (result.count !== 1) throw new JournalReversalRefusal("Расход изменился. Обновите карточку");
}

export async function assignOrdinaryExpenseProjectInTransaction(actor: DomainActor, input: unknown, tx: Prisma.TransactionClient) {
  if (!canAssignExpenseProject(actor.roles)) throw new JournalReversalRefusal("Недостаточно прав");
  const parsed = assignmentInput.safeParse(input);
  if (!parsed.success) throw new JournalReversalRefusal("Некорректные данные назначения");
  const { paymentId, expectedProjectId, expectedHead, projectId } = parsed.data;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, roles: true, name: true } });
  if (!user?.active || !canAssignExpenseProject(user.roles)) throw new JournalReversalRefusal("Недостаточно прав");

  await lockProjects(tx, expectedProjectId, projectId);
  const payment = await readPayment(tx, paymentId);
  const problem = expenseProblem(payment);
  if (problem || !payment) throw new JournalReversalRefusal(problem ?? "Действующий расход не найден");
  if (payment.projectId !== expectedProjectId || payment.lastActionId !== expectedHead)
    throw new JournalReversalRefusal("Расход изменился. Обновите карточку");
  if (projectId === payment.projectId) return { changed: false } as const;

  const project = await readProject(tx, projectId);
  if (projectId && !project) throw new JournalReversalRefusal("Выбранный проект недоступен");
  if (project && project.currency !== INTERNAL_CURRENCY) throw new JournalReversalRefusal(PROJECT_CURRENCY_ERROR);

  const before = storedContext(payment);
  const after = { projectId, projectAmount: project ? payment.bynAmount.toFixed(2) : null, currency: project?.currency ?? null };
  const id = randomUUID();
  await writeAssignment(tx, payment, after, id);
  const { oldValue, newValue, hints } = assignmentHints(payment, project, before, after);
  await writeChangeLogInTransaction(tx, {
    id, entity: "payment", entityId: paymentId, action: "payment.project-assignment", source: actor.source,
    actorType: "user", actorId: actor.id, actorName: user.name, oldValue, newValue,
    reversal: ordinaryExpenseProjectReversal.command({ expected: after, target: before, expectedHead: id, priorHead: expectedHead }),
  }, hints);
  return { changed: true, id, cachePaths: assignmentCachePaths(hints.contexts.map(context => context.id)) } as const;
}

async function inspectReversal(tx: Prisma.TransactionClient, paymentId: string, command: AssignmentCommand) {
  const payment = await readPayment(tx, paymentId);
  const reason = expenseProblem(payment);
  if (reason || !payment) throw new JournalReversalRefusal(reason ?? "Действующий расход не найден");
  if (payment.lastActionId !== command.expectedHead || !sameContext(storedContext(payment), command.expected))
    throw new JournalReversalRefusal("Расход изменился после этого назначения. Сначала отмените более позднее действие");
  const project = await readProject(tx, command.target.projectId);
  if (command.target.projectId && (!project || project.currency !== command.target.currency))
    throw new JournalReversalRefusal("Прежний проект недоступен или его валюта изменилась");
  return { payment, project };
}

export const ordinaryExpenseProjectReversal = defineJournalReversal({
  kind: "payment.project-assignment", version: 1, schema: commandSchema,
  async preview({ tx, entityId }, command) {
    try { await inspectReversal(tx, entityId, command); return null; }
    catch (error) { if (error instanceof JournalReversalRefusal) return error.message; throw error; }
  },
  async apply({ tx, entityId }, command) {
    await lockProjects(tx, command.expected.projectId, command.target.projectId);
    const { payment, project } = await inspectReversal(tx, entityId, command);
    await writeAssignment(tx, payment, command.target, command.priorHead);
    const effect = assignmentHints(payment, project, command.expected, command.target);
    return { ...effect, cachePaths: assignmentCachePaths(effect.hints.contexts.map(context => context.id)),
      inverse: { expected: command.target, target: command.expected, expectedHead: command.priorHead, priorHead: command.expectedHead } };
  },
});
