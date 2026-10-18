import { updateProjectFieldsCore, type LegacyProjectUpdateInput } from "./project-field-core";
import { patchProjectStageCore } from "./stage-service";
import type { StageExtras } from "./stage-contract";
import { revalidatePath } from "next/cache";
import type { Prisma, ProjectStage } from "@prisma/client";
import { z } from "zod";

import { INTERNAL_CURRENCY, INTERNAL_CURRENCY_ERROR } from "@/lib/internal-currency";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";
import { withMutationTransaction, type MutationTransaction } from "@/server/transactions/coordinator";
import { allocateProjectNumberInTransaction } from "./numbering";

import { MANAGER_ROLES } from "@/lib/roles";
import { requireActorRoles, type DomainActor } from "@/server/actor";

// ─── Актёр доменных действий ─────────────────────────────────────────────────
// Пользователь, от имени которого совершается действие: сессия веба
// (source "web") или привязанный пользователь telegram-бота (source "telegram").
// source попадает в журнал изменений (§5: веб / Telegram / плагин / api).

export { requireActorRoles, type DomainActor } from "@/server/actor";

export const createProjectSchema = z.object({
  title: z.string().min(1, "Укажите название проекта"),
  clientId: z.string().min(1, "Выберите клиента"),
  currency: z.string().refine((value) => value === INTERNAL_CURRENCY, INTERNAL_CURRENCY_ERROR).default(INTERNAL_CURRENCY),
  address: z.string().optional(),
  managerId: z.string().optional(),
  delivery: z
    .number()
    .min(0, "Доставка не может быть отрицательной")
    .optional(),
  unloading: z
    .number()
    .min(0, "Выгрузка не может быть отрицательной")
    .optional(),
  installation: z
    .number()
    .min(0, "Монтаж не может быть отрицательным")
    .optional(),
}).strict();

/** Вызывается в общей транзакции, в том числе при создании КП. */
export async function createProjectInTransaction(
  tx: Prisma.TransactionClient,
  actor: DomainActor,
  input: z.input<typeof createProjectSchema>,
) {
  requireActorRoles(actor, MANAGER_ROLES);
  const data = createProjectSchema.parse(input);
  const { number, numberInt } = await allocateProjectNumberInTransaction(tx);
  if (!await tx.client.findUnique({ where: { id: data.clientId }, select: { id: true } }))
    throw new Error("Клиент не найден");
  const project = await tx.project.create({ data: {
    id: number, number, numberInt, title: data.title, clientId: data.clientId,
    currency: data.currency, address: data.address, managerId: data.managerId,
    initialPrice: null, delivery: data.delivery ?? null,
    unloading: data.unloading ?? null, installation: data.installation ?? null,
    createdById: actor.id,
    stageHistory: { create: { toStage: "LEAD", changedById: actor.id } },
  } });
  await tx.changeLog.create({ data: {
    actorType: "user", actorId: actor.id, actorName: actor.name || undefined,
    entity: "project", entityId: project.id, action: "create",
    newValue: { number, title: data.title }, source: actor.source,
  } });
  const event = await tx.domainEvent.create({ data: {
    type: "project.created", payload: { projectId: project.id, number }, actor: actor.id,
  } });
  return { project, eventIds: [event.id] };
}

/** Сохранённый результат не зависит от доставки уведомления или инвалидации. */
export async function deliverProjectCreated(
  actor: DomainActor,
  mutation: Awaited<ReturnType<typeof createProjectInTransaction>>,
) {
  const { project, eventIds } = mutation;
  const effects = [
    ...eventIds.map(id => () => dispatchEvent(id)),
    () => notifyOrg({ type: "project.created", title: `Новый проект ${project.number}`,
      body: project.title, link: `/projects/${project.id}`, exceptUserId: actor.id }),
    () => revalidatePath("/projects"),
  ];
  for (const effect of effects) {
    try { await effect(); }
    catch { console.error("[crm.post-commit] project-created effect failed", { projectId: project.id }); }
  }
}

// Проект = заказ клиента (§6): название, клиент, менеджер, адрес, валюта
// и первоначальная цена (первая цена КП клиенту, правится и через бота).
export async function createProjectCore(
  actor: DomainActor,
  input: z.input<typeof createProjectSchema>,
  transaction: MutationTransaction = withMutationTransaction,
): Promise<{ ok: boolean; id?: string; number?: string; error?: string }> {
  requireActorRoles(actor, MANAGER_ROLES);
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const mutation = await transaction(tx => createProjectInTransaction(tx, actor, parsed.data));
  await deliverProjectCreated(actor, mutation);
  return { ok: true, id: mutation.project.id, number: mutation.project.number };
}

export { legacyProjectUpdateSchema as updateProjectSchema } from "./project-field-core";
export type { StageExtras } from "./stage-contract";

/** Прежний transport сохраняет только поля с подлинным baseline клиента. */
export async function updateProjectCore(actor: DomainActor, projectId:string, input:LegacyProjectUpdateInput):Promise<{ok:boolean;error?:string}> {
  requireActorRoles(actor,MANAGER_ROLES);
  const result=await updateProjectFieldsCore(actor,projectId,input);
  if(result.ok && !result.noOp){ revalidatePath(`/projects/${projectId}`);revalidatePath("/projects"); }
  return result;
}

/** Совместимый мост: старые диалоги без expectedStage/UUID не подставляют состояние сервера. */
export async function changeProjectStageCore(actor:DomainActor,projectId:string,toStage:ProjectStage,extras?:StageExtras,expectedStage?:ProjectStage,clientMutationId?:string):Promise<{ok:boolean;error?:string}> {
  return patchProjectStageCore(actor,{projectId,toStage,extras,expectedStage,clientMutationId});
}
