"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeChangeLog } from "@/server/plugins/changelog";

import { MANAGER_ROLES } from "@/server/projects/queries";

const addSchema = z.object({
  projectId: z.string(),
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
  if (!MANAGER_ROLES.includes(session.user.role)) throw new Error("Недостаточно прав");

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

  const total = Number(priceItem.price) * data.quantity;
  const work = await prisma.work.create({
    data: {
      projectId: data.projectId,
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
  return { ok: true };
}

export async function removeWork(
  workId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  if (!MANAGER_ROLES.includes(session.user.role)) throw new Error("Недостаточно прав");

  const work = await prisma.work.findUnique({ where: { id: workId } });
  if (!work) return { ok: false, error: "Работа не найдена" };
  const linked = await prisma.task.count({ where: { workId } });
  if (linked > 0) {
    return { ok: false, error: "К работе привязаны задачи — сначала удалите их" };
  }

  await prisma.work.delete({ where: { id: workId } });
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
  return { ok: true };
}
