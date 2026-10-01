"use server";

import { revalidatePath } from "next/cache";
import type { Prisma, ProductStatus } from "@prisma/client";
import { z } from "zod";

import { auth } from "@/auth";
import { productStatusLabels } from "@/lib/product-statuses";
import { writeChangeLog } from "@/server/plugins/changelog";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";

import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { productEditWhere, resolveVisibilityActor } from "@/server/access/visibility";
import { listProductOptions } from "@/server/products/queries";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { settlePendingProductPercentage } from "@/server/product-percentage-pay/core";
import { changeProductStatusTransaction } from "@/server/products/status-core";
import { productLineTotal } from "@/lib/product-quantity";
import { lockProductRow, recalculateQuantity } from "@/server/products/quantity-core";

type FinanceState = "PENDING_FX" | "SETTLED" | "SKIPPED_ONCE" | "LEGACY_PROTECTED" | null;

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
  quantity: z.number().int("Количество должно быть целым").min(1, "Количество должно быть не меньше 1").max(2_147_483_647, "Слишком большое количество изделий").default(1),
  kind: z.string().optional(),
  expectedPrice: z.number().nonnegative("Цена не может быть отрицательной").optional(),
  initialPrice: z.number().nonnegative("Первоначальная цена не может быть отрицательной").optional(),
  description: z.string().optional(),
  // Инженер изделия — ответственен за конкретное изделие (§10)
  engineerId: z.string().optional(),
});

// Номер изделия: «<номер проекта>.<N>» (точка — единый стиль с legacy),
// N — следующий суффикс в проекте по max(suffixInt). id изделия — отдельный
// cuid (Prisma default), номер — отображаемое уникальное поле.
async function nextProductSuffixInt(
  projectId: string,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const siblings = await tx.product.findMany({
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

  try {
    productLineTotal(data.expectedPrice ?? null, data.quantity);
    productLineTotal(data.initialPrice ?? null, data.quantity);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Некорректная сумма партии" };
  }
  const mutation = await withTaskTransaction(async (tx) => {
  const project = await tx.project.findUnique({
    where: { id: data.projectId },
    select: { id: true, number: true },
  });
  if (!project) return { ok: false as const, error: "Проект не найден" };
  if (data.engineerId && !await tx.user.findFirst({ where: { id: data.engineerId, active: true, roles: { hasSome: ["ENGINEER"] } }, select: { id: true } }))
    return { ok: false as const, error: "Выберите активного сотрудника с ролью инженера" };

  const suffixInt = await nextProductSuffixInt(project.id, tx);
  const number = `${project.number}.${suffixInt}`;
  const product = await tx.product.create({
    data: {
      projectId: project.id,
      number,
      suffixInt,
      title: data.title,
      quantity: data.quantity,
      kind: data.kind?.trim() || null,
      expectedPrice: data.expectedPrice,
      initialPrice: data.initialPrice,
      description: data.description?.trim() || null,
      engineerId: data.engineerId || null,
      createdById: session.user.id,
      statusHistory: {
        create: { toStatus: "DESIGN", changedById: session.user.id },
      },
    },
  });

  await tx.changeLog.create({ data: {
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "product",
    entityId: product.id,
    action: "create",
    newValue: { number, title: data.title, quantity: data.quantity, project: project.number },
  } });
  return { ok: true as const, product };
  });
  if (!mutation.ok) return mutation;
  const { product } = mutation;

  revalidateProduct(product);
  return { ok: true, id: product.id };
}

const updateSchema = z.object({
  title: z.string().min(1, "Укажите название изделия").optional(),
  quantity: z.number().int("Количество должно быть целым").min(1, "Количество должно быть не меньше 1").max(2_147_483_647, "Слишком большое количество изделий").optional(),
  kind: z.string().nullable().optional(),
  expectedPrice: z.number().nonnegative("Цена не может быть отрицательной").nullable().optional(),
  initialPrice: z
    .number()
    .nonnegative("Первоначальная цена не может быть отрицательной")
    .nullable()
    .optional(),
  description: z.string().nullable().optional(),
  engineerId: z.string().nullable().optional(),
});

// Редактирование изделия (§4): полностью — админ/директор/менеджер;
// инженер — только тех. блок (description).
export async function updateProduct(
  productId: string,
  input: z.infer<typeof updateSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  const roles = session.user.roles;
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;

  // Приоритет ролей: при комбинации менеджерских ролей с инженером права
  // старше — урезанное «только тех. блок» действует для чистого инженера
  if (!hasAnyRole(roles, MANAGER_ROLES)) {
    const keys = Object.keys(data);
    if (keys.some((key) => key !== "description")) {
      return { ok: false, error: "Инженер правит только технический блок" };
    }
  }

  try {
  const mutation = await withTaskTransaction(async (tx) => {
    await lockProductRow(tx, productId);
    const actor = await resolveVisibilityActor(tx, session.user);
    const before = await tx.product.findFirst({ where: { AND: [{ id: productId }, productEditWhere(actor)] } });
    if (!before) return { ok: false as const, error: "Изделие не найдено" };
    const oldCount = before.quantity ?? 1;
    const count = data.quantity ?? oldCount;
    productLineTotal(data.expectedPrice === undefined ? before.expectedPrice ?? null : data.expectedPrice, count);
    productLineTotal(data.initialPrice === undefined ? before.initialPrice ?? null : data.initialPrice, count);
    if (data.engineerId && data.engineerId !== before.engineerId && !await tx.user.findFirst({ where: { id: data.engineerId, active: true, roles: { hasSome: ["ENGINEER"] } }, select: { id: true } }))
      return { ok: false as const, error: "Выберите активного сотрудника с ролью инженера" };
    if (count !== oldCount) await recalculateQuantity(tx, { ...before, quantity: oldCount }, count);
    await tx.product.update({ where: { id: productId }, data });
    if ((data.expectedPrice !== undefined && String(data.expectedPrice) !== String(before.expectedPrice)) ||
        (data.engineerId !== undefined && data.engineerId !== before.engineerId)) await tx.productStagePayPool.updateMany({
      where: { productId, kind: "ENGINEERING", state: "DRAFT" }, data: { revision: { increment: 1 } },
    });
    return { ok: true as const, before };
  });
  if (!mutation.ok) return mutation;
  const { before } = mutation;

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
  if (data.quantity !== undefined) {
    for (const path of ["/", "/warehouse", "/warehouse/stock", "/warehouse/items", "/finance"]) revalidatePath(path);
  }
  return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось изменить изделие" };
  }
}

// Смена статуса изделия: переходы свободные, каждый — в историю (§6),
// событием product.statusChanged и org-уведомлением A/D/M.
export async function changeProductStatus(
  productId: string, toStatus: ProductStatus, comment?: string,
): Promise<{ ok: boolean; error?: string; financeState?: FinanceState }> {
  const session = await requireUser();
  if (!Object.hasOwn(productStatusLabels, toStatus)) return { ok: false, error: "Неизвестный статус изделия" };
  try {
    const result = await withTaskTransaction((tx) => changeProductStatusTransaction(tx,
      { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" },
      productId, toStatus, comment));
    if (!result.ok) return result;
    let financeState: FinanceState = null;
    for (const kind of result.captured) {
      let current: FinanceState;
      try { current = await settlePendingProductPercentage(productId, kind); }
      catch { current = "PENDING_FX"; }
      financeState = current === "PENDING_FX" || financeState === "PENDING_FX" ? "PENDING_FX" : current;
    }
    if (result.eventId) {
      await dispatchEvent(result.eventId).catch(() => {});
      await notifyOrg({ type: "product.statusChanged",
        title: `${result.product.number}: ${productStatusLabels[result.product.status]} → ${productStatusLabels[toStatus]}`,
        body: result.product.title, link: `/products/${productId}`, exceptUserId: session.user.id,
      }).catch(() => {});
    }
    revalidateProduct(result.product);
    return { ok: true, financeState };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось изменить статус изделия" };
  }
}

// Финансовая история и работы не удаляются вместе с изделием.
export async function deleteProduct(productId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  if (!hasAnyRole(session.user.roles, MANAGER_ROLES)) throw new Error("Недостаточно прав");
  const result = await withTaskTransaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId }, include: {
      _count: { select: { tasks: true, works: true, projectMaterials: true, stockMovements: true } },
    } });
    if (!product) return { ok: false as const, error: "Изделие не найдено" };
    const { tasks, works, projectMaterials, stockMovements } = product._count;
    if (tasks + works + projectMaterials + stockMovements > 0) return { ok: false as const, error: "К изделию привязаны задачи, работы или материалы — сначала удалите или отвяжите их" };
    if (await tx.productStagePayPool.count({ where: { productId, state: { in: ["SETTLED", "LEGACY_PROTECTED"] } } }))
      return { ok: false as const, error: "Нельзя удалить изделие с историей инженерных начислений" };
    if (await tx.productPercentageCompletion.count({ where: { productId } }))
      return { ok: false as const, error: "Нельзя удалить изделие с историей процентного этапа" };
    const configs = await tx.productPercentageConfig.findMany({ where: { productId }, select: { id: true } });
    if (configs.length) {
      await tx.productPercentageParticipant.deleteMany({ where: { configId: { in: configs.map((config) => config.id) } } });
      await tx.productPercentageConfig.deleteMany({ where: { productId } });
    }
    await tx.productStagePayPool.deleteMany({ where: { productId, state: "DRAFT" } });
    await tx.product.delete({ where: { id: productId } });
    await tx.changeLog.create({ data: {
      actorType: "user", actorId: session.user.id, actorName: session.user.name,
      entity: "product", entityId: productId, action: "delete", oldValue: { number: product.number, title: product.title },
    } });
    return { ok: true as const, product };
  });
  if (!result.ok) return result;
  revalidateProduct(result.product);
  return { ok: true };
}
// Опции изделий проекта для диалога задачи (клиентский компонент
// не может дёрнуть queries.ts напрямую — только server action).
export async function fetchProductOptions(
  projectId: string,
): Promise<{ id: string; number: string; title: string }[]> {
  const session = await requireUser();
  return listProductOptions(projectId, session.user);
}
