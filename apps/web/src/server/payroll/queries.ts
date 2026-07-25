import type { PayScheme } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { convertFromByn } from "@/server/finance/nbrb";

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

// Единая валюта зарплаты (§10): настройка организации, по умолчанию BYN.
// Все начисления и расчётники показываются в ней.
export async function getPayrollCurrency(): Promise<string> {
  const row = await prisma.orgSetting.findUnique({
    where: { key: "payrollCurrency" },
  });
  return row?.value ?? "BYN";
}

export type PayrollEntryView = {
  id: string;
  amount: number;
  scheme: string;
  comment: string | null;
  createdAt: string;
};

export type PayoutView = {
  id: string;
  userId?: string;
  userName?: string;
  amount: number;
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
        orderBy: { createdAt: "desc" },
      }),
      prisma.payrollEntry.aggregate({
        where: { userId, month },
        _sum: { amount: true },
      }),
      prisma.payout.aggregate({ where: { userId, month }, _sum: { amount: true } }),
      // долг: начислено за месяцы до текущего − все выплаты
      prisma.payrollEntry.aggregate({
        where: { userId, month: { lt: now } },
        _sum: { amount: true },
      }),
      // приблизительная зарплата: начислено за текущий месяц
      prisma.payrollEntry.aggregate({
        where: { userId, month: now },
        _sum: { amount: true },
      }),
      prisma.payout.aggregate({ where: { userId }, _sum: { amount: true } }),
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
    accrued: Number(monthAccrued._sum.amount ?? 0),
    paid: Number(monthPaid._sum.amount ?? 0),
    debt:
      Number(pastAccrued._sum.amount ?? 0) - Number(totalPaid._sum.amount ?? 0),
    estimate: Number(curAccrued._sum.amount ?? 0),
    entries: entries.map(
      (entry): PayrollEntryView => ({
        id: entry.id,
        amount: Number(entry.amount),
        scheme: entry.scheme,
        comment: entry.comment,
        createdAt: entry.createdAt.toISOString(),
      }),
    ),
    payouts: payouts.map(
      (payout): PayoutView => ({
        id: payout.id,
        amount: Number(payout.amount),
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
  accrued: number; // начислено за просматриваемый месяц
  paid: number; // выплачено за просматриваемый месяц (зарплата + авансы)
  advance: number; // из «Выплачено» — сумма авансов за месяц
  due: number; // текущий долг: начислено за прошлые месяцы − все выплаты
};

// Сводка по сотрудникам за месяц (закрытие месяца, §10): все активные
// с расчётной схемой + все, у кого есть движения в этом месяце.
// «К выплате» — ТЕКУЩИЙ долг: начислено за прошлые месяцы − все выплаты
// (деньги платятся только за прошлый месяц — правило владельца).
export async function getPayrollSummary(month: string) {
  const now = currentMonth();
  const [accruedByUser, paidByUser, advanceByUser, schemeUsers, entryUsers, payoutUsers, payouts, pastAccrued, totalPaidByUser] =
    await Promise.all([
      prisma.payrollEntry.groupBy({
        by: ["userId"],
        where: { month },
        _sum: { amount: true },
      }),
      prisma.payout.groupBy({
        by: ["userId"],
        where: { month },
        _sum: { amount: true },
      }),
      // авансы месяца — отдельной колонкой в сводке
      prisma.payout.groupBy({
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
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      // для текущего долга: начислено за месяцы до текущего, выплаты — все
      prisma.payrollEntry.groupBy({
        by: ["userId"],
        where: { month: { lt: now } },
        _sum: { amount: true },
      }),
      prisma.payout.groupBy({ by: ["userId"], _sum: { amount: true } }),
    ]);

  const ids = new Set<string>([
    ...schemeUsers.map((u) => u.id),
    ...entryUsers.map((u) => u.userId),
    ...payoutUsers.map((u) => u.userId),
  ]);
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, payScheme: true, payPercent: true },
    orderBy: { name: "asc" },
  });

  const accruedMap = new Map(
    accruedByUser.map((row) => [row.userId, Number(row._sum.amount ?? 0)]),
  );
  const paidMap = new Map(
    paidByUser.map((row) => [row.userId, Number(row._sum.amount ?? 0)]),
  );
  const advanceMap = new Map(
    advanceByUser.map((row) => [row.userId, Number(row._sum.amount ?? 0)]),
  );
  const pastAccruedMap = new Map(
    pastAccrued.map((row) => [row.userId, Number(row._sum.amount ?? 0)]),
  );
  const totalPaidMap = new Map(
    totalPaidByUser.map((row) => [row.userId, Number(row._sum.amount ?? 0)]),
  );

  const rows: PayrollSummaryRow[] = users.map((user) => {
    const accrued = accruedMap.get(user.id) ?? 0;
    const paid = paidMap.get(user.id) ?? 0;
    const debt = round2(
      (pastAccruedMap.get(user.id) ?? 0) - (totalPaidMap.get(user.id) ?? 0),
    );
    return {
      userId: user.id,
      name: user.name,
      payScheme: user.payScheme,
      payPercent: user.payPercent ? Number(user.payPercent) : null,
      accrued,
      paid,
      advance: advanceMap.get(user.id) ?? 0,
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
    totals: {
      accrued: rows.reduce((sum, row) => sum + row.accrued, 0),
      paid: rows.reduce((sum, row) => sum + row.paid, 0),
      advance: rows.reduce((sum, row) => sum + row.advance, 0),
      due: rows.reduce((sum, row) => sum + row.due, 0),
    },
    payouts: payouts.map(
      (payout): PayoutView => ({
        id: payout.id,
        userId: payout.userId,
        userName: payout.user.name,
        amount: Number(payout.amount),
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
// при валюте ЗП ≠ BYN итог конвертируется по текущему курсу НБ РБ.
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
    total: await convertFromByn(Number(agg._sum.bynAmount ?? 0), currency),
    paymentsCount: agg._count._all,
    currency,
  };
}

// Сотрудники, которым считается зарплата (для диалога выплаты):
// активные, схема не «без расчёта».
export async function listPayrollUsers() {
  const users = await prisma.user.findMany({
    where: { active: true, payScheme: { not: "NONE" } },
    select: { id: true, name: true, position: true },
    orderBy: { name: "asc" },
  });
  return users;
}

// Приблизительная зарплата текущего месяца по сотрудникам (начислено
// за текущий месяц) — для предупреждения в диалоге аванса, что сумма
// превышает уже набежавшую оценку. Аванс выдаётся в пределах баланса
// организации, это мягкая подсказка, а не потолок.
export async function getCurrentMonthEstimates(): Promise<Record<string, number>> {
  const rows = await prisma.payrollEntry.groupBy({
    by: ["userId"],
    where: { month: currentMonth() },
    _sum: { amount: true },
  });
  return Object.fromEntries(
    rows.map((row) => [row.userId, Number(row._sum.amount ?? 0)]),
  );
}

// Округление до копеек — единая точка для всех расчётов зарплаты
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Баланс организации: приходы минус расходы минус выплаты зарплаты,
// за всё время. Физический потолок для выплат. С фазы 5 (§11) приходы
// и расходы — мультивалютные, суммируются по BYN-эквиваленту (курс НБ РБ
// сохранён в каждой операции); при валюте ЗП ≠ BYN итог конвертируется
// по текущему курсу. Кассовые остатки — см. listCashAccounts (§11).
export async function getOrgBalance(): Promise<number> {
  const currency = await getPayrollCurrency();
  const [income, expense, paid] = await Promise.all([
    prisma.payment.aggregate({
      where: { direction: "INCOME" },
      _sum: { bynAmount: true },
    }),
    prisma.payment.aggregate({
      where: { direction: "EXPENSE" },
      _sum: { bynAmount: true },
    }),
    prisma.payout.aggregate({ _sum: { amount: true } }),
  ]);
  const cashByn =
    Number(income._sum.bynAmount ?? 0) - Number(expense._sum.bynAmount ?? 0);
  const cash = await convertFromByn(cashByn, currency);
  return round2(cash - Number(paid._sum.amount ?? 0));
}

export type EmployeeDue = { userId: string; name: string; due: number };

// Задолженность перед сотрудниками: начислено за месяцы ДО ТЕКУЩЕГО минус
// все выплаты (правило владельца: деньги платятся только за прошлый месяц;
// начисления текущего месяца — приблизительная зарплата, к выплате недоступна).
// Потолок выплаты конкретному человеку.
export async function getEmployeeDues(): Promise<EmployeeDue[]> {
  const before = currentMonth();
  const [accrued, paid] = await Promise.all([
    prisma.payrollEntry.groupBy({
      by: ["userId"],
      where: { month: { lt: before } },
      _sum: { amount: true },
    }),
    prisma.payout.groupBy({ by: ["userId"], _sum: { amount: true } }),
  ]);
  const accruedMap = new Map(
    accrued.map((row) => [row.userId, Number(row._sum.amount ?? 0)]),
  );
  const paidMap = new Map(
    paid.map((row) => [row.userId, Number(row._sum.amount ?? 0)]),
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
      due: round2((accruedMap.get(user.id) ?? 0) - (paidMap.get(user.id) ?? 0)),
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
  const existing = await prisma.payrollEntry.groupBy({
    by: ["userId"],
    where: { month, scheme: "PERCENT_TURNOVER" },
    _sum: { amount: true },
  });
  const accruedMap = new Map(
    existing.map((row) => [row.userId, Number(row._sum.amount ?? 0)]),
  );
  return users.map((user) => ({
    userId: user.id,
    name: user.name,
    percent: Number(user.payPercent),
    accruedAmount: accruedMap.get(user.id) ?? null,
  }));
}
