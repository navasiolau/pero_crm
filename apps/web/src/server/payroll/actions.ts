"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { INTERNAL_CURRENCY, INTERNAL_CURRENCY_ERROR } from "@/lib/internal-currency";
import { historicalByn, BYN_UNAVAILABLE_REASON } from "@/lib/history-byn";
import { prisma } from "@/lib/prisma";
import { formatAmount } from "@/lib/format";
import { writeChangeLog } from "@/server/plugins/changelog";
import { emitDomainEvent } from "@/server/plugins/events";
import { notifyOrg, notifyPerson } from "@/server/notifications/notify";
import { requireAdmin, requireFinance } from "@/server/require-role";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { assertPayrollCurrencyChange } from "@/server/product-stage-pay/core";
import { assertPercentagePayrollCurrencyChange } from "@/server/product-percentage-pay/core";
import { executeCashPayout } from "./cash-service";
import { calculateCashPayout, isCashCurrency, parseCashRate } from "@/lib/cash-ledger";
import { listCashAccounts } from "@/server/finance/queries";
import { getNbrbRate } from "@/server/finance/nbrb";

import {
  currentMonth,
  getEmployeeDues,
  getMonthTurnover,
  getOrgBalance,
  getPayrollCurrency,
  isValidMonth,
  round2,
} from "./queries";

const MONTH_RE = /^\d{4}-\d{2}$/;

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
  month: z.string().regex(MONTH_RE, "Месяц в формате ГГГГ-ММ"),
  kind: z.enum(["SALARY", "ADVANCE"]).default("SALARY"),
  comment: z.string().optional(),
});

export async function addPayout(
  input: z.input<typeof payoutSchema>,
): Promise<Awaited<ReturnType<typeof executeCashPayout>>> {
  const session = await requireFinance();
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
  const result = await withTaskTransaction(async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: payoutId }, include: { user: { select: { name: true } } } });
    if (!payout) return { ok: false, error: "Выплата не найдена" };
    await tx.payout.delete({ where: { id: payoutId } });
    await tx.changeLog.create({ data: { actorType: "user", actorId: session.user.id, actorName: session.user.name ?? undefined,
      entity: "payout", entityId: payoutId, action: "delete", oldValue: { user: payout.user.name,
        amount: payout.amount.toFixed(2), cashAmount: payout.cashAmount?.toFixed(2) ?? null,
        cashCurrency: payout.cashCurrency, month: payout.month } } });
    return { ok: true };
  });
  if (!result.ok) return result;
  revalidatePayroll();
  revalidatePath("/finance/accounts");
  revalidatePath("/advances");
  return { ok: true };
}

// ─── Начисление «% от оборота» за расчётный месяц (§10) ─────────────────────
// Запускает администратор при закрытии месяца. НАЧИСЛЯТЬ МОЖНО ТОЛЬКО ЗА
// ПРОШЛЫЙ МЕСЯЦ: в текущем месяце оборот ещё меняется, поэтому показываем
// приблизительную зарплату, но начисление заблокировано (правило владельца).
// Сумма начисления всегда сравнивается с ТЕКУЩИМ оборотом: вырос — создаётся
// доначисление разницы, снизился — не трогаем (переплату разбирает вручную).

export async function accrueTurnover(
  month: string,
): Promise<{ ok: boolean; error?: string; accruedCount?: number }> {
  const session = await requireFinance();
  if (!isValidMonth(month)) return { ok: false, error: "Некорректный месяц" };
  if (month >= currentMonth()) {
    return {
      ok: false,
      error: "Начислять можно только за прошлый месяц — текущий ещё не закрыт",
    };
  }

  const { total } = await getMonthTurnover(month);
  const currency = INTERNAL_CURRENCY;
  const users = await prisma.user.findMany({
    where: { active: true, payScheme: "PERCENT_TURNOVER", payPercent: { gt: 0 } },
    select: { id: true, name: true, payPercent: true },
  });
  if (users.length === 0) {
    return { ok: false, error: "Нет сотрудников со схемой «% от оборота»" };
  }

  const existing = await prisma.payrollEntry.findMany({
    where: { month, scheme: "PERCENT_TURNOVER", userId: { in: users.map((user) => user.id) } },
    select: { userId: true, amount: true, currency: true, bynAmount: true },
  });
  const accruedMap = new Map<string, Prisma.Decimal>();
  for (const row of existing) {
    const amount = historicalByn(row);
    if (amount === null) return { ok: false, error: BYN_UNAVAILABLE_REASON };
    accruedMap.set(row.userId, (accruedMap.get(row.userId) ?? new Prisma.Decimal(0)).plus(amount));
  }
  let accruedCount = 0;
  for (const user of users) {
    const percent = Number(user.payPercent);
    const expected = new Prisma.Decimal(total).mul(percent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const already = accruedMap.get(user.id) ?? new Prisma.Decimal(0);
    const diff = expected.minus(already).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
    if (diff <= 0) continue; // начислено актуально или больше расчётного
    const isTopUp = already.gt(0);
    await prisma.payrollEntry.create({
      data: {
        userId: user.id,
        projectId: null, // начисление на организацию целиком, не на проект
        amount: diff,
        bynAmount: diff,
        currency,
        scheme: "PERCENT_TURNOVER",
        month,
        comment: isTopUp
          ? `${percent}% от оборота за ${month} · доначисление (оборот ${formatAmount(total, currency)})`
          : `${percent}% от оборота за ${month} · оборот ${formatAmount(total, currency)}`,
      },
    });
    accruedCount += 1;
    await writeChangeLog({
      actorType: "user",
      actorId: session.user.id,
      actorName: session.user.name ?? undefined,
      entity: "payrollEntry",
      entityId: `${user.id}:${month}`,
      action: isTopUp ? "accrue-topup" : "accrue",
      newValue: { user: user.name, scheme: "PERCENT_TURNOVER", amount: diff, month },
    });
    await emitDomainEvent(
      "payroll.accrued",
      { userId: user.id, scheme: "PERCENT_TURNOVER", amount: diff, month },
      session.user.id,
    );
    await notifyPerson({
      userId: user.id,
      type: "payroll.accrued",
      title: `${isTopUp ? "Доначислена" : "Начислена"} зарплата: ${formatAmount(diff, currency)}`,
      body: `${percent}% от оборота за ${month}`,
      link: "/payroll",
    });
  }

  if (accruedCount > 0) {
    await notifyOrg({
      type: "payroll.orgAccrued",
      title: `Начислено % от оборота за ${month}: ${accruedCount} сотр.`,
      body: `Оборот ${formatAmount(total, currency)}`,
      link: "/finance/payroll",
      exceptUserId: session.user.id,
    });
  }

  revalidatePayroll();
  return { ok: true, accruedCount };
}

// ─── «Рассчитать всех» (§10): массовые выплаты по задолженности ─────────────
// Каждому сотруднику с долгом создаётся выплата min(долг, остаток баланса)
// с комментарием «Выплата зарплаты от <текущая дата>». Если баланса не
// хватает — в конце списка получат частично или будут пропущены.

export async function settleAll(
  month: string,
  cashAccountId?: string,
): Promise<{
  ok: boolean;
  error?: string;
  paidCount?: number;
  totalPaid?: number;
  shortPaid?: string[];
}> {
  const session = await requireFinance();
  if (!isValidMonth(month)) return { ok: false, error: "Некорректный месяц" };
  if (!cashAccountId) return { ok: false, error: "Выберите кассу для расчёта" };
  const account = (await listCashAccounts()).find((row) => row.id === cashAccountId && row.active);
  if (!account || !isCashCurrency(account.currency)) return { ok: false, error: "Активная касса не найдена" };
  const dues = await getEmployeeDues();
  if (dues.some((row) => row.due === null) || await getOrgBalance() === null) return { ok: false, error: BYN_UNAVAILABLE_REASON };
  const debtors = dues.filter((row): row is typeof row & { due: number } => row.due !== null && row.due > 0);
  if (debtors.length === 0) {
    return { ok: false, error: "Задолженности перед сотрудниками нет" };
  }
  const currency = await getPayrollCurrency();
  if (!isCashCurrency(currency)) return { ok: false, error: "Неизвестная валюта зарплаты" };
  const asOf = new Date().toISOString().slice(0, 10);
  const rateDate = new Date(`${asOf}T12:00:00.000Z`);
  const cashRateInfo = await getNbrbRate(account.currency, rateDate).catch(() => null);
  const payrollRateInfo = currency === account.currency ? cashRateInfo : await getNbrbRate(currency, rateDate).catch(() => null);
  if (!cashRateInfo || !payrollRateInfo) return { ok: false, error: "Не удалось получить курс НБ РБ" };
  const rates = { asOf, cash: { currency: account.currency, rate: parseCashRate(cashRateInfo.rate.toFixed(6), account.currency), date: cashRateInfo.date },
    payroll: { currency, rate: parseCashRate(payrollRateInfo.rate.toFixed(6), currency), date: payrollRateInfo.date } };
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, "0")}.${String(
    today.getMonth() + 1,
  ).padStart(2, "0")}.${today.getFullYear()}`;
  let paidCount = 0;
  let totalPaid = 0;
  const shortPaid: string[] = [];
  for (const debtor of debtors) {
    const [cashRows, orgAvailable, currentDues] = await Promise.all([listCashAccounts(), getOrgBalance(), getEmployeeDues()]);
    const cashAvailable = cashRows.find((row) => row.id === cashAccountId)?.balance ?? 0;
    const currentDue = currentDues.find((row) => row.userId === debtor.userId);
    if (orgAvailable === null || currentDue?.due === null) return { ok: false, error: BYN_UNAVAILABLE_REASON, paidCount, totalPaid, shortPaid };
    const due = currentDue?.due ?? 0;
    const payrollCap = new Prisma.Decimal(Math.min(due, orgAvailable));
    if (cashAvailable <= 0 || payrollCap.lte(0)) { shortPaid.push(debtor.name); continue; }
    const physicalCap = payrollCap.mul(rates.payroll.rate).div(rates.cash.rate)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    const amount = Prisma.Decimal.min(new Prisma.Decimal(cashAvailable), physicalCap);
    if (amount.lte(0)) { shortPaid.push(debtor.name); continue; }
    let cashAmount = amount.toFixed(2);
    while (new Prisma.Decimal(calculateCashPayout(cashAmount, rates).amount).gt(payrollCap)) {
      const reduced = new Prisma.Decimal(cashAmount).sub("0.01");
      if (reduced.lte(0)) break;
      cashAmount = reduced.toFixed(2);
    }
    const result = await executeCashPayout({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" },
      { kind: "SALARY", userId: debtor.userId, cashAccountId, cashAmount, expectedCashCurrency: account.currency,
        requestId: randomUUID(), month,
        comment: `Выплата зарплаты от ${dateStr}` });
    if (!result.ok || !result.payoutId) { shortPaid.push(debtor.name); continue; }
    const saved = await prisma.payout.findUnique({ where: { id: result.payoutId }, select: { amount: true } });
    if (!saved) { shortPaid.push(debtor.name); continue; }
    paidCount += 1;
    totalPaid = round2(totalPaid + Number(saved.amount));
    if (Number(saved.amount) < due) shortPaid.push(debtor.name);
  }
  revalidatePayroll();
  return { ok: true, paidCount, totalPaid, shortPaid };
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
      return current;
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось изменить валюту зарплаты" };
  }
  if (before === currency) return { ok: true };
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "orgSetting",
    entityId: "payrollCurrency",
    action: "update",
    field: "value",
    oldValue: before,
    newValue: currency,
  });

  revalidatePath("/settings/payroll");
  revalidatePayroll();
  return { ok: true };
}
