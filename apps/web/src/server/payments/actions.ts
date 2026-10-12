"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireFinance } from "@/server/require-role";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { deletePaymentInTransaction } from "./delete-core";
import { getPayrollCurrency } from "@/server/payroll/queries";
import { getNbrbRate } from "@/server/finance/nbrb";

import type { PaymentMutationResult } from "./contracts";
import { createPaymentCore } from "./core";

// Server actions — тонкие обёртки над ядром (./core): сессия → актёр
// (source "web"), вся логика платежа и проверка FINANCE_ROLES — в ядре
// (переиспользуется telegram-ботом, source "telegram").

export async function getPaymentActorId(): Promise<{ok: true; actorId: string} | {ok: false; error: string}> {
  try {const session = await requireFinance(); return {ok: true, actorId: session.user.id};}
  catch {return {ok: false, error: "Не удалось подтвердить учётную запись — обновите страницу"};}
}
export async function addPayment(
  input: Parameters<typeof createPaymentCore>[1], expectedActorId: string,
): Promise<PaymentMutationResult> {
  const session = await requireFinance();
  if (!expectedActorId || expectedActorId !== session.user.id) return {ok: false, outcome: "ROLLED_BACK", kind: "actor-changed", clientMutationId: input.clientMutationId,
    error: "Учётная запись изменилась — обновите страницу"};
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
  const preview = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { project: { select: { id: true, number: true } } },
  });
  if (!preview) return { ok: false, error: "Платёж не найден" };
  const payrollCurrency = preview.direction === "INCOME" ? await getPayrollCurrency() : "BYN";
  let payrollRate = "1.000000";
  if (preview.direction === "INCOME" && payrollCurrency !== "BYN") {
    try { payrollRate = (await getNbrbRate(payrollCurrency)).rate.toFixed(6); }
    catch { return { ok: false, error: "Не удалось получить курс для проверки баланса организации" }; }
  }
  let payment;
  try {
    payment = await withTaskTransaction(async (tx) => {
      return deletePaymentInTransaction({id:session.user.id,name:session.user.name??'',roles:session.user.roles,source:'web'},paymentId,preview.direction,payrollCurrency,payrollRate,tx);
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось удалить платёж" };
  }

  if (payment.project) revalidatePath(`/projects/${payment.project.id}`);
  revalidatePath("/finance/income");
  revalidatePath("/finance/expenses");
  revalidatePath("/finance/payroll");
  revalidatePath("/finance/accounts");
  return { ok: true };
}
