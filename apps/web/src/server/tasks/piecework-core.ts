import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertInternalCurrency, assertProjectMoneyCurrency } from "@/lib/internal-currency";
import { canManagePiecework, canTransferPiecework } from "@/lib/piecework-policy";
import { allocatePiecework, allocatedWorkQuantity, FULL_SHARE_UNITS, moneyAtoms, quantityAtoms, quantityFromAtoms, splitAllocation, taskPieceAmount } from "@/lib/work-shares";
import { liveChildWhere, liveProductWhere } from "@/server/access/live-entities";
import { productVisibilityWhere, resolveVisibilityActor } from "@/server/access/visibility";
import type { DomainActor } from "@/server/projects/core";
import { withTaskTransaction, type TaskTransaction } from "./transaction";
import { pieceworkRecipientError } from "./piecework-policy";
import { pieceworkPlanRevision } from "./piecework-revision";

const id = z.string().min(1).max(128);
const participant = z.object({ userId: id, percent: z.string().trim().min(1).max(8) }).strict();
export const createPieceworkSchema = z.object({
  projectId: id, productId: id, workId: id, title: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(80), quantity: z.string().trim().min(1).max(32),
  dueAt: z.string().min(1).max(64).nullish().default(null), requiresPhoto: z.boolean().default(false),
  dependencyIds: z.array(id).max(100).default([]), participants: z.array(participant).min(1), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/), clientMutationId: z.uuid().transform(value => value.toLowerCase()),
}).strict();
export const transferPieceworkSchema = z.object({
  taskId: id, recipientId: id, percent: z.string().trim().min(1).max(8),
  expectedRevision: z.number().int().nonnegative(), clientMutationId: z.uuid().transform(value => value.toLowerCase()),
}).strict();
export type CreatePieceworkInput = z.input<typeof createPieceworkSchema>;
export type TransferPieceworkInput = z.input<typeof transferPieceworkSchema>;
export type PieceworkSuccess = {
  ok: true; groupId: string; taskIds: string[]; recipientIds: string[]; projectId: string; productId: string;
  eventIds: string[]; repeated: boolean;
};
export type PieceworkResult = PieceworkSuccess | { ok: false; kind: "validation" | "forbidden" | "conflict" | "failure"; error: string };
type FailureKind = Extract<PieceworkResult, { ok: false }>["kind"];
class PieceworkRule extends Error { constructor(message: string, readonly kind: FailureKind = "validation") { super(message); } }
function deny(message: string, kind: FailureKind = "validation"): never { throw new PieceworkRule(message, kind); }
function object(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
const fingerprint = (command: string, data: unknown) => createHash("sha256").update(JSON.stringify({ command, data })).digest("hex");
const receiptId = (uuid: string) => `piecework-v1:${uuid}`;

async function activeActor(tx: Prisma.TransactionClient, actor: DomainActor) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR UPDATE`;
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: { id: true, name: true, roles: true, active: true } });
  if (!current?.active) deny("Недостаточно прав", "forbidden");
  return current;
}

async function accessibleProduct(tx: Prisma.TransactionClient, actor: { id: string; roles: DomainActor["roles"] }, productId: string, projectId?: string) {
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${productId} FOR UPDATE`;
  const visibility = await resolveVisibilityActor(tx, actor);
  const product = await tx.product.findFirst({
    where: { ...liveProductWhere, id: productId, ...(projectId ? { projectId } : {}), AND: [productVisibilityWhere(visibility)] },
    select: { id: true, projectId: true, status: true, engineerId: true, project: { select: { currency: true } } },
  });
  if (!product) deny("Изделие не найдено или недоступно", "forbidden");
  return product;
}

const ordinaryWorkInclude = { tasks: { select: { id: true, quantity: true, allocationGroupId: true } }, _count: { select: { paymentConversions: true, settlementShares: true } } } as const;
async function ordinaryWork(tx: Prisma.TransactionClient, workId: string, projectId: string, productId: string) {
  await tx.$queryRaw`SELECT id FROM "Work" WHERE id=${workId} FOR UPDATE`;
  const work = await tx.work.findUnique({ where: { ...liveChildWhere, id: workId }, include: ordinaryWorkInclude });
  if (!work || work.projectId !== projectId || work.productId !== productId || work.paymentKind !== "LEGACY" ||
    work.stagePayPoolId !== null || work.poolWeightUnits !== null || work._count.paymentConversions || work._count.settlementShares)
    deny("Распределять можно только обычную работу этого изделия без фондов и расчётов этапов");
  return work;
}

async function readReceipt(tx: Prisma.TransactionClient, actorId: string, uuid: string, hash: string): Promise<PieceworkSuccess | null> {
  const receipt = await tx.changeLog.findUnique({ where: { id: receiptId(uuid) } });
  if (!receipt) return null;
  const saved = object(receipt.newValue), result = object(saved?.result);
  if (receipt.actorId !== actorId || receipt.entity !== "taskAllocationGroup" || receipt.action !== "piecework.v1" || saved?.fingerprint !== hash ||
    result?.ok !== true || typeof result.groupId !== "string" || typeof result.projectId !== "string" || typeof result.productId !== "string" ||
    !Array.isArray(result.taskIds) || !result.taskIds.every(value => typeof value === "string") ||
    !Array.isArray(result.recipientIds) || !result.recipientIds.every(value => typeof value === "string"))
    deny("Идентификатор операции уже использован для другого распределения", "conflict");
  return { ok: true, groupId: result.groupId, projectId: result.projectId, productId: result.productId,
    taskIds: result.taskIds as string[], recipientIds: result.recipientIds as string[], eventIds: [], repeated: true };
}

async function saveReceipt(tx: Prisma.TransactionClient, actor: DomainActor, uuid: string, hash: string, result: PieceworkSuccess, snapshot: unknown) {
  await tx.changeLog.create({ data: {
    id: receiptId(uuid), actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "taskAllocationGroup", entityId: result.groupId, action: "piecework.v1",
    newValue: JSON.parse(JSON.stringify({ fingerprint: hash, result, snapshot })) as Prisma.InputJsonValue,
  } });
}

async function validateRecipients(tx: Prisma.TransactionClient, ids: string[], product: Parameters<typeof pieceworkRecipientError>[1]) {
  for (const userId of [...ids].sort()) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
  const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, active: true, roles: true, payScheme: true } });
  if (users.length !== ids.length) deny("Сотрудник не найден");
  for (const user of users) { const error = pieceworkRecipientError(user, product); if (error) deny(error); }
}

async function dependenciesFor(tx: Prisma.TransactionClient, ids: string[], projectId: string, productId: string) {
  if (!ids.length) return [];
  const selected = await tx.task.findMany({ where: { ...liveChildWhere, id: { in: ids }, projectId, productId }, select: { id: true, allocationGroupId: true } });
  if (selected.length !== ids.length) deny("Одна из зависимостей недоступна");
  const groups = [...new Set(selected.flatMap(task => task.allocationGroupId ? [task.allocationGroupId] : []))];
  const parts = groups.length ? await tx.task.findMany({ where: { allocationGroupId: { in: groups } }, select: { id: true, projectId: true, productId: true } }) : [];
  if (parts.some(task => task.projectId !== projectId || task.productId !== productId)) deny("Зависимость принадлежит другому изделию");
  return [...new Set([...selected, ...parts].map(task => task.id))];
}

async function run(operation: () => Promise<PieceworkResult>): Promise<PieceworkResult> {
  try { return await operation(); }
  catch (error) { return error instanceof PieceworkRule ? { ok: false, kind: error.kind, error: error.message }
    : { ok: false, kind: "failure", error: "Результат не подтверждён. Повторите прежний запрос с тем же идентификатором." }; }
}

export async function createPieceworkAllocationCore(actor: DomainActor, input: unknown, transaction: TaskTransaction = withTaskTransaction): Promise<PieceworkResult> {
  const parsed = createPieceworkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, kind: "validation", error: "Проверьте данные работы, исполнителей и проценты" };
  const data = parsed.data, dueAt = data.dueAt == null ? null : new Date(data.dueAt);
  let quantity: string, participants: typeof data.participants;
  try {
    quantity = quantityFromAtoms(quantityAtoms(data.quantity));
    if (quantityAtoms(quantity) <= BigInt(0) || quantityAtoms(quantity) > BigInt("9999999999")) deny("Укажите допустимый положительный объём");
    const allocation = allocatePiecework("0", data.participants.map(row => row.percent));
    participants = data.participants.map((row, index) => ({ userId: row.userId, percent: allocation[index].percent }));
  } catch (error) { return { ok: false, kind: "validation", error: error instanceof Error ? error.message : "Некорректное распределение" }; }
  if (dueAt && !Number.isFinite(dueAt.getTime())) return { ok: false, kind: "validation", error: "Укажите корректный срок" };
  if (new Set(participants.map(row => row.userId)).size !== participants.length) return { ok: false, kind: "validation", error: "Каждый исполнитель должен встречаться один раз" };
  const dependencyIds = [...new Set(data.dependencyIds)].sort();
  const hash = fingerprint("create", { ...data, quantity, participants, dependencyIds, dueAt: dueAt?.toISOString() ?? null });
  return run(() => transaction(async tx => {
    const current = await activeActor(tx, actor);
    if (!canManagePiecework(current.roles)) deny("Недостаточно прав для распределения работы", "forbidden");
    const product = await accessibleProduct(tx, current, data.productId, data.projectId);
    const previous = await readReceipt(tx, current.id, data.clientMutationId, hash);
    if (previous) return previous;
    const work = await ordinaryWork(tx, data.workId, product.projectId, product.id);
    if (pieceworkPlanRevision(work) !== data.expectedRevision) deny("Работа изменилась. Обновите распределение и проверьте суммы", "conflict");
    if (work.priceSnapshot === null) deny("У работы отсутствует снимок расценки");
    await validateRecipients(tx, participants.map(row => row.userId), product);
    if (work.tasks.some(task => task.quantity === null)) deny("В старой задаче не определён объём");
    let remaining: bigint;
    try { remaining = quantityAtoms(work.quantity) - quantityAtoms(allocatedWorkQuantity(work.tasks)); }
    catch { deny("Объём ранее распределённой работы не согласован"); }
    if (quantityAtoms(quantity) > remaining) deny("Свободный объём работы изменился. Обновите карточку", "conflict");
    const budget = taskPieceAmount({ quantity, executorShare: "1" }, work.priceSnapshot!);
    if (moneyAtoms(budget) > BigInt("999999999999")) deny("Бюджет превышает допустимую сумму");
    const currency = (await tx.orgSetting.findUnique({ where: { key: "payrollCurrency" } }))?.value ?? "BYN";
    try { assertProjectMoneyCurrency(product.project.currency); assertInternalCurrency(currency); }
    catch { deny("Для распределения требуется валюта BYN"); }
    const dependencies = await dependenciesFor(tx, dependencyIds, product.projectId, product.id);
    const group = await tx.taskAllocationGroup.create({ data: { workId: work.id, quantity, budget, currency, budgetSource: "TASK_FIXED", createdById: current.id } });
    const allocation = allocatePiecework(budget, participants.map(row => row.percent));
    const taskIds: string[] = [], eventIds: string[] = [];
    for (const [index, row] of participants.entries()) {
      const task = await tx.task.create({ data: {
        projectId: product.projectId, productId: product.id, workId: work.id, title: data.title, type: data.type,
        status: "NEW", assigneeId: row.userId, createdById: current.id, dueAt, quantity, estimateMinutes: null,
        executorShare: "1", allocationGroupId: group.id, shareUnits: allocation[index].shareUnits, shareAmount: allocation[index].shareAmount,
        requiresPhoto: data.requiresPhoto || data.type === "Замер", dependencies: { create: dependencies.map(dependsOnId => ({ dependsOnId })) },
      } });
      taskIds.push(task.id);
      const event = await tx.domainEvent.create({ data: { type: "task.assigned", actor: current.id, payload: { taskId: task.id, projectId: product.projectId, productId: product.id, assigneeId: row.userId } } });
      eventIds.push(event.id);
    }
    const result: PieceworkSuccess = { ok: true, groupId: group.id, taskIds, recipientIds: participants.map(row => row.userId), projectId: product.projectId, productId: product.id, eventIds, repeated: false };
    await saveReceipt(tx, { ...actor, name: current.name }, data.clientMutationId, hash, result, { quantity, budget, currency, rate: work.priceSnapshot!.toString(), participants });
    return result;
  }));
}

export async function transferPieceworkShareCore(actor: DomainActor, input: unknown, transaction: TaskTransaction = withTaskTransaction): Promise<PieceworkResult> {
  const parsed = transferPieceworkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, kind: "validation", error: "Проверьте исполнителя, процент и ревизию задачи" };
  const data = parsed.data;
  let percent: string;
  try { percent = splitAllocation(FULL_SHARE_UNITS, "0", data.percent).percent; }
  catch (error) { return { ok: false, kind: "validation", error: error instanceof Error ? error.message : "Некорректный процент" }; }
  const hash = fingerprint("transfer", { ...data, percent });
  return run(() => transaction(async tx => {
    const current = await activeActor(tx, actor);
    await tx.$queryRaw`SELECT id FROM "Task" WHERE id=${data.taskId} FOR UPDATE`;
    const task = await tx.task.findFirst({ where: { ...liveChildWhere, id: data.taskId }, include: { allocationGroup: true, _count: { select: { payrollEntries: true, stageSettlementShares: true } } } });
    if (!task?.productId || !task.workId) deny("Задача не найдена или недоступна", "forbidden");
    const product = await accessibleProduct(tx, current, task.productId, task.projectId);
    if (!canManagePiecework(current.roles) && task.assigneeId !== current.id) deny("Можно передать только свою задачу", "forbidden");
    const previous = await readReceipt(tx, current.id, data.clientMutationId, hash);
    if (previous) return previous;
    if (!canTransferPiecework(current, task)) deny("Можно передать только незавершённую назначенную задачу", "forbidden");
    if (task._count.payrollEntries || task._count.stageSettlementShares) deny("По задаче уже есть начисление или расчёт — передача запрещена");
    if (task.splitRevision !== data.expectedRevision) deny("Задача изменилась. Обновите карточку", "conflict");
    if (task.assigneeId === data.recipientId) deny("Выберите другого сотрудника");
    const work = await ordinaryWork(tx, task.workId, task.projectId, task.productId);
    if (task.physicalOnlyShare || task.stageShareUnits !== null) deny("Задача относится к специальному распределению");
    if (task.quantity === null || quantityAtoms(task.quantity) <= BigInt(0)) deny("У задачи не определён объём работы");
    await validateRecipients(tx, [data.recipientId], product);
    const group = task.allocationGroup;
    if (Boolean(task.allocationGroupId) !== Boolean(group)) deny("Группа задачи не найдена");
    if (group) {
      const parts = await tx.task.findMany({ where: { allocationGroupId: group.id }, select: { projectId: true, productId: true, workId: true, quantity: true, shareUnits: true, shareAmount: true, physicalOnlyShare: true, stageShareUnits: true } });
      let valid = false;
      try {
        valid = group.workId === task.workId && group.budgetSource === "TASK_FIXED" && group.budget !== null && group.quantity !== null &&
          parts.every(part => part.projectId === task.projectId && part.productId === task.productId && part.workId === group.workId &&
            !part.physicalOnlyShare && part.stageShareUnits === null && part.quantity !== null && quantityAtoms(part.quantity) === quantityAtoms(group.quantity!) &&
            part.shareUnits !== null && Number.isSafeInteger(part.shareUnits) && part.shareUnits > 0 && part.shareUnits <= FULL_SHARE_UNITS && part.shareAmount !== null) &&
          parts.reduce((sum, part) => sum + (part.shareUnits ?? 0), 0) === FULL_SHARE_UNITS &&
          parts.reduce((sum, part) => sum + moneyAtoms(part.shareAmount ?? 0), BigInt(0)) === moneyAtoms(group.budget!);
      } catch { /* Противоречивые исторические данные не исправляются этой командой. */ }
      if (!valid) deny("Распределение общей работы не согласовано — обратитесь к администратору");
    } else if (task.shareUnits !== null || task.shareAmount !== null || work.priceSnapshot === null) deny("У задачи нет согласованного снимка обычной работы");
    const budget = group ? task.shareAmount!.toString() : taskPieceAmount(task, work.priceSnapshot!);
    if (moneyAtoms(budget) > BigInt("999999999999")) deny("Бюджет превышает допустимую сумму");
    const currency = group ? group.currency : (await tx.orgSetting.findUnique({ where: { key: "payrollCurrency" } }))?.value ?? "BYN";
    try { assertProjectMoneyCurrency(product.project.currency); assertInternalCurrency(currency); }
    catch { deny("Для передачи требуется сохранённая валюта BYN"); }
    let allocation: ReturnType<typeof splitAllocation>;
    try { allocation = splitAllocation(group ? task.shareUnits! : FULL_SHARE_UNITS, budget, percent); }
    catch (error) { deny(error instanceof Error ? error.message : "Некорректная доля"); }
    const allocationGroup = group ?? await tx.taskAllocationGroup.create({ data: { workId: task.workId, quantity: task.quantity, budget, currency, budgetSource: "TASK_FIXED", createdById: current.id } });
    const [predecessors, dependents] = await Promise.all([
      tx.taskDependency.findMany({ where: { taskId: task.id }, select: { dependsOnId: true } }),
      tx.taskDependency.findMany({ where: { dependsOnId: task.id }, select: { taskId: true } }),
    ]);
    await tx.task.update({ where: { id: task.id, splitRevision: data.expectedRevision }, data: {
      allocationGroupId: allocationGroup.id, shareUnits: allocation.remainingUnits, shareAmount: allocation.remainingAmount, splitRevision: { increment: 1 },
    } });
    const child = await tx.task.create({ data: {
      projectId: task.projectId, productId: task.productId, workId: task.workId, title: task.title, type: task.type,
      assigneeId: data.recipientId, quantity: task.quantity, executorShare: task.executorShare, dueAt: task.dueAt,
      requiresPhoto: task.requiresPhoto, status: "NEW", createdById: current.id, estimateMinutes: null,
      allocationGroupId: allocationGroup.id, shareUnits: allocation.transferredUnits, shareAmount: allocation.transferredAmount,
    } });
    const edges = [...predecessors.map(edge => ({ taskId: child.id, dependsOnId: edge.dependsOnId })), ...dependents.map(edge => ({ taskId: edge.taskId, dependsOnId: child.id }))];
    if (edges.length) await tx.taskDependency.createMany({ data: edges, skipDuplicates: true });
    const event = await tx.domainEvent.create({ data: { type: "task.split", actor: current.id, payload: { taskId: task.id, childTaskId: child.id, groupId: allocationGroup.id, recipientId: data.recipientId } } });
    const result: PieceworkSuccess = { ok: true, groupId: allocationGroup.id, taskIds: [task.id, child.id], recipientIds: [data.recipientId], projectId: task.projectId, productId: task.productId, eventIds: [event.id], repeated: false };
    await saveReceipt(tx, { ...actor, name: current.name }, data.clientMutationId, hash, result, { sourceTaskId: task.id, expectedRevision: data.expectedRevision, previousUnits: group ? task.shareUnits : FULL_SHARE_UNITS, previousAmount: budget, ...allocation, rate: group ? null : work.priceSnapshot?.toString() });
    return result;
  }));
}
