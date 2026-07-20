"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { formatAmount } from "@/lib/format";
import { writeChangeLog } from "@/server/plugins/changelog";
import { emitDomainEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";
import { requireAdmin } from "@/server/require-role";

// Приходы (платежи) по проектам — администратор/директор (§11, только они
// видят финансы). Основа оборота для «% от оборота» (§10). Кассы и курсы
// валют — фаза 5.

const paymentSchema = z.object({
  projectId: z.string().min(1),
  amount: z.number().positive("Сумма должна быть больше нуля"),
  paidAt: z.string().optional(), // YYYY-MM-DD; пусто — сейчас
  comment: z.string().optional(),
});

export async function addPayment(
  input: z.input<typeof paymentSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;
  const project = await prisma.project.findUnique({
    where: { id: data.projectId },
    select: { id: true, number: true, currency: true },
  });
  if (!project) return { ok: false, error: "Проект не найден" };

  // Копейки: ровно два знака
  const amount = Math.round(data.amount * 100) / 100;
  const payment = await prisma.payment.create({
    data: {
      projectId: project.id,
      amount,
      currency: project.currency,
      paidAt: data.paidAt ? new Date(`${data.paidAt}T12:00:00`) : new Date(),
      comment: data.comment?.trim() || null,
      createdById: session.user.id,
    },
  });

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "payment",
    entityId: payment.id,
    action: "create",
    newValue: { project: project.number, amount },
  });
  await emitDomainEvent(
    "payment.created",
    { paymentId: payment.id, projectId: project.id, amount },
    session.user.id,
  );
  await notifyOrg({
    type: "payment.added",
    title: `Приход ${formatAmount(amount, project.currency)} · ${project.number}`,
    body: data.comment?.trim() || undefined,
    link: `/projects/${project.id}`,
    exceptUserId: session.user.id,
  });

  revalidatePath(`/projects/${project.id}`);
  revalidatePath("/finance/payroll");
  return { ok: true };
}

export async function deletePayment(
  paymentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { project: { select: { id: true, number: true } } },
  });
  if (!payment) return { ok: false, error: "Платёж не найден" };

  await prisma.payment.delete({ where: { id: paymentId } });
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "payment",
    entityId: paymentId,
    action: "delete",
    oldValue: { project: payment.project.number, amount: Number(payment.amount) },
  });

  revalidatePath(`/projects/${payment.project.id}`);
  revalidatePath("/finance/payroll");
  return { ok: true };
}
