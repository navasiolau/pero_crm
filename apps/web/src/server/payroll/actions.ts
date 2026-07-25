"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { formatAmount } from "@/lib/format";
import { writeChangeLog } from "@/server/plugins/changelog";
import { emitDomainEvent } from "@/server/plugins/events";
import { notifyOrg, notifyPerson } from "@/server/notifications/notify";
import { requireAdmin, requireFinance } from "@/server/require-role";

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
  amount: z.number().positive("Сумма должна быть больше нуля"),
  month: z.string().regex(MONTH_RE, "Месяц в формате ГГГГ-ММ"),
  kind: z.enum(["SALARY", "ADVANCE"]).default("SALARY"),
  comment: z.string().optional(),
});

export async function addPayout(
  input: z.input<typeof payoutSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireFinance();
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;
  const isAdvance = data.kind === "ADVANCE";
  // Аванс — всегда текущим расчётным месяцем (начислений под него ещё нет)
  const month = isAdvance ? currentMonth() : data.month;
  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { id: true, name: true },
  });
  if (!user) return { ok: false, error: "Сотрудник не найден" };

  // Копейки: храним ровно два знака
  const amount = Math.round(data.amount * 100) / 100;
  const currency = await getPayrollCurrency();

  // Потолки выплаты: задолженность перед сотрудником (за всё время)
  // и баланс организации — больше физически выплатить нельзя.
  // Аванс долга не требует: единственный потолок — баланс организации.
  const balance = await getOrgBalance();
  if (!isAdvance) {
    const dues = await getEmployeeDues();
    const due = dues.find((row) => row.userId === data.userId)?.due ?? 0;
    if (due <= 0) {
      return {
        ok: false,
        error: "Долга за прошлые месяцы перед сотрудником нет — текущий месяц ещё не закрыт",
      };
    }
    if (amount > due) {
      return {
        ok: false,
        error: `Больше долга за прошлые месяцы — к выплате сейчас ${formatAmount(due, currency)}`,
      };
    }
  }
  if (amount > balance) {
    return {
      ok: false,
      error: `Недостаточно средств на балансе организации — доступно ${formatAmount(balance, currency)}`,
    };
  }
  const payout = await prisma.payout.create({
    data: {
      userId: data.userId,
      amount,
      month,
      kind: data.kind,
      comment: data.comment?.trim() || (isAdvance ? "Аванс" : null),
      createdById: session.user.id,
    },
  });

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "payout",
    entityId: payout.id,
    action: "create",
    newValue: { user: user.name, amount, month, kind: data.kind },
  });
  await emitDomainEvent(
    "payroll.payout",
    { payoutId: payout.id, userId: data.userId, amount, month, kind: data.kind },
    session.user.id,
  );
  await notifyPerson({
    userId: data.userId,
    type: "payroll.payout",
    title: isAdvance
      ? `Аванс: ${formatAmount(amount, currency)}`
      : `Выплата зарплаты: ${formatAmount(amount, currency)}`,
    body: data.comment?.trim() || `Расчётный месяц ${month}`,
    link: "/payroll",
  });
  // ЗП-событие для финансовых ролей (админ/директор/бухгалтер), кроме автора
  await notifyOrg({
    type: "payroll.orgPayout",
    title: `${isAdvance ? "Аванс" : "Выплата"}: ${user.name}, ${formatAmount(amount, currency)}`,
    body: data.comment?.trim() || `Расчётный месяц ${month}`,
    link: "/finance/payroll",
    exceptUserId: session.user.id,
  });

  revalidatePayroll();
  return { ok: true };
}

export async function deletePayout(
  payoutId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireFinance();
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    include: { user: { select: { name: true } } },
  });
  if (!payout) return { ok: false, error: "Выплата не найдена" };

  await prisma.payout.delete({ where: { id: payoutId } });
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "payout",
    entityId: payoutId,
    action: "delete",
    oldValue: {
      user: payout.user.name,
      amount: Number(payout.amount),
      month: payout.month,
    },
  });

  revalidatePayroll();
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

  const { total, currency } = await getMonthTurnover(month);
  const users = await prisma.user.findMany({
    where: { active: true, payScheme: "PERCENT_TURNOVER", payPercent: { gt: 0 } },
    select: { id: true, name: true, payPercent: true },
  });
  if (users.length === 0) {
    return { ok: false, error: "Нет сотрудников со схемой «% от оборота»" };
  }

  const existing = await prisma.payrollEntry.groupBy({
    by: ["userId"],
    where: { month, scheme: "PERCENT_TURNOVER" },
    _sum: { amount: true },
  });
  const accruedMap = new Map(
    existing.map((row) => [row.userId, Number(row._sum.amount ?? 0)]),
  );

  let accruedCount = 0;
  for (const user of users) {
    const percent = Number(user.payPercent);
    const expected = round2((total * percent) / 100);
    const already = round2(accruedMap.get(user.id) ?? 0);
    const diff = round2(expected - already);
    if (diff <= 0) continue; // начислено актуально или больше расчётного
    const isTopUp = already > 0;
    await prisma.payrollEntry.create({
      data: {
        userId: user.id,
        projectId: null, // начисление на организацию целиком, не на проект
        amount: diff,
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
): Promise<{
  ok: boolean;
  error?: string;
  paidCount?: number;
  totalPaid?: number;
  shortPaid?: string[];
}> {
  const session = await requireFinance();
  if (!isValidMonth(month)) return { ok: false, error: "Некорректный месяц" };

  const balance = await getOrgBalance();
  if (balance <= 0) {
    return { ok: false, error: "Баланс организации пуст — сначала внесите приходы" };
  }
  const debtors = (await getEmployeeDues()).filter((row) => row.due > 0);
  if (debtors.length === 0) {
    return { ok: false, error: "Задолженности перед сотрудниками нет" };
  }

  const currency = await getPayrollCurrency();
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, "0")}.${String(
    today.getMonth() + 1,
  ).padStart(2, "0")}.${today.getFullYear()}`;

  let remaining = balance;
  let paidCount = 0;
  let totalPaid = 0;
  const shortPaid: string[] = [];

  for (const debtor of debtors) {
    if (remaining <= 0) {
      shortPaid.push(debtor.name);
      continue;
    }
    const amount = round2(Math.min(debtor.due, remaining));
    if (amount <= 0) {
      shortPaid.push(debtor.name);
      continue;
    }
    const payout = await prisma.payout.create({
      data: {
        userId: debtor.userId,
        amount,
        month,
        comment: `Выплата зарплаты от ${dateStr}`,
        createdById: session.user.id,
      },
    });
    remaining = round2(remaining - amount);
    paidCount += 1;
    totalPaid = round2(totalPaid + amount);
    if (amount < debtor.due) shortPaid.push(debtor.name);

    await writeChangeLog({
      actorType: "user",
      actorId: session.user.id,
      actorName: session.user.name ?? undefined,
      entity: "payout",
      entityId: payout.id,
      action: "create",
      newValue: { user: debtor.name, amount, month, batch: true },
    });
    await emitDomainEvent(
      "payroll.payout",
      { payoutId: payout.id, userId: debtor.userId, amount, month },
      session.user.id,
    );
    await notifyPerson({
      userId: debtor.userId,
      type: "payroll.payout",
      title: `Выплата зарплаты: ${formatAmount(amount, currency)}`,
      body: `Выплата зарплаты от ${dateStr}`,
      link: "/payroll",
    });
  }

  if (paidCount > 0) {
    await notifyOrg({
      type: "payroll.orgPayout",
      title: `Рассчитать всех: выплачено ${formatAmount(totalPaid, currency)} (${paidCount} сотр.)`,
      body: `Выплата зарплаты от ${dateStr}`,
      link: "/finance/payroll",
      exceptUserId: session.user.id,
    });
  }

  revalidatePayroll();
  return { ok: true, paidCount, totalPaid, shortPaid };
}

// ─── Валюта зарплаты (§10): единая, задаётся администратором ────────────────

const CURRENCIES = ["BYN", "RUB", "USD", "EUR"] as const;

export async function setPayrollCurrency(
  currency: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  if (!(CURRENCIES as readonly string[]).includes(currency)) {
    return { ok: false, error: "Неизвестная валюта" };
  }
  const before = await getPayrollCurrency();
  if (before === currency) return { ok: true };

  await prisma.orgSetting.upsert({
    where: { key: "payrollCurrency" },
    update: { value: currency },
    create: { key: "payrollCurrency", value: currency },
  });
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
