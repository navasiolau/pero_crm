"use server";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { productVisibilityWhere } from "@/server/access/visibility";
import { liveWorkWhere } from "@/server/access/live-entities";
import {liveProductWhere,liveProjectWhere} from "@/server/access/live-entities";

import { revalidatePath } from "next/cache";
import { deliverPostCommit } from "@/server/operations/post-commit";
import type { TaskStatusContext, TaskStatusAck } from "./status-receipts";
import { confirmMutation } from "@/server/operations/confirmation";
import { readTaskCreateReceipt, recordTaskCreateReceipt, taskCreateFingerprint, TaskCreateRequestError, type TaskCreateAck } from "./creation-receipts";
import type { DomainActor } from "@/server/actor";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import { assertProjectMoneyCurrency } from "@/lib/internal-currency";
import { auth } from "@/auth";
import { formatAmount } from "@/lib/format";
import { quantityAtoms } from "@/lib/work-shares";
import { dispatchEvent, emitDomainEvent } from "@/server/plugins/events";
import { notifyOrg, notifyPerson } from "@/server/notifications/notify";

import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { withTaskTransaction } from "./transaction";
import { changeTaskStatusCore } from "./completion-core";
import { taskRecipientError } from "./share-policy";
import { checkWorkQuantity, expandDependencies, updateSchema, updateTaskInTransaction } from "./update-core";
import { workTaskLifecycleCommand } from "./lifecycle-contract";
import {deleteTaskInTransaction} from './delete-core';
import {operationJournalContext,journalSnapshot,journalUserReferences,journalTaskReferences,TASK_JOURNAL_FIELDS} from './journal';

const createSchema = z.object({
  clientMutationId: z.uuid().transform(value => value.toLowerCase()),
  expectedActorId: z.string().min(1).max(160),
  projectId: z.string(),
  productId: z.string().optional(), // изделие проекта (необязательно)
  title: z.string().min(1, "Укажите название задачи"),
  // Тип и срок обязательны (без исполнителя — черновик, §4/§9)
  type: z.string().min(1, "Укажите тип задачи"),
  assigneeId: z.string().optional(),
  workId: z.string().optional(),
  quantity: z.number().positive().optional(), // часть работы; пусто — весь остаток
  dueAt: z.string().min(1, "Укажите срок"),
  // Только для fingerprint старой квитанции; новая оценка отклоняется после replay.
  estimateMinutes: z.number().int().min(0).optional(),
  requiresPhoto: z.boolean().default(false),
  dependencyIds: z.array(z.string()).default([]),
}).strict().superRefine((data,ctx)=>{
  for(const key of ['productId','workId','assigneeId'] as const)if(!data[key]?.trim())ctx.addIssue({code:'custom',path:[key],message:'Выберите изделие, работу и одного исполнителя'});
  if (!Number.isFinite(new Date(data.dueAt).getTime())) ctx.addIssue({code:'custom',path:['dueAt'],message:'Проверьте срок задачи'});
  try { if (data.quantity !== undefined) quantityAtoms(data.quantity); }
  catch { ctx.addIssue({code:'custom',path:['quantity'],message:'Количество должно содержать не больше двух знаков после запятой'}); }
});

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  return session;
}

// Работа делится между задачами по количеству (§9: расценка × количество ×
// доля исполнителя). Проверка: сумма частей по задачам не превышает
// количество работы. Возвращает остаток при успехе, иначе текст ошибки.
// Создание задачи — админ/директор/менеджер (§4).
export async function createTask(
  input: z.input<typeof createSchema>,
): Promise<TaskCreateAck> {
  const recognizedId = z.uuid().safeParse(input?.clientMutationId);
  const clientMutationId = recognizedId.success ? recognizedId.data.toLowerCase() : undefined;
  const refuse = (error: string, kind: Extract<TaskCreateAck, {ok:false}>["kind"], outcome: "ROLLED_BACK" | "UNKNOWN" = "ROLLED_BACK",
    intentResolution: "attempt-only" | "verified-absent" = "attempt-only"): TaskCreateAck =>
    ({ ok: false, error, kind, outcome, retrySafe: outcome === "UNKNOWN", clientMutationId, intentResolution });
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return refuse(parsed.error.issues[0]?.message ?? "Ошибка данных", "invalid-request");
  }
  const data = parsed.data;
  let session: Awaited<ReturnType<typeof requireUser>>;
  try { session = await requireUser(); } catch { return refuse("Обновите страницу и войдите в CRM", "forbidden"); }
  if (data.expectedActorId !== session.user.id) return refuse("Учётная запись изменилась — обновите страницу", "actor-changed");
  if (!hasAnyRole(session.user.roles, MANAGER_ROLES)) return refuse("Недостаточно прав", "forbidden");
  const actor: DomainActor = { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" };
  // Fingerprint закрепляет исходный запрос, включая оценку старой квитанции.
  taskCreateFingerprint(actor.id, data);
  let absenceVerified = false;
  async function currentActor(tx: Prisma.TransactionClient) {
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { id: true, active: true, roles: true } });
    if (!user?.active || !hasAnyRole(user.roles, MANAGER_ROLES)) throw new TaskCreateRequestError("Недостаточно прав", "forbidden");
    return user;
  }
  const outcome = await confirmMutation(withTaskTransaction, async (tx) => {
  const user = await currentActor(tx);
  const replay = await readTaskCreateReceipt(actor, data, tx);
  if (replay) return { ok: true as const, ack: replay, eventId: null, notification: null };
  absenceVerified = true;
  if (data.estimateMinutes !== undefined) return { ok: false as const, error: "Оценка времени задач отключена. Обновите страницу и повторите без оценки" };
  const project = await tx.project.findUnique({
    where: {...liveProjectWhere, id: data.projectId },
    select: { id: true, number: true, currency: true },
  });
  if (!project) return { ok: false as const, error: "Проект не найден" };

  // Изделие должно принадлежать проекту задачи
  const product = data.productId ? await tx.product.findFirst({
      where: {...liveProductWhere, id: data.productId, projectId: data.projectId, AND: [productVisibilityWhere(user)] },
      select: { id: true, engineerId: true, status: true },
    }) : null;
  if (data.productId && !product) return { ok: false as const, error: "Изделие не найдено в этом проекте" };
  if (data.assigneeId) {
    const assignee = await tx.user.findUnique({ where: { id: data.assigneeId }, select: { id: true, roles: true, active: true } });
    const error = assignee ? taskRecipientError(assignee, product) : "Сотрудник не найден";
    if (error) return { ok: false as const, error };
  }

  let workQuantity: string | null = null;
  if (data.workId) {
    try { assertProjectMoneyCurrency(project.currency); }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Валюта проекта не подготовлена" }; }
    const work = await tx.work.findUnique({ where: {...liveWorkWhere, id: data.workId }, select: { paymentKind: true } });
    if (work?.paymentKind !== "LEGACY") return { ok: false as const, error: "Новая задача создаётся только для обычной работы со снимком расценки" };
    const check = await checkWorkQuantity(tx, data.workId, data.quantity ?? null, undefined, { projectId: data.projectId, productId: data.productId || null });
    if (check.error) return { ok: false as const, error: check.error };
    workQuantity = check.remaining!;
  }

  const dependencies = await expandDependencies(tx, user, data.projectId, data.dependencyIds);
  if (dependencies.error) return { ok: false as const, error: dependencies.error };
  const task = await tx.task.create({
    data: {
      projectId: data.projectId,
      productId: data.productId || null,
      title: data.title,
      type: data.type,
      assigneeId: data.assigneeId || null,
      workId: data.workId || null,
      quantity: workQuantity,
      executorShare: 1,
      status: "NEW",
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
      requiresPhoto: data.requiresPhoto,
      estimateMinutes: null,
      createdById: session.user.id,
      dependencies: {
        create: dependencies.ids.map((dependsOnId) => ({ dependsOnId })),
      },
    },
  });
  const journalState = dependencies.ids.length ? await tx.task.findUniqueOrThrow({ where: { id: task.id }, select: { journalRevision: true } }) : task;
  await writeChangeLogInTransaction(tx, {
    actorType: "user",
    actorId: actor.id,
    actorName: actor.name,
    source: "web",
    entity: "task",
    entityId: task.id,
    action: "create",
    reversal: workTaskLifecycleCommand({ entity: "task", id: task.id, revision: journalState.journalRevision, deleted: false }),
    newValue: { title: task.title, project: project.number },
  },{...await operationJournalContext(tx,{type:'task',id:task.id,label:task.title},[{...task,project}],
    [...await journalUserReferences(tx,[task.assigneeId]),...await journalTaskReferences(tx,dependencies.ids)]),
    before:null,after:{...journalSnapshot(task,TASK_JOURNAL_FIELDS),dependencyIds:dependencies.ids}});
  const event = await tx.domainEvent.create({ data: { type: "task.assigned", actor: actor.id,
    payload: { taskId: task.id, projectId: project.id, assigneeId: task.assigneeId } } });
  await recordTaskCreateReceipt(actor, data, task.id, tx);
  return { ok: true as const, ack: { ok: true as const, outcome: "COMMITTED" as const, resultId: task.id, clientMutationId: data.clientMutationId },
    eventId: event.id, notification: { userId: task.assigneeId!, title: task.title, projectNumber: project.number } };
  }, async tx => {
    await currentActor(tx);
    const ack = await readTaskCreateReceipt(actor, data, tx);
    if (!ack) { absenceVerified = true; return null; }
    return { ok: true as const, ack, eventId: null, notification: null };
  });
  if (outcome.outcome !== "COMMITTED") {
    const error = outcome.error;
    return refuse(error instanceof TaskCreateRequestError ? error.message : outcome.outcome === "UNKNOWN"
      ? "Ответ не подтверждён. Проверьте результат тем же запросом." : "Назначение не сохранено. Повторите запрос.",
      error instanceof TaskCreateRequestError ? error.kind : "unavailable", outcome.outcome,
      outcome.outcome === "ROLLED_BACK" && absenceVerified ? "verified-absent" : "attempt-only");
  }
  const mutation = outcome.value;
  if (!mutation.ok) return refuse(mutation.error, "rejected", "ROLLED_BACK", "verified-absent");
  const { eventId, notification } = mutation;
  await deliverPostCommit("task-create", mutation.ack.resultId, [
    ...(eventId ? [{ kind: "dispatch" as const, run: () => dispatchEvent(eventId) }] : []),
    ...(notification ? [{ kind: "person" as const, run: () => notifyPerson({ userId: notification.userId, type: "task.assigned",
      title: `Вам назначена задача: ${notification.title}`, body: `Проект ${notification.projectNumber}`, link: "/my" }) }] : []),
    { kind: "cache", run: () => revalidatePath(`/projects/${data.projectId}`) },
    { kind: "cache", run: () => revalidateProductPaths(data.productId) },
    { kind: "cache", run: () => revalidatePath("/my") },
  ]);
  return mutation.ack;
}

export async function updateTask(
  taskId: string,
  input: z.infer<typeof updateSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  if (!hasAnyRole(session.user.roles, MANAGER_ROLES)) {
    throw new Error("Недостаточно прав");
  }
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;
  if (data.estimateMinutes !== undefined) return { ok: false, error: "Оценка времени задач отключена. Обновите страницу" };

  const actor: DomainActor = { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" };
  const mutation = await withTaskTransaction(tx => updateTaskInTransaction(tx, actor, taskId, data));
  if (!mutation.ok) return mutation;
  const { task, becameAssigned } = mutation;


  if (becameAssigned && data.assigneeId) {
    await emitDomainEvent(
      "task.assigned",
      { taskId, projectId: task.project.id, assigneeId: data.assigneeId },
      session.user.id,
    );
    await notifyPerson({
      userId: data.assigneeId,
      type: "task.assigned",
      title: `Вам назначена задача: ${data.title ?? task.title}`,
      body: `Проект ${task.project.number}`,
      link: "/my",
    });
  }

  revalidatePath(`/projects/${task.project.id}`);
  await revalidateProductPaths(task.productId);
  await revalidateProductPaths(data.productId);
  revalidatePath("/tasks");
  revalidatePath("/my");
  return { ok: true };
}

// Проверка цикла: идём от новых предшественников по зависимостям —
// если добрались до самой задачи, цикл есть.
// Смена статуса задачи (§4, §9): сам исполнитель — свои; любые — админ/директор/менеджер.
// Для requiresPhoto-задачи (замер, §6.2) при «Выполнена» нужен хотя бы один файл.
// Задача блокируется, пока предшественники не выполнены (§9).
// Начисление денег — при «Выполнена» (сдельная схема: работа × доля исполнителя).
// actualMinutes сохраняется только для fingerprint ранее подтверждённых UUID.

export async function changeTaskStatus(
  taskId: string,
  toStatus: "IN_PROGRESS" | "DONE",
  actualMinutes?: number,
  context?: TaskStatusContext,
): Promise<TaskStatusAck> {
  const session = await requireUser();
  const result = await changeTaskStatusCore({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, taskId, toStatus, actualMinutes, withTaskTransaction, context);
  if (!result.ok) return result;
  const effects: Parameters<typeof deliverPostCommit>[2] = [];
  if (!result.repeated) {
    if (result.eventId) effects.push({ kind: "dispatch", run: () => dispatchEvent(result.eventId!) });
    if (result.payroll) effects.push({ kind: "payroll", run: () => notifyOrg({
      type: "payroll.orgAccrued",
      title: `Начислено ${result.payroll!.name}: ${formatAmount(result.payroll!.amount, result.payroll!.currency)}`,
      body: `Сдельно · ${result.task.title} · ${result.task.projectNumber}`,
      link: "/finance/payroll", exceptUserId: session.user.id,
    }) });
    if (result.task.assigneeId && result.task.assigneeId !== session.user.id) effects.push({ kind: "person", run: () => notifyPerson({
      userId: result.task.assigneeId!, type: "task.statusChanged",
      title: `Задача «${result.task.title}»: ${toStatus === "DONE" ? "выполнена" : "в работе"}`,
      body: `Проект ${result.task.projectNumber}`, link: "/my",
    }) });
    effects.push({ kind: "org", run: () => notifyOrg({
      type: "task.statusChanged",
      title: `Задача «${result.task.title}»: ${toStatus === "DONE" ? "выполнена" : "в работе"}`,
      body: `Проект ${result.task.projectNumber} · ${session.user.name ?? ""}`,
      link: result.task.productId ? `/products/${encodeURIComponent(result.task.productId)}` : `/projects/${result.task.projectId}`,
      exceptUserId: session.user.id,
    }) });
  }
  effects.push({ kind: "cache", run: () => revalidatePath(`/projects/${result.task.projectId}`) },
    { kind: "cache", run: () => revalidateProductPaths(result.task.productId) },
    { kind: "cache", run: () => revalidatePath("/my") }, { kind: "cache", run: () => revalidatePath("/tasks") });
  await deliverPostCommit("task-status", result.task.id, effects);
  return { ok: true, outcome: "COMMITTED", resultId: result.task.id, replayed: result.repeated || result.recovered === true, ...(context ? { clientMutationId: context.clientMutationId.toLowerCase() } : {}) };
}
// Удаление задачи — админ/директор/менеджер (§4).
// Выполненную удалять нельзя: там начисления, время и история.
// Вложения и зависимости остаются связанными с исходной задачей для восстановления.
export async function deleteTask(
  taskId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  if (!hasAnyRole(session.user.roles, MANAGER_ROLES)) {
    throw new Error("Недостаточно прав");
  }
  const mutation = await withTaskTransaction(tx => deleteTaskInTransaction(tx, {id:session.user.id,name:session.user.name??'',roles:session.user.roles,source:'web'}, taskId));
  if (!mutation.ok) return mutation;
  const { task } = mutation;

  revalidatePath(`/projects/${task.project.id}`);
  await revalidateProductPaths(task.productId);
  revalidatePath("/tasks");
  revalidatePath("/my");
  return { ok: true };
}
