"use server";

import { writeChangeLogInTransaction } from "@/server/changelog/writer";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";


import { INTERNAL_CURRENCY, INTERNAL_CURRENCY_ERROR } from "@/lib/internal-currency";
import { BYN_UNAVAILABLE_REASON } from "@/lib/history-byn";
import { confirmMutation } from "@/server/operations/confirmation";
import { prisma } from "@/lib/prisma";
import { formatAmount } from "@/lib/format";
import { ADVANCE_ROLES, PAYROLL_MANAGE_ROLES } from "@/lib/roles";
import { deletePayoutInTransaction } from "./payout-reversal";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyOrg, notifyPerson } from "@/server/notifications/notify";
import { requireAdmin, requireFinance, requirePayrollManagement, requireRole } from "@/server/require-role";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { assertPayrollCurrencyChange } from "@/server/product-stage-pay/core";
import { assertPercentagePayrollCurrencyChange } from "@/server/product-percentage-pay/core";
import { executeCashPayout, preparedRates } from "./cash-service";
import { readPayoutBatch, settlePayoutBatch } from "./payout-batch";
import { deliverCashPayout } from "./cash-post-commit";
import { accrueTurnoverCore } from "./turnover-core";
import { isCashCurrency } from "@/lib/cash-ledger";

import {
  getEmployeeDues,
  getOrgBalance,
  isValidMonth,
  readPayrollSummary,
} from "./queries";



function revalidatePayroll() {
  revalidatePath("/payroll");
  revalidatePath("/finance/payroll");
}

// ─── Выплаты (§10): вносят админ/директор/бухгалтер, история по месяцам ──────

const payoutSchema = z.object({
  userId: z.string().min(1, "Выберите сотрудника"),
  amount: z.number().positive("Сумма должна быть больше нуля").optional(),
  cashAmount: z.string().optional(),
  cashAccountId: z.string().optional(),
  expectedCashCurrency: z.string().optional(),
  requestId: z.string().optional(),
  month: z.string().refine(isValidMonth, "Некорректный расчётный месяц"),
  kind: z.enum(["SALARY", "ADVANCE"]).default("SALARY"),
  comment: z.string().optional(),
});

export async function addPayout(
  input: z.input<typeof payoutSchema>,
): Promise<Awaited<ReturnType<typeof executeCashPayout>>> {
  const session = await requireRole(input?.kind === "ADVANCE" ? ADVANCE_ROLES : PAYROLL_MANAGE_ROLES);
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;
  if (!data.cashAccountId) return { ok: false, error: "Выберите кассу" };
  if (!data.expectedCashCurrency || !isCashCurrency(data.expectedCashCurrency)) return { ok: false, error: "Обновите выбранную кассу и валюту" };
  if (!data.requestId) return { ok: false, error: "Обновите форму выплаты перед подтверждением" };
  const cashAmount = data.cashAmount ?? (data.amount === undefined ? "" : data.amount.toFixed(2));
  return executeCashPayout({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, {
    kind: data.kind, userId: data.userId, cashAccountId: data.cashAccountId, cashAmount,
    expectedCashCurrency: data.expectedCashCurrency,
    requestId: data.requestId, month: data.month, description: data.comment, comment: data.comment,
  });
}

export async function deletePayout(
  payoutId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireFinance();
  try {
    await withTaskTransaction(tx => deletePayoutInTransaction(tx,
      { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, payoutId));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось удалить выплату" };
  }
  revalidatePayroll();
  revalidatePath("/finance/accounts");
  revalidatePath("/advances");
  revalidatePath("/finance/advances");
  revalidatePath("/finance/accounts/report");
  revalidatePath("/changelog");
  return { ok: true };
}

// ─── Начисление «% от оборота» за расчётный месяц (§10) ─────────────────────
// Запускает администратор при закрытии месяца. НАЧИСЛЯТЬ МОЖНО ТОЛЬКО ЗА
// ПРОШЛЫЙ МЕСЯЦ: в текущем месяце оборот ещё меняется, поэтому показываем
// приблизительную зарплату, но начисление заблокировано (правило владельца).
// Сумма начисления всегда сравнивается с ТЕКУЩИМ оборотом: вырос — создаётся
// доначисление разницы, снизился — не трогаем (переплату разбирает вручную).

async function attemptPayrollEffect(effect: () => unknown): Promise<void> {
  try { await effect(); } catch { /* Сохранённое начисление и его outbox остаются подтверждёнными. */ }
}

export async function accrueTurnover(
  month: string,
): Promise<{ ok: boolean; error?: string; accruedCount?: number }> {
  const session = await requirePayrollManagement();
  const result = await accrueTurnoverCore({ id: session.user.id, name: session.user.name ?? "",
    roles: session.user.roles, source: "web" }, month, withTaskTransaction).catch((error: unknown) => ({
      ok: false as const, error: error instanceof Error ? error.message : "Не удалось начислить процент от оборота",
    }));
  if (!result.ok) return { ok: false, error: result.error };
  for (const earning of result.earnings) {
    await attemptPayrollEffect(() => dispatchEvent(earning.eventId));
    await attemptPayrollEffect(() => notifyPerson({ userId: earning.userId, type: "payroll.accrued",
      title: `${earning.isTopUp ? "Доначислена" : "Начислена"} зарплата: ${formatAmount(earning.amount, result.currency)}`,
      body: `${earning.percent}% от оборота за ${month}`, link: "/payroll" }));
  }
  if (result.accruedCount > 0) {
    await attemptPayrollEffect(() => notifyOrg({ type: "payroll.orgAccrued", title: `Начислено % от оборота за ${month}: ${result.accruedCount} сотр.`,
      body: `Оборот ${formatAmount(result.total, result.currency)}`, link: "/finance/payroll", exceptUserId: session.user.id }));
  }
  await attemptPayrollEffect(revalidatePayroll);
  return { ok: true, accruedCount: result.accruedCount };
}
// ─── «Рассчитать всех» (§10): массовые выплаты по задолженности ─────────────
// Каждому сотруднику с долгом создаётся выплата min(долг, остаток баланса)
// с комментарием «Выплата зарплаты от <текущая дата>». Если баланса не
// хватает — в конце списка получат частично или будут пропущены.

export async function settleAll(month: string, cashAccountId?: string, requestId?: string): Promise<{
  ok: boolean; error?: string; paidCount?: number; totalPaid?: number; shortPaid?: string[]; batchId?: string; retrySafe?: boolean;
}> {
  const { user } = await requirePayrollManagement();
  if (!isValidMonth(month)) return { ok: false, error: "Некорректный месяц" };
  if (!cashAccountId) return { ok: false, error: "Выберите кассу для расчёта" };
  const batchId = z.uuid().safeParse(requestId ?? randomUUID());
  if (!batchId.success) return { ok: false, error: "Некорректный идентификатор расчёта" };
  const actor = { id: user.id, name: user.name ?? "", roles: user.roles, source: "web" as const };
  const input = { id: batchId.data.toLowerCase(), month, cashAccountId };
  const view = (result: { paidIds: string[]; totalPaid: string; shortPaid: string[] }) => ({
    ok: true, batchId: input.id, paidCount: result.paidIds.length, totalPaid: Number(result.totalPaid), shortPaid: result.shortPaid,
  });
  try {
    const previous = await readPayoutBatch(prisma, actor, input);
    if (previous) return view(previous);
    const initial = await readPayrollSummary(month);
    const dues = await getEmployeeDues(initial);
    if (dues.some(row => row.due === null) || await getOrgBalance(initial) === null) throw Error(BYN_UNAVAILABLE_REASON);
    const debtors = dues.filter(row => row.due !== null && row.due > 0);
    if (!debtors.length) throw Error("Задолженности перед сотрудниками нет");
    const rates = await preparedRates(cashAccountId);
    const date = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Minsk" }).format(new Date());
    const comment = `Выплата зарплаты от ${date}`;
    const outcome = await confirmMutation(withTaskTransaction, tx => settlePayoutBatch(tx, actor, input, debtors, rates, comment),
      async (tx, candidate) => {
        const previous = await readPayoutBatch(tx, actor, input);
        if (!previous) return null;
        return candidate ?? { result: previous, effects: [] };
      });
    if (outcome.outcome === "UNKNOWN") {
      return { ok: false, retrySafe: Boolean(requestId), error: "Не удалось подтвердить пакет выплат. Повторите тот же запрос." };
    }
    if (outcome.outcome === "ROLLED_BACK") throw outcome.error;
    for (const result of outcome.value.effects) {
      await deliverCashPayout(result, { kind: "SALARY", comment }, actor.id, { dispatchEvent, notifyPerson, notifyOrg, revalidatePath });
    }
    await attemptPayrollEffect(() => revalidatePath("/finance/accounts/report"));
    await attemptPayrollEffect(() => revalidatePath("/changelog"));
    return view(outcome.value.result);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось провести пакет выплат" };
  }
}

// ─── Валюта зарплаты (§10): единая, задаётся администратором ────────────────



export async function setPayrollCurrency(
  currency: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  if (currency !== INTERNAL_CURRENCY) {
    return { ok: false, error: INTERNAL_CURRENCY_ERROR };
  }
  let before: string;
  try {
    before = await withTaskTransaction(async (tx) => {
      const current = (await tx.orgSetting.findUnique({ where: { key: "payrollCurrency" } }))?.value ?? "BYN";
      if (current === currency) return current;
      await assertPayrollCurrencyChange(tx, currency);
      await assertPercentagePayrollCurrencyChange(tx, currency);
      if (await tx.payout.count({ where: { cashAccountId: { not: null } } })) {
        throw new Error("Валюта зарплаты зафиксирована выплатами из кассы");
      }
      await tx.orgSetting.upsert({ where: { key: "payrollCurrency" }, update: { value: currency }, create: { key: "payrollCurrency", value: currency } });
      await writeChangeLogInTransaction(tx, {
        actorType: "user", actorId: session.user.id, actorName: session.user.name ?? undefined,
        entity: "orgSetting", entityId: "payrollCurrency", action: "update", field: "value",
        oldValue: current, newValue: currency,
      }, { entity: { label: "Валюта зарплаты", href: "/settings/payroll" }, contexts: [], before: { currency: current }, after: { currency } });
      return current;
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось изменить валюту зарплаты" };
  }
  if (before === currency) return { ok: true };
  revalidatePath("/settings/payroll");
  revalidatePayroll();
  return { ok: true };
}
