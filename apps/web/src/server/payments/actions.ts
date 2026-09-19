"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { writeChangeLog } from "@/server/plugins/changelog";
import { requireFinance } from "@/server/require-role";

import { createPaymentCore } from "./core";

// Server actions — тонкие обёртки над ядром (./core): сессия → актёр
// (source "web"), вся логика платежа и проверка FINANCE_ROLES — в ядре
// (переиспользуется telegram-ботом, source "telegram").

export async function addPayment(
  input: Parameters<typeof createPaymentCore>[1],
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireFinance();
  return createPaymentCore(
    {
      id: session.user.id,
      name: session.user.name ?? "",
      roles: session.user.roles,
      source: "web" as const,
    },
    input,
  );
}

export async function deletePayment(
  paymentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireFinance();
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
    oldValue: {
      project: payment.project.number,
      direction: payment.direction,
      amount: Number(payment.amount),
      currency: payment.currency,
      bynAmount: Number(payment.bynAmount),
    },
  });

  revalidatePath(`/projects/${payment.project.id}`);
  revalidatePath("/finance/payroll");
  revalidatePath("/finance/accounts");
  return { ok: true };
}
