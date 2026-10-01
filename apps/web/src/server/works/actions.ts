"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeChangeLog } from "@/server/plugins/changelog";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { inputNorm, scaleNorm, workBudget } from "@/lib/product-quantity";
import { lockProductRow } from "@/server/products/quantity-core";

import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";

const addSchema = z.object({
  projectId: z.string(),
  productId: z.string().optional(), // изделие проекта (необязательно)
  priceItemId: z.string().min(1, "Выберите расценку"),
  quantity: z.number().positive("Количество должно быть больше нуля").optional(),
  quantityPerUnit: z.number().positive("Количество должно быть больше нуля").optional(),
});

// Добавление работы в проект (§9): цена фиксируется снимком
// на момент назначения — смена прайса прошлое не переписывает.
export async function addWork(
  input: z.infer<typeof addSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  if (!hasAnyRole(session.user.roles, MANAGER_ROLES)) throw new Error("Недостаточно прав");

  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;

  const [project, priceItem] = await Promise.all([
    prisma.project.findUnique({ where: { id: data.projectId }, select: { id: true, number: true } }),
    prisma.priceItem.findUnique({ where: { id: data.priceItemId } }),
  ]);
  if (!project) return { ok: false, error: "Проект не найден" };
  if (!priceItem) return { ok: false, error: "Расценка не найдена" };
  if (!priceItem.active) return { ok: false, error: "Расценка неактивна" };

  let work;
  try {
    work = await withTaskTransaction(async (tx) => {
      if (data.productId) await lockProductRow(tx, data.productId);
      const product = data.productId ? await tx.product.findFirst({
        where: { id: data.productId, projectId: data.projectId }, select: { id: true, quantity: true },
      }) : null;
      if (data.productId && !product) throw new Error("Изделие не найдено в этом проекте");
      if (!product && data.quantityPerUnit !== undefined) throw new Error("Для нормы на штуку выберите изделие");
      const norm = inputNorm(data, product?.quantity ?? 1, 2, 10);
      const quantity = scaleNorm(norm, product?.quantity ?? 1, 2, 10);
      return tx.work.create({ data: {
        projectId: data.projectId, productId: product?.id ?? null, priceItemId: priceItem.id,
        title: priceItem.name, quantity, quantityPerUnit: product ? norm : null,
        priceSnapshot: priceItem.price, total: workBudget(priceItem.price, quantity), createdById: session.user.id,
      } });
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось добавить работу" };
  }

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "work",
    entityId: work.id,
    action: "create",
    newValue: {
      project: project.number,
      title: work.title,
      quantity: work.quantity.toString(),
      quantityPerUnit: work.quantityPerUnit?.toString() ?? null,
      price: priceItem.price.toString(),
      total: work.total?.toString() ?? null,
    },
  });
  revalidatePath(`/projects/${data.projectId}`);
  await revalidateProductPaths(data.productId);
  return { ok: true };
}

export async function removeWork(
  workId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  if (!hasAnyRole(session.user.roles, MANAGER_ROLES)) throw new Error("Недостаточно прав");

  const mutation = await withTaskTransaction(async (tx) => {
  const work = await tx.work.findUnique({ where: { id: workId } });
  if (!work) return { ok: false as const, error: "Работа не найдена" };
  if (work.paymentKind === "ENGINEERING") return { ok: false as const, error: "Работа включена в инженерный фонд — используйте настройку его распределения" };
  if (work.paymentKind === "INSTALLATION") return { ok: false as const, error: "Работа отмечена как монтажная; её история сохраняется вместе с настройкой процента изделия" };
  const linked = await tx.task.count({ where: { workId } });
  if (linked > 0) {
    return { ok: false as const, error: "К работе привязаны задачи — сначала удалите их" };
  }

  await tx.work.delete({ where: { id: workId } });
  return { ok: true as const, work };
  });
  if (!mutation.ok) return mutation;
  const { work } = mutation;
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "work",
    entityId: workId,
    action: "delete",
    oldValue: { title: work.title, total: work.total?.toString() ?? null },
  });
  revalidatePath(`/projects/${work.projectId}`);
  await revalidateProductPaths(work.productId);
  return { ok: true };
}
