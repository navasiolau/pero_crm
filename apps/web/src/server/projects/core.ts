import { updateProjectFieldsCore, type LegacyProjectUpdateInput } from "./project-field-core";
import { patchProjectStageCore } from "./stage-service";
import type { StageExtras } from "./stage-contract";
import { revalidatePath } from "next/cache";
import type { ProjectStage } from "@prisma/client";
import { z } from "zod";

import { INTERNAL_CURRENCY, INTERNAL_CURRENCY_ERROR } from "@/lib/internal-currency";
import { prisma } from "@/lib/prisma";
import { writeChangeLog } from "@/server/plugins/changelog";
import { emitDomainEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";

import { hasAnyRole, MANAGER_ROLES, type Role } from "@/lib/roles";

// ─── Актёр доменных действий ─────────────────────────────────────────────────
// Пользователь, от имени которого совершается действие: сессия веба
// (source "web") или привязанный пользователь telegram-бота (source "telegram").
// source попадает в журнал изменений (§5: веб / Telegram / плагин / api).

export interface DomainActor {
  id: string;
  name: string;
  roles: Role[];
  source: "web" | "telegram" | "api";
}

// Роли проверяются В ЯДРЕ (а не только на входе в action/route) — единая
// точка для веба и бота. Нарушение — throw; обёртки/routes переводят в ответ.
export function requireActorRoles(actor: DomainActor, allowed: Role[]): void {
  if (!hasAnyRole(actor.roles, allowed)) {
    throw new Error("Недостаточно прав");
  }
}

// Номер проекта — сплошная нумерация: следующий = max(numberInt) + 1
// (после миграции нормализации все номера каноничные числа, «205» —
// последний). Создание — в той же транзакции, чтобы два параллельных
// запроса не получили один номер.
async function createProjectWithNumber(
  data: {
    title: string;
    clientId: string;
    currency: string;
    address?: string;
    managerId?: string;
    initialPrice?: number;
    delivery?: number;
    unloading?: number;
    installation?: number;
  },
  userId: string,
) {
  return prisma.$transaction(async (tx) => {
    const max = await tx.project.aggregate({ _max: { numberInt: true } });
    const numberInt = (max._max.numberInt ?? 0) + 1;
    const number = String(numberInt);
    const project = await tx.project.create({
      data: {
        // id = номер («205»): URL карточки — /projects/205
        id: number,
        number,
        numberInt,
        title: data.title,
        clientId: data.clientId,
        currency: data.currency,
        address: data.address,
        managerId: data.managerId,
        initialPrice: data.initialPrice ?? null,
        delivery: data.delivery ?? null,
        unloading: data.unloading ?? null,
        installation: data.installation ?? null,
        createdById: userId,
        stageHistory: {
          create: { toStage: "LEAD", changedById: userId },
        },
      },
    });
    return project;
  });
}

export const createProjectSchema = z.object({
  title: z.string().min(1, "Укажите название проекта"),
  clientId: z.string().min(1, "Выберите клиента"),
  currency: z.string().refine((value) => value === INTERNAL_CURRENCY, INTERNAL_CURRENCY_ERROR).default(INTERNAL_CURRENCY),
  address: z.string().optional(),
  managerId: z.string().optional(),
  initialPrice: z
    .number()
    .min(0, "Первоначальная цена не может быть отрицательной")
    .optional(),
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
});

// Проект = заказ клиента (§6): название, клиент, менеджер, адрес, валюта
// и первоначальная цена (первая цена КП клиенту, правится и через бота).
export async function createProjectCore(
  actor: DomainActor,
  input: z.input<typeof createProjectSchema>,
): Promise<{ ok: boolean; id?: string; number?: string; error?: string }> {
  requireActorRoles(actor, MANAGER_ROLES);
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;

  const project = await createProjectWithNumber(
    {
      title: data.title,
      clientId: data.clientId,
      currency: data.currency,
      address: data.address,
      managerId: data.managerId,
      initialPrice: data.initialPrice,
      delivery: data.delivery,
      unloading: data.unloading,
      installation: data.installation,
    },
    actor.id,
  );
  const number = project.number;

  await writeChangeLog({
    actorType: "user",
    actorId: actor.id,
    actorName: actor.name || undefined,
    entity: "project",
    entityId: project.id,
    action: "create",
    newValue: { number, title: data.title },
    source: actor.source,
  });
  await emitDomainEvent("project.created", { projectId: project.id, number }, actor.id);
  await notifyOrg({
    type: "project.created",
    title: `Новый проект ${number}`,
    body: data.title,
    link: `/projects/${project.id}`,
    exceptUserId: actor.id,
  });

  revalidatePath("/projects");
  return { ok: true, id: project.id, number };
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
