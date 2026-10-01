"use server";

import { revalidatePath } from "next/cache";
import { INTERNAL_CURRENCY } from "@/lib/internal-currency";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLE_PRIORITY, roleComboLabel } from "@/lib/roles";
import { FULL_SHARE_UNITS, moneyAtoms, quantityFromAtoms, taskPieceAmount } from "@/lib/work-shares";
import { resolveVisibilityActor, taskExecutionWhere } from "@/server/access/visibility";
import { getEngineeringTaskPreview } from "@/server/product-stage-pay/preview";
import { notifyPerson } from "@/server/notifications/notify";
import { dispatchEvent } from "@/server/plugins/events";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { splitTaskCore, type SplitTaskInput } from "./share-core";
import { canSplitTask, engineeringRecipientError, taskRecipientError } from "./share-policy";
import { withTaskTransaction } from "./transaction";

export async function getTaskSplitOptions(taskId: string): Promise<{ ok: false; error: string } | {
  ok: true; options: { id: string; name: string; hint: string; disabledReason: string | null }[];
  share: { units: number; amount: string | null; currency: string | null; quantity: string | null; revision: number; source: "LEGACY" | "ENGINEERING" | "INSTALLATION"; stageUnits: number | null; previewAmount: string | null; previewCurrency: string | null; previewReason: string | null; settledSource: boolean; engineeringPreview: { workAmount: string; currency: string; tasks: { id: string; stageShareUnits: number; createdAt: string }[] } | null };
  assigneeName: string;
}> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Не авторизован" };
  const actor = await resolveVisibilityActor(prisma, session.user);
  const task = await prisma.task.findFirst({
    where: { AND: [{ id: taskId }, taskExecutionWhere(actor)] },
    include: { product: { select: { id: true, engineerId: true, status: true } }, work: { select: { priceSnapshot: true, paymentKind: true, stagePayPool: { select: { state: true } } } }, allocationGroup: true, assignee: { select: { name: true } }, _count: { select: { payrollEntries: true } } },
  });
  if (!task || !canSplitTask(actor, { ...task, paidCount: task._count.payrollEntries })) return { ok: false, error: "Задача недоступна для разделения: проверьте исполнителя, статус и начисления" };
  const engineering = task.work?.paymentKind === "ENGINEERING";
  const installation = task.work?.paymentKind === "INSTALLATION";
  if (engineering && task.work?.stagePayPool?.state !== "DRAFT") return { ok: false, error: "Инженерный фонд уже закрыт" };
  if (task.work && task.quantity === null) return { ok: false, error: "Менеджер должен сначала указать количество задачи" };
  const users = await prisma.user.findMany({ where: engineering ? { active: true } : { active: true, roles: { hasSome: ROLE_PRIORITY } }, select: { id: true, name: true, roles: true, active: true, position: true }, orderBy: { name: "asc" } });
  const currency = engineering || installation ? null : task.allocationGroup ? task.allocationGroup.currency : task.work ? (await prisma.orgSetting.findUnique({ where: { key: "payrollCurrency" } }))?.value ?? "BYN" : null;
  if (task.work && !engineering && !installation && currency !== INTERNAL_CURRENCY)
    return { ok: false, error: "Денежное деление доступно только для подтверждённой BYN-базы" };
  let preview: { amount: string; currency: string; settled: boolean } | undefined;
  let previewReason: string | null = null;
  let engineeringPreview: { workAmount: string; currency: string; tasks: { id: string; stageShareUnits: number; createdAt: string }[] } | null = null;
  if (engineering && task.product) {
    try {
      const values = await getEngineeringTaskPreview(prisma, task.product.id);
      preview = values.get(task.id);
      const siblings = await prisma.task.findMany({ where: { workId: task.workId }, select: { id: true, stageShareUnits: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      if (preview && siblings.every((sibling) => sibling.stageShareUnits !== null && values.has(sibling.id))) {
        engineeringPreview = { workAmount: quantityFromAtoms(siblings.reduce((sum, sibling) => sum + moneyAtoms(values.get(sibling.id)!.amount), BigInt(0))), currency: preview.currency,
          tasks: siblings.map((sibling) => ({ id: sibling.id, stageShareUnits: sibling.stageShareUnits!, createdAt: sibling.createdAt.toISOString() })) };
      }
    }
    catch { previewReason = "Предварительная сумма недоступна: проверьте курс фонда"; }
    if (!preview && !previewReason) previewReason = "Задайте цену, ставку и полное распределение фонда";
  }
  return {
    ok: true,
    options: users.map((user) => ({ id: user.id, name: user.name, hint: [roleComboLabel(user.roles), user.position].filter(Boolean).join(" · "), disabledReason: user.id === task.assigneeId ? "Уже исполнитель этой задачи" : engineering ? engineeringRecipientError(user, task.product) : taskRecipientError(user, task.product) })),
    share: { units: task.shareUnits ?? FULL_SHARE_UNITS, amount: engineering || installation ? null : task.work?.priceSnapshot !== null && task.work?.priceSnapshot !== undefined ? taskPieceAmount(task, task.work.priceSnapshot) : "0.00", currency, quantity: task.work ? task.quantity?.toString() ?? null : null, revision: task.splitRevision,
      source: engineering ? "ENGINEERING" : installation ? "INSTALLATION" : "LEGACY", stageUnits: engineering ? task.stageShareUnits : null, previewAmount: preview?.amount ?? null, previewCurrency: preview?.currency ?? null, previewReason, settledSource: preview?.settled ?? false, engineeringPreview },
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
