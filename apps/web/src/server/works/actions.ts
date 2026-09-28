"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeChangeLog } from "@/server/plugins/changelog";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { withTaskTransaction } from "@/server/tasks/transaction";

import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";

const addSchema = z.object({
  projectId: z.string(),
  productId: z.string().optional(), // изделие проекта (необязательно)
  priceItemId: z.string().min(1, "Выберите расценку"),
  quantity: z.number().positive("Количество должно быть больше нуля"),
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

  // Изделие должно принадлежать проекту работы
  if (data.productId) {
    const product = await prisma.product.findFirst({
      where: { id: data.productId, projectId: data.projectId },
      select: { id: true },
    });
    if (!product) return { ok: false, error: "Изделие не найдено в этом проекте" };
  }

  const total = Number(priceItem.price) * data.quantity;
  const work = await prisma.work.create({
    data: {
      projectId: data.projectId,
      productId: data.productId || null,
      priceItemId: priceItem.id,
      title: priceItem.name,
      quantity: data.quantity,
      priceSnapshot: priceItem.price,
      total,
      createdById: session.user.id,
    },
  });

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
      quantity: data.quantity,
      price: priceItem.price.toString(),
      total,
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
    oldValue: { title: work.title, total: work.total.toString() },
  });
  revalidatePath(`/projects/${work.projectId}`);
  await revalidateProductPaths(work.productId);
  return { ok: true };
}
