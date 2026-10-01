import type { PayScheme } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { historicalByn, sumHistoricalByn, subtractByn, sumByn, BYN_UNAVAILABLE_REASON } from "@/lib/history-byn";


// ─── Зарплата (§10): запросы для страниц «Моя зарплата» и «Финансы → Зарплата»

const MONTH_RE = /^\d{4}-\d{2}$/;

// Текущий расчётный месяц в формате YYYY-MM
export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function isValidMonth(month: string | undefined): month is string {
  return !!month && MONTH_RE.test(month);
}

// Границы расчётного месяца (локальное время сервера)
export function monthRange(month: string): { start: Date; end: Date } {
  const [year, num] = month.split("-").map(Number);
  return { start: new Date(year, num - 1, 1), end: new Date(year, num, 1) };
}

// Новые начисления используют BYN независимо от прежней настройки.
// Исторические строки сохраняют собственную валюту и фиксированный эквивалент.
export async function getPayrollCurrency(): Promise<string> {
  return "BYN";
}

async function aggregatePayroll(args: { where?: Prisma.PayrollEntryWhereInput; _sum: { amount: true } }) {
  const rows = await prisma.payrollEntry.findMany({ where: args.where, select: { amount: true, currency: true, bynAmount: true } });
  return { _sum: { amount: sumHistoricalByn(rows) } };
}
async function aggregatePayout(args: { where?: Prisma.PayoutWhereInput; _sum: { amount: true } }) {
  const rows = await prisma.payout.findMany({ where: args.where, select: { amount: true, payrollCurrency: true, bynAmount: true } });
  return { _sum: { amount: sumHistoricalByn(rows) } };
}
async function groupPayroll(args: { where?: Prisma.PayrollEntryWhereInput; by: string[]; _sum: { amount: true } }) {
  const rows = await prisma.payrollEntry.findMany({ where: args.where, select: { userId: true, amount: true, currency: true, bynAmount: true } });
  const ids = [...new Set(rows.map(row => row.userId))];
  return ids.map(userId => ({ userId, _sum: { amount: sumHistoricalByn(rows.filter(row => row.userId === userId)) } }));
}
async function groupPayout(args: { where?: Prisma.PayoutWhereInput; by: string[]; _sum: { amount: true } }) {
  const rows = await prisma.payout.findMany({ where: args.where, select: { userId: true, amount: true, payrollCurrency: true, bynAmount: true } });
  const ids = [...new Set(rows.map(row => row.userId))];
  return ids.map(userId => ({ userId, _sum: { amount: sumHistoricalByn(rows.filter(row => row.userId === userId)) } }));
}
export type PayrollEntryView = {
  id: string;
  amount: number;
  bynAmount: number | null;
  currency: string;
  scheme: string;
  comment: string | null;
  createdAt: string;
};

export type PayoutView = {
  id: string;
  userId?: string;
  userName?: string;
  amount: number;
  bynAmount: number | null;
  cashAmount?: string | null;
  cashCurrency?: string | null;
  cashAccountName?: string | null;
  payrollCurrency?: string | null;
  kind: string; // SALARY | ADVANCE
  comment: string | null;
  createdByName: string | null;
  createdAt: string;
};

// Расчётник сотрудника (§10): начисления и выплаты выбранного месяца +
// два главных числа: ДОЛГ к выплате сейчас (начислено за прошлые месяцы −
// все выплаты) и ПРИБЛИЗИТЕЛЬНАЯ зарплата текущего месяца (ещё не payable).
export async function getMyPayroll(userId: string, month: string) {
  const now = currentMonth();
  const [entries, payouts, monthAccrued, monthPaid, pastAccrued, curAccrued, totalPaid] =
    await Promise.all([
      prisma.payrollEntry.findMany({
        where: { userId, month },
        orderBy: { createdAt: "desc" },
      }),
      prisma.payout.findMany({
        where: { userId, month },
        include: { cashAccount: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      aggregatePayroll({
        where: { userId, month },
        _sum: { amount: true },
      }),
      aggregatePayout({ where: { userId, month }, _sum: { amount: true } }),
      // долг: начислено за месяцы до текущего − все выплаты
      aggregatePayroll({
        where: { userId, month: { lt: now } },
        _sum: { amount: true },
      }),
      // приблизительная зарплата: начислено за текущий месяц
      aggregatePayroll({
        where: { userId, month: now },
        _sum: { amount: true },
      }),
      aggregatePayout({ where: { userId }, _sum: { amount: true } }),
    ]);

  const creatorIds = [
    ...new Set(payouts.map((p) => p.createdById).filter((v): v is string => !!v)),
  ];
  const creators = await prisma.user.findMany({
    where: { id: { in: creatorIds } },
    select: { id: true, name: true },
  });
  const creatorNames = new Map(creators.map((u) => [u.id, u.name]));

  return {
    unavailableReason: BYN_UNAVAILABLE_REASON,
    accrued: monthAccrued._sum.amount,
    paid: monthPaid._sum.amount,
    debt:
      subtractByn(pastAccrued._sum.amount, totalPaid._sum.amount),
    estimate: curAccrued._sum.amount,
    entries: entries.map(
      (entry): PayrollEntryView => ({
        id: entry.id,
        amount: Number(entry.amount),
        bynAmount: historicalByn(entry)?.toNumber() ?? null,
        currency: entry.currency,
        scheme: entry.scheme,
        comment: entry.comment,
        createdAt: entry.createdAt.toISOString(),
      }),
    ),
    payouts: payouts.map(
      (payout): PayoutView => ({
        id: payout.id,
        amount: Number(payout.amount),
        bynAmount: historicalByn(payout)?.toNumber() ?? null,
        cashAmount: payout.cashAmount?.toFixed(2) ?? null,
        cashCurrency: payout.cashCurrency,
        cashAccountName: payout.cashAccount?.name ?? null,
        payrollCurrency: payout.payrollCurrency,
        kind: payout.kind,
        comment: payout.comment,
        createdByName: payout.createdById
          ? (creatorNames.get(payout.createdById) ?? "—")
          : "—",
        createdAt: payout.createdAt.toISOString(),
      }),
    ),
  };
}

export type PayrollSummaryRow = {
  userId: string;
  name: string;
  payScheme: PayScheme;
  payPercent: number | null;
  accrued: number | null; // начислено за просматриваемый месяц
  paid: number | null; // выплачено за просматриваемый месяц (зарплата + авансы)
  advance: number | null; // из «Выплачено» — сумма авансов за месяц
  due: number | null; // текущий долг: начислено за прошлые месяцы − все выплаты
};

// Сводка по сотрудникам за месяц (закрытие месяца, §10): все активные
// с расчётной схемой + все, у кого есть движения в этом месяце.
// «К выплате» — ТЕКУЩИЙ долг: начислено за прошлые месяцы − все выплаты
// (деньги платятся только за прошлый месяц — правило владельца).
export async function getPayrollSummary(month: string) {
  const now = currentMonth();
  const [accruedByUser, paidByUser, advanceByUser, schemeUsers, entryUsers, payoutUsers, payouts, pastAccrued, totalPaidByUser] =
    await Promise.all([
      groupPayroll({
        by: ["userId"],
        where: { month },
        _sum: { amount: true },
      }),
      groupPayout({
        by: ["userId"],
        where: { month },
        _sum: { amount: true },
      }),
      // авансы месяца — отдельной колонкой в сводке
      groupPayout({
        by: ["userId"],
        where: { month, kind: "ADVANCE" },
        _sum: { amount: true },
      }),
      prisma.user.findMany({
        where: { active: true, payScheme: { not: "NONE" } },
        select: { id: true, name: true, payScheme: true, payPercent: true },
        orderBy: { name: "asc" },
      }),
      prisma.payrollEntry.findMany({
        where: { month },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.payout.findMany({
        where: { month },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.payout.findMany({
        where: { month },
        include: { user: { select: { id: true, name: true } }, cashAccount: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      // для текущего долга: начислено за месяцы до текущего, выплаты — все
      groupPayroll({
        by: ["userId"],
        where: { month: { lt: now } },
        _sum: { amount: true },
      }),
      groupPayout({ by: ["userId"], _sum: { amount: true } }),
    ]);

  const pastAccruedMap = new Map(
    pastAccrued.map((row) => [row.userId, row._sum.amount]),
  );
  const totalPaidMap = new Map(
    totalPaidByUser.map((row) => [row.userId, row._sum.amount]),
  );
  const debtIds = [...new Set([...pastAccruedMap.keys(), ...totalPaidMap.keys()])]
    .filter((id) => subtractByn((pastAccruedMap.has(id) ? pastAccruedMap.get(id)! : 0), (totalPaidMap.has(id) ? totalPaidMap.get(id)! : 0)) !== 0);
  const ids = new Set<string>([
    ...schemeUsers.map((u) => u.id),
    ...entryUsers.map((u) => u.userId),
    ...payoutUsers.map((u) => u.userId),
    ...debtIds,
  ]);
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, payScheme: true, payPercent: true },
    orderBy: { name: "asc" },
  });

  const accruedMap = new Map(
    accruedByUser.map((row) => [row.userId, row._sum.amount]),
  );
  const paidMap = new Map(
    paidByUser.map((row) => [row.userId, row._sum.amount]),
  );
  const advanceMap = new Map(
    advanceByUser.map((row) => [row.userId, row._sum.amount]),
  );
  const rows: PayrollSummaryRow[] = users.map((user) => {
    const accrued = accruedMap.has(user.id) ? accruedMap.get(user.id)! : 0;
    const paid = paidMap.has(user.id) ? paidMap.get(user.id)! : 0;
    const debt = subtractByn((pastAccruedMap.has(user.id) ? pastAccruedMap.get(user.id)! : 0), (totalPaidMap.has(user.id) ? totalPaidMap.get(user.id)! : 0));
    return {
      userId: user.id,
      name: user.name,
      payScheme: user.payScheme,
      payPercent: user.payPercent ? Number(user.payPercent) : null,
      accrued,
      paid,
      advance: advanceMap.has(user.id) ? advanceMap.get(user.id)! : 0,
      due: debt, // текущий долг к выплате (за прошлые месяцы)
    };
  });

  const creatorIds = [
    ...new Set(payouts.map((p) => p.createdById).filter((v): v is string => !!v)),
  ];
  const creators = await prisma.user.findMany({
    where: { id: { in: creatorIds } },
    select: { id: true, name: true },
  });
  const creatorNames = new Map(creators.map((u) => [u.id, u.name]));

  return {
    rows,
    unavailableReason: BYN_UNAVAILABLE_REASON,
    totals: {
      accrued: sumByn(rows.map(row => row.accrued)),
      paid: sumByn(rows.map(row => row.paid)),
      advance: sumByn(rows.map(row => row.advance)),
      due: sumByn(rows.map(row => row.due)),
    },
    payouts: payouts.map(
      (payout): PayoutView => ({
        id: payout.id,
        userId: payout.userId,
        userName: payout.user.name,
        amount: Number(payout.amount),
        bynAmount: historicalByn(payout)?.toNumber() ?? null,
        cashAmount: payout.cashAmount?.toFixed(2) ?? null,
        cashCurrency: payout.cashCurrency,
        cashAccountName: payout.cashAccount?.name ?? null,
        payrollCurrency: payout.payrollCurrency,
        kind: payout.kind,
        comment: payout.comment,
        createdByName: payout.createdById
          ? (creatorNames.get(payout.createdById) ?? "—")
          : "—",
        createdAt: payout.createdAt.toISOString(),
      }),
    ),
  };
}

// Оборот организации за расчётный месяц (§10) — база для «% от оборота».
// Определение: сумма ПРИХОДОВ (платежей-INCOME) по проектам за месяц
// в валюте зарплаты. С фазы 5 (§11) платежи мультивалютны: каждый хранит
// BYN-эквивалент по курсу НБ РБ на момент внесения — суммируем его;
// внутренний итог всегда BYN, сохранённый курс не переоценивается.
export async function getMonthTurnover(
  month: string,
): Promise<{ total: number; paymentsCount: number; currency: string }> {
  const currency = await getPayrollCurrency();
  const { start, end } = monthRange(month);
  const agg = await prisma.payment.aggregate({
    where: { paidAt: { gte: start, lt: end }, direction: "INCOME" },
    _sum: { bynAmount: true },
    _count: { _all: true },
  });
  return {
    total: Number(agg._sum.bynAmount ?? 0),
    paymentsCount: agg._count._all,
    currency,
  };
}

// Схема NONE и деактивация не отменяют уже заработанную оплату.
// Проверки месяца, долга и прав выплаты остаются в существующем action.
export async function listPayrollUsers() {
  const owed = (await getEmployeeDues()).filter((row) => row.due === null || row.due > 0).map((row) => row.userId);
  const users = await prisma.user.findMany({
    where: { OR: [
      { active: true, payScheme: { not: "NONE" } },
      { active: true, payrollEntries: { some: { settlementShareId: { not: null } } } },
      { id: { in: owed } },
    ] },
    select: { id: true, name: true, position: true },
    orderBy: { name: "asc" },
  });
  return users;
}

// Приблизительная зарплата текущего месяца по сотрудникам (начислено
// за текущий месяц) — для предупреждения в диалоге аванса, что сумма
// превышает уже набежавшую оценку. Аванс выдаётся в пределах баланса
// организации, это мягкая подсказка, а не потолок.
export async function getCurrentMonthEstimates(): Promise<Record<string, number | null>> {
  const rows = await groupPayroll({
    by: ["userId"],
    where: { month: currentMonth() },
    _sum: { amount: true },
  });
  return Object.fromEntries(
    rows.map((row) => [row.userId, row._sum.amount]),
  );
}

// Округление до копеек — единая точка для всех расчётов зарплаты
export function round2(value: number): number {
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

// Баланс организации: приходы минус расходы минус выплаты зарплаты,
// за всё время. Физический потолок для выплат. С фазы 5 (§11) приходы
// и расходы — мультивалютные, суммируются по BYN-эквиваленту (курс НБ РБ
// сохранён в каждой операции); выплаты используют фиксированный BYN-снимок.
// Неизвестный исторический эквивалент делает зависимый баланс недоступным. Кассовые остатки — см. listCashAccounts (§11).
export async function getOrgBalance(): Promise<number | null> {
  const [income, expense, payouts] = await Promise.all([
    prisma.payment.aggregate({ where: { direction: "INCOME" }, _sum: { bynAmount: true } }),
    prisma.payment.aggregate({ where: { direction: "EXPENSE" }, _sum: { bynAmount: true } }),
    prisma.payout.findMany({ select: { amount: true, payrollCurrency: true, bynAmount: true } }),
  ]);
  const payments = new Prisma.Decimal(income._sum.bynAmount ?? 0).minus(expense._sum.bynAmount ?? 0).toNumber();
  return subtractByn(payments, sumHistoricalByn(payouts));
}

export type EmployeeDue = { userId: string; name: string; due: number | null };

// Задолженность перед сотрудниками: начислено за месяцы ДО ТЕКУЩЕГО минус
// все выплаты (правило владельца: деньги платятся только за прошлый месяц;
// начисления текущего месяца — приблизительная зарплата, к выплате недоступна).
// Потолок выплаты конкретному человеку.
export async function getEmployeeDues(): Promise<EmployeeDue[]> {
  const before = currentMonth();
  const [accrued, paid] = await Promise.all([
    groupPayroll({
      by: ["userId"],
      where: { month: { lt: before } },
      _sum: { amount: true },
    }),
    groupPayout({ by: ["userId"], _sum: { amount: true } }),
  ]);
  const accruedMap = new Map(
    accrued.map((row) => [row.userId, row._sum.amount]),
  );
  const paidMap = new Map(
    paid.map((row) => [row.userId, row._sum.amount]),
  );
  const ids = [...new Set([...accruedMap.keys(), ...paidMap.keys()])];
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return users
    .map((user) => ({
      userId: user.id,
      name: user.name,
      due: subtractByn(accruedMap.has(user.id) ? accruedMap.get(user.id)! : 0, paidMap.has(user.id) ? paidMap.get(user.id)! : 0),
    }))
    .filter((row) => row.due !== 0);
}

// Кому начисляется «% от оборота» за месяц: активные сотрудники
// со схемой PERCENT_TURNOVER и СУММА уже начисленного (записей может
// быть несколько: первичное начисление + доначисления при росте оборота).
export async function getTurnoverAccruals(month: string) {
  const users = await prisma.user.findMany({
    where: { active: true, payScheme: "PERCENT_TURNOVER", payPercent: { gt: 0 } },
    select: { id: true, name: true, payPercent: true },
    orderBy: { name: "asc" },
  });
  const existing = await groupPayroll({
    by: ["userId"],
    where: { month, scheme: "PERCENT_TURNOVER" },
    _sum: { amount: true },
  });
  const accruedMap = new Map(
    existing.map((row) => [row.userId, row._sum.amount]),
  );
  return users.map((user) => ({
    userId: user.id,
    name: user.name,
    percent: Number(user.payPercent),
    accruedAmount: accruedMap.get(user.id) ?? null,
    unavailable: accruedMap.has(user.id) && accruedMap.get(user.id) === null,
  }));
}
