import { Prisma } from "@prisma/client";
import { canAccrueOrdinarySalary } from "@/lib/compensation-policy";
import { historicalByn, BYN_UNAVAILABLE_REASON } from "@/lib/history-byn";
import { formatAmount } from "@/lib/format";
import { PAYROLL_MANAGE_ROLES } from "@/lib/roles";
import { isValidPayrollMonth, payrollMonth } from "@/lib/payroll-month";
import { requireActorRoles, type DomainActor } from "@/server/actor";
import type { TaskTransaction } from "@/server/tasks/transaction";
import { readMonthTurnoverSnapshot } from "./turnover-query";

export type TurnoverEarning = {
  userId: string; userName: string; percent: string; amount: string; isTopUp: boolean;
  payrollEntryId: string; eventId: string;
};
export type TurnoverAccrualResult = { ok: false; error: string } | {
  ok: true; accruedCount: number; month: string; currency: string; total: string; earnings: TurnoverEarning[];
};

export async function accrueTurnoverCore(actor: DomainActor, month: string, transaction: TaskTransaction): Promise<TurnoverAccrualResult> {
  requireActorRoles(actor, PAYROLL_MANAGE_ROLES);
  if (!isValidPayrollMonth(month)) return { ok: false, error: "Некорректный месяц" };
  if (month >= payrollMonth()) return { ok: false, error: "Начислять можно только за прошлый месяц — текущий ещё не закрыт" };
  return transaction(async (tx): Promise<TurnoverAccrualResult> => {
    const turnover = await readMonthTurnoverSnapshot(month, tx);
    if (!turnover.total.isFinite()) throw new Error("Некорректный оборот расчётного месяца");
    const candidates = await tx.user.findMany({
      where: { active: true, payScheme: "PERCENT_TURNOVER", payPercent: { gt: 0 } },
      select: { id: true, name: true, payPercent: true, roles: true },
    });
    const users = candidates.filter((user) => canAccrueOrdinarySalary(user.roles));
    if (!users.length) return { ok: false, error: "Нет сотрудников со схемой «% от оборота»" };
    const existing = await tx.payrollEntry.findMany({
      where: { month, scheme: "PERCENT_TURNOVER", userId: { in: users.map((user) => user.id) } },
      select: { userId: true, amount: true, currency: true, bynAmount: true },
    });
    const accrued = new Map<string, Prisma.Decimal>();
    for (const row of existing) {
      const amount = historicalByn(row);
      if (amount === null) return { ok: false, error: BYN_UNAVAILABLE_REASON };
      if (!amount.isFinite()) throw new Error("Некорректное ранее начисленное");
      accrued.set(row.userId, (accrued.get(row.userId) ?? new Prisma.Decimal(0)).plus(amount));
    }
    const earnings: TurnoverEarning[] = [];
    for (const user of users) {
      const percent = new Prisma.Decimal(user.payPercent ?? 0);
      if (!percent.isFinite() || percent.lte(0)) throw new Error("Некорректная ставка процента от оборота");
      const expected = turnover.total.mul(percent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const already = accrued.get(user.id) ?? new Prisma.Decimal(0);
      const delta = expected.minus(already).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (delta.lte(0)) continue;
      const isTopUp = already.gt(0), amount = delta.toFixed(2);
      const payroll = await tx.payrollEntry.create({ data: {
        userId: user.id, projectId: null, amount, bynAmount: amount, currency: turnover.currency,
        scheme: "PERCENT_TURNOVER", month,
        comment: isTopUp
          ? `${percent}% от оборота за ${month} · доначисление (оборот ${formatAmount(turnover.total.toFixed(2), turnover.currency)})`
          : `${percent}% от оборота за ${month} · оборот ${formatAmount(turnover.total.toFixed(2), turnover.currency)}`,
      } });
      await tx.changeLog.create({ data: {
        actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
        entity: "payrollEntry", entityId: payroll.id, action: isTopUp ? "accrue-topup" : "accrue",
        newValue: { user: user.name, scheme: "PERCENT_TURNOVER", amount: delta.toNumber(), month,
          basis: { start: turnover.start.toISOString(), end: turnover.end.toISOString(), currency: turnover.currency,
            totalByn: turnover.total.toFixed(2), paymentsCount: turnover.paymentsCount, percent: percent.toString(),
            priorByn: already.toFixed(2), expectedByn: expected.toFixed(2), deltaByn: amount } },
      } });
      const event = await tx.domainEvent.create({ data: {
        type: "payroll.accrued", actor: actor.id,
        payload: { userId: user.id, scheme: "PERCENT_TURNOVER", amount: delta.toNumber(), month, payrollEntryId: payroll.id },
      } });
      earnings.push({ userId: user.id, userName: user.name, percent: percent.toString(), amount, isTopUp, payrollEntryId: payroll.id, eventId: event.id });
    }
    return { ok: true, accruedCount: earnings.length, month, currency: turnover.currency, total: turnover.total.toFixed(2), earnings };
  });
}
