"use server";

import { revalidatePath } from "next/cache";
import type { ProductStatus } from "@prisma/client";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { productStatusLabels } from "@/lib/product-statuses";
import { writeChangeLog } from "@/server/plugins/changelog";
import { emitDomainEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";

import { MANAGER_ROLES, hasAnyRole, hasRole } from "@/lib/roles";
import { revalidateProductPaths } from "@/server/products/revalidate";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  return session;
}

function revalidateProduct(product: { id: string; projectId: string }) {
  // Адрес карточки изделия — по номеру (/products/<номер>)
  void revalidateProductPaths(product.id);
  revalidatePath("/projects");
}

const createSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1, "Укажите название изделия"),
  kind: z.string().optional(),
  expectedPrice: z.number().nonnegative("Цена не может быть отрицательной").optional(),
  initialPrice: z.number().nonnegative("Первоначальная цена не может быть отрицательной").optional(),
  description: z.string().optional(),
});

// Номер изделия: «<номер проекта>.<N>» (точка — единый стиль с legacy),
// N — следующий суффикс в проекте по max(suffixInt). id изделия — отдельный
// cuid (Prisma default), номер — отображаемое уникальное поле.
async function nextProductSuffixInt(
  projectId: string,
): Promise<number> {
  const siblings = await prisma.product.findMany({
    where: { projectId },
    select: { suffixInt: true },
  });
  let max = 0;
  for (const sibling of siblings) {
    const suffix = sibling.suffixInt;
    if (suffix !== null && suffix > max) max = suffix;
  }
  return max + 1;
}

// Создание изделия в проекте — админ/директор/менеджер (§4).
// Статус «Проектирование» + первая запись истории статусов.
export async function createProduct(
  input: z.input<typeof createSchema>,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const session = await requireUser();
  if (!hasAnyRole(session.user.roles, MANAGER_ROLES)) {
    throw new Error("Недостаточно прав");
  }
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;

  const project = await prisma.project.findUnique({
    where: { id: data.projectId },
    select: { id: true, number: true },
  });
  if (!project) return { ok: false, error: "Проект не найден" };

  const suffixInt = await nextProductSuffixInt(project.id);
  const number = `${project.number}.${suffixInt}`;
  const product = await prisma.product.create({
    data: {
      projectId: project.id,
      number,
      suffixInt,
      title: data.title,
      kind: data.kind?.trim() || null,
      expectedPrice: data.expectedPrice,
      initialPrice: data.initialPrice,
      description: data.description?.trim() || null,
      createdById: session.user.id,
      statusHistory: {
        create: { toStatus: "DESIGN", changedById: session.user.id },
      },
    },
  });

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "product",
    entityId: product.id,
    action: "create",
    newValue: { number, title: data.title, project: project.number },
  });

  revalidateProduct(product);
  return { ok: true, id: product.id };
}

const updateSchema = z.object({
  title: z.string().min(1, "Укажите название изделия").optional(),
  kind: z.string().nullable().optional(),
  expectedPrice: z.number().nonnegative("Цена не может быть отрицательной").nullable().optional(),
  initialPrice: z
    .number()
    .nonnegative("Первоначальная цена не может быть отрицательной")
    .nullable()
    .optional(),
  description: z.string().nullable().optional(),
});

// Редактирование изделия (§4): полностью — админ/директор/менеджер;
// инженер — только тех. блок (description).
export async function updateProduct(
  productId: string,
  input: z.infer<typeof updateSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  const roles = session.user.roles;
  // Право на правку изделия: менеджмент или инженер (§4)
  if (!hasAnyRole(roles, [...MANAGER_ROLES, "ENGINEER"])) {
    throw new Error("Недостаточно прав");
  }
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;

  // Приоритет ролей: при комбинации менеджерских ролей с инженером права
  // старше — урезанное «только тех. блок» действует для чистого инженера
  if (hasRole(roles, "ENGINEER") && !hasAnyRole(roles, MANAGER_ROLES)) {
    const keys = Object.keys(data);
    if (keys.some((key) => key !== "description")) {
      return { ok: false, error: "Инженер правит только технический блок" };
    }
  }

  const before = await prisma.product.findUnique({ where: { id: productId } });
  if (!before) return { ok: false, error: "Изделие не найдено" };

  await prisma.product.update({ where: { id: productId }, data });

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "product",
    entityId: productId,
    action: "update",
    oldValue: Object.fromEntries(
      Object.keys(data).map((key) => [key, before[key as keyof typeof before]]),
    ),
    newValue: data,
  });
  revalidateProduct(before);
  return { ok: true };
}

// Смена статуса изделия: переходы свободные, каждый — в историю (§6),
// событием product.statusChanged и org-уведомлением A/D/M.
export async function changeProductStatus(
  productId: string,
  toStatus: ProductStatus,
  comment?: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  if (!hasAnyRole(session.user.roles, MANAGER_ROLES)) {
    throw new Error("Недостаточно прав");
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return { ok: false, error: "Изделие не найдено" };
  if (product.status === toStatus) return { ok: true };

  await prisma.$transaction([
    prisma.product.update({
      where: { id: productId },
      data: { status: toStatus, statusChangedAt: new Date() },
    }),
    prisma.productStatusHistory.create({
      data: {
        productId,
        fromStatus: product.status,
        toStatus,
        comment: comment?.trim() || null,
        changedById: session.user.id,
      },
    }),
  ]);

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "product",
    entityId: productId,
    action: "status",
    field: "status",
    oldValue: product.status,
    newValue: toStatus,
  });
  await emitDomainEvent(
    "product.statusChanged",
    { productId, number: product.number, from: product.status, to: toStatus },
    session.user.id,
  );
  await notifyOrg({
    type: "product.statusChanged",
    title: `${product.number}: ${productStatusLabels[product.status]} → ${productStatusLabels[toStatus]}`,
    body: product.title,
    link: `/products/${product.number}`,
    exceptUserId: session.user.id,
  });

  revalidateProduct(product);
  return { ok: true };
}

// Удаление изделия — админ/директор/менеджер. Нельзя, если есть задачи,
// работы, потребность или движения склада (там деньги и история);
// файлы при этом отвязываются и остаются в проекте (FK SetNull).
export async function deleteProduct(
  productId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  if (!hasAnyRole(session.user.roles, MANAGER_ROLES)) {
    throw new Error("Недостаточно прав");
  }
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      _count: {
        select: { tasks: true, works: true, projectMaterials: true, stockMovements: true },
      },
    },
  });
  if (!product) return { ok: false, error: "Изделие не найдено" };
  const { tasks, works, projectMaterials, stockMovements } = product._count;
  if (tasks + works + projectMaterials + stockMovements > 0) {
    return {
      ok: false,
      error:
        "К изделию привязаны задачи, работы или материалы — сначала удалите или отвяжите их",
    };
  }

  await prisma.product.delete({ where: { id: productId } });
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "product",
    entityId: productId,
    action: "delete",
    oldValue: { number: product.number, title: product.title },
  });
  revalidateProduct(product);
  return { ok: true };
}

// Опции изделий проекта для диалога задачи (клиентский компонент
// не может дёрнуть queries.ts напрямую — только server action).
export async function fetchProductOptions(
  projectId: string,
): Promise<{ id: string; number: string; title: string }[]> {
  const session = await requireUser();
  void session;
  return prisma.product.findMany({
    where: { projectId },
    select: { id: true, number: true, title: true },
    orderBy: { number: "asc" },
  });
}
