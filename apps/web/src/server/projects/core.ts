import { revalidatePath } from "next/cache";
import type { ProjectStage } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { formatAmount } from "@/lib/format";
import { stageLabels as STAGE_LABELS } from "@/lib/stages";
import { writeChangeLog } from "@/server/plugins/changelog";
import { emitDomainEvent, dispatchEvent } from "@/server/plugins/events";
import { notifyOrg, notifyPerson } from "@/server/notifications/notify";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { changeProjectStageTransaction } from "./stage-core";
import { assertProjectCurrencyChange } from "@/server/product-stage-pay/core";
import { assertPercentageProjectCurrencyChange } from "@/server/product-percentage-pay/core";

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
  currency: z.string().default("BYN"),
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

export const updateProjectSchema = z.object({
  title: z.string().min(1).optional(),
  currency: z.string().optional(),
  address: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
  clientId: z.string().optional(),
  initialPrice: z
    .number()
    .min(0, "Первоначальная цена не может быть отрицательной")
    .nullable()
    .optional(),
  delivery: z
    .number()
    .min(0, "Доставка не может быть отрицательной")
    .nullable()
    .optional(),
  unloading: z
    .number()
    .min(0, "Выгрузка не может быть отрицательной")
    .nullable()
    .optional(),
  installation: z
    .number()
    .min(0, "Монтаж не может быть отрицательным")
    .nullable()
    .optional(),
});

// Редактирование карточки проекта (§4) — админ/директор/менеджер.
// (Тех. блок живёт на изделии — его правит и инженер, см. products/actions.)
export async function updateProjectCore(
  actor: DomainActor,
  projectId: string,
  input: z.input<typeof updateProjectSchema>,
): Promise<{ ok: boolean; error?: string }> {
  requireActorRoles(actor, MANAGER_ROLES);
  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Ошибка данных" };
  const data = parsed.data;

  let before;
  try {
    before = await withTaskTransaction(async (tx) => {
      const current = await tx.project.findUnique({ where: { id: projectId } });
      if (!current) return null;
      if (data.currency !== undefined) {
        await assertProjectCurrencyChange(tx, projectId, data.currency);
        await assertPercentageProjectCurrencyChange(tx, projectId, data.currency);
      }
      await tx.project.update({ where: { id: projectId }, data });
      return current;
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось изменить проект" };
  }
  if (!before) return { ok: false, error: "Проект не найден" };

  await writeChangeLog({
    actorType: "user",
    actorId: actor.id,
    actorName: actor.name || undefined,
    entity: "project",
    entityId: projectId,
    action: "update",
    oldValue: Object.fromEntries(
      Object.keys(data).map((k) => [k, before[k as keyof typeof before]]),
    ),
    newValue: data,
    source: actor.source,
  });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  return { ok: true };
}

export interface StageExtras {
  refusalReason?: string;
  refusalComment?: string;
  reclamationReason?: string;
  reclamationDescription?: string;
  reclamationFault?: string;
}

// Смена этапа (§6): переходы свободные; для Отказа нужны причина+комментарий,
// для Рекламации — причина, описание, виновная сторона (§6.3, только из «Завершён»).
export async function changeProjectStageCore(
  actor: DomainActor, projectId: string, toStage: ProjectStage, extras?: StageExtras,
): Promise<{ ok: boolean; error?: string }> {
  requireActorRoles(actor, MANAGER_ROLES);
  const result = await withTaskTransaction((tx) => changeProjectStageTransaction(actor, projectId, toStage, extras, tx));
  if (!result.ok) return result;
  if (result.repeated) return { ok: true };
  for (const eventId of result.eventIds) await dispatchEvent(eventId).catch(() => {});
  for (const earning of result.earnings) {
    await notifyPerson({ userId: earning.userId, type: "payroll.accrued",
      title: `Начислена зарплата: ${formatAmount(earning.amount, earning.currency)}`,
      body: `${earning.percent}% от стоимости ваших изделий по проекту ${result.project.number}`, link: "/payroll",
    }).catch(() => {});
    await notifyOrg({ type: "payroll.orgAccrued", title: `Начислено ${earning.name}: ${formatAmount(earning.amount, earning.currency)}`,
      body: `${earning.percent}% от стоимости изделий по проекту ${result.project.number}`, link: "/finance/payroll", exceptUserId: actor.id,
    }).catch(() => {});
  }
  await notifyOrg({ type: "project.stageChanged",
    title: `${result.project.number}: ${STAGE_LABELS[result.project.stage]} → ${STAGE_LABELS[toStage]}`,
    body: result.project.title, link: `/projects/${projectId}`, exceptUserId: actor.id,
  }).catch(() => {});
  revalidatePath(`/projects/${projectId}`); revalidatePath("/projects");
  return { ok: true };
}
