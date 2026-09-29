"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireFinance } from "@/server/require-role";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { readCashBalance, readOrgBalance } from "@/server/payroll/cash-core";
import { getPayrollCurrency } from "@/server/payroll/queries";
import { getNbrbRate } from "@/server/finance/nbrb";

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
      const current = await tx.payment.findUnique({ where: { id: paymentId }, include: { project: { select: { id: true, number: true } } } });
      if (!current) throw new Error("Платёж не найден");
      if (current.direction === "INCOME") {
        if (preview.direction !== current.direction) throw new Error("Платёж изменился — повторите операцию");
        const setting = await tx.orgSetting.findUnique({ where: { key: "payrollCurrency" } });
        if ((setting?.value ?? "BYN") !== payrollCurrency) throw new Error("Валюта зарплаты изменилась — повторите операцию");
        if (current.cashAccountId) {
          const cashBalance = await readCashBalance(tx, current.cashAccountId);
          if (cashBalance.sub(current.amount).lt(0)) throw new Error("Удаление прихода сделает остаток кассы отрицательным");
        }
        const orgBalanceAfter = await readOrgBalance(tx, payrollRate, `-${current.bynAmount.toFixed(2)}`);
        if (orgBalanceAfter.lt(0)) throw new Error("Удаление прихода сделает баланс организации отрицательным");
      }
      await tx.payment.delete({ where: { id: paymentId } });
      await tx.changeLog.create({ data: { actorType: "user", actorId: session.user.id, actorName: session.user.name ?? undefined,
        entity: "payment", entityId: paymentId, action: "delete", oldValue: { project: current.project.number,
          direction: current.direction, amount: current.amount.toFixed(2), currency: current.currency,
          bynAmount: current.bynAmount.toFixed(2) } } });
      return current;
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось удалить платёж" };
  }

  revalidatePath(`/projects/${payment.project.id}`);
  revalidatePath("/finance/payroll");
  revalidatePath("/finance/accounts");
  return { ok: true };
}
