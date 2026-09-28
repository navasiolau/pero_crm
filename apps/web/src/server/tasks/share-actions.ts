"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLE_PRIORITY, roleComboLabel } from "@/lib/roles";
import { FULL_SHARE_UNITS, taskPieceAmount } from "@/lib/work-shares";
import { taskExecutionWhere } from "@/server/access/visibility";
import { notifyPerson } from "@/server/notifications/notify";
import { dispatchEvent } from "@/server/plugins/events";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { splitTaskCore, type SplitTaskInput } from "./share-core";
import { canSplitTask, taskRecipientError } from "./share-policy";
import { withTaskTransaction } from "./transaction";

export async function getTaskSplitOptions(taskId: string): Promise<{ ok: false; error: string } | {
  ok: true; options: { id: string; name: string; hint: string; disabledReason: string | null }[];
  share: { units: number; amount: string; currency: string | null; quantity: string | null; revision: number };
  assigneeName: string;
}> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Не авторизован" };
  const task = await prisma.task.findFirst({
    where: { AND: [{ id: taskId }, taskExecutionWhere(session.user)] },
    include: { product: { select: { engineerId: true, status: true } }, work: { select: { priceSnapshot: true } }, allocationGroup: true, assignee: { select: { name: true } }, _count: { select: { payrollEntries: true } } },
  });
  if (!task || !canSplitTask(session.user, { ...task, paidCount: task._count.payrollEntries })) return { ok: false, error: "Задача недоступна для разделения: проверьте исполнителя, статус и начисления" };
  if (task.work && task.quantity === null) return { ok: false, error: "Менеджер должен сначала указать количество задачи" };
  const users = await prisma.user.findMany({ where: { active: true, roles: { hasSome: ROLE_PRIORITY } }, select: { id: true, name: true, roles: true, active: true, position: true }, orderBy: { name: "asc" } });
  const currency = task.allocationGroup ? task.allocationGroup.currency : task.work ? (await prisma.orgSetting.findUnique({ where: { key: "payrollCurrency" } }))?.value ?? "BYN" : null;
  return {
    ok: true,
    options: users.map((user) => ({ id: user.id, name: user.name, hint: [roleComboLabel(user.roles), user.position].filter(Boolean).join(" · "), disabledReason: user.id === task.assigneeId ? "Уже исполнитель этой задачи" : taskRecipientError(user, task.product) })),
    share: { units: task.shareUnits ?? FULL_SHARE_UNITS, amount: task.work ? taskPieceAmount(task, task.work.priceSnapshot) : "0.00", currency, quantity: task.work ? task.quantity?.toString() ?? null : null, revision: task.splitRevision },
    assigneeName: task.assignee?.name ?? "Исполнитель",
  };
}

export async function splitTask(input: SplitTaskInput): Promise<{ ok: boolean; error?: string; childTaskId?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Не авторизован" };
  const result = await splitTaskCore({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, input, withTaskTransaction);
  if (!result.ok) return result;
  if (!result.repeated) {
    if (result.eventId) await dispatchEvent(result.eventId).catch(() => {});
    await notifyPerson({ userId: result.recipientId, type: "task.assigned", title: `Вам передана часть задачи: ${result.title}`, body: `Проект ${result.projectNumber}`, link: "/my" }).catch(() => {});
  }
  revalidatePath("/my"); revalidatePath("/tasks"); revalidatePath(`/projects/${result.projectId}`);
  await revalidateProductPaths(result.productId);
  return { ok: true, childTaskId: result.childTaskId };
}
