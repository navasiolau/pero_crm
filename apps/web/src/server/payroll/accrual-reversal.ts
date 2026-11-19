import { createHash } from "node:crypto";
import { Prisma, type PayrollEntry } from "@prisma/client";
import { z } from "zod";
import { historicalByn } from "@/lib/history-byn";
import { payrollMonth } from "@/lib/payroll-month";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { activePayoutWhere } from "./active-records";
import { readPayoutDebt } from "./cash-core";

const schema = z.object({
  entityId: z.string(),
  sources: z.array(z.object({ id: z.string(), fingerprint: z.string().length(64) }).strict()).min(1),
  revision: z.number().int().nonnegative(),
}).strict();
type Command = z.output<typeof schema>;

function fingerprint(row: PayrollEntry) {
  return createHash("sha256").update(JSON.stringify(row)).digest("hex");
}

export function payrollCompensationCommand(entityId: string, rows: readonly PayrollEntry[]) {
  return payrollAccrualReversal.command({ entityId, revision: 0, sources: rows.map(row => ({ id: row.id, fingerprint: fingerprint(row) })) });
}

async function checkDependencies(tx: Prisma.TransactionClient, source: PayrollEntry) {
  let later = false;
  if (source.percentageCompletionShareId) {
    later = Boolean(await tx.productPercentageAdjustment.count({ where: { completionShareId: source.percentageCompletionShareId } }));
  }
  if (source.percentageAdjustmentId) {
    const adjustment = await tx.productPercentageAdjustment.findUniqueOrThrow({ where: { id: source.percentageAdjustmentId } });
    later = Boolean(await tx.productPercentageAdjustment.count({ where: { completionShareId: adjustment.completionShareId,
      configRevision: { gt: adjustment.configRevision } } }));
  }
  if (source.scheme === "PERCENT_TURNOVER") {
    later = Boolean(await tx.payrollEntry.count({ where: { compensatesId: null, scheme: source.scheme, month: source.month,
      userId: source.userId, id: { not: source.id }, createdAt: { gte: source.createdAt } } }));
  }
  if (later) throw new JournalReversalRefusal("После начисления проведён зависимый перерасчёт. Сначала проверьте его в Журнале.",
    source.productId ? `/products/${encodeURIComponent(source.productId)}` : "/finance/payroll");
}

async function prepare(tx: Prisma.TransactionClient, entityId: string, command: Command) {
  if (command.entityId !== entityId) throw new JournalReversalRefusal("Начисление не соответствует записи Журнала");
  const ids = command.sources.map(row => row.id);
  const rows = await tx.payrollEntry.findMany({ where: { id: { in: ids }, compensatesId: null },
    include: { _count: { select: { compensations: true } } } });
  if (rows.length !== ids.length) throw new JournalReversalRefusal("Состав начислений изменился");
  const byId = new Map(rows.map(({ _count, ...row }) => [row.id, { row, count: _count.compensations }]));
  const pastPeriodDeltas = new Map<string, Prisma.Decimal>();
  const multiplier = command.revision % 2 === 0 ? -1 : 1;
  for (const source of command.sources) {
    const stored = byId.get(source.id);
    if (!stored || stored.count !== command.revision || fingerprint(stored.row) !== source.fingerprint) {
      throw new JournalReversalRefusal("Начисление уже изменено. Проверьте связанные операции в Журнале.");
    }
    const row = stored.row;
    const amount = historicalByn(row);
    if (!amount?.isFinite()) throw new JournalReversalRefusal("Историческая сумма начисления в BYN недоступна");
    await checkDependencies(tx, row);
    if (row.month < payrollMonth()) {
      pastPeriodDeltas.set(row.userId, (pastPeriodDeltas.get(row.userId) ?? new Prisma.Decimal(0)).plus(amount.times(multiplier)));
    }
  }
  for (const [userId, delta] of pastPeriodDeltas) {
    if (delta.lt(0) && await tx.payout.count({ where: { ...activePayoutWhere, userId, kind: "SALARY" } }) &&
      (await readPayoutDebt(tx, userId)).add(delta).lt(0)) {
      throw new JournalReversalRefusal("Корректировка оставит недостаточный долг для уже проведённой выплаты зарплаты", "/finance/payroll");
    }
  }
  return { multiplier, sources: [...byId.values()].map(item => item.row) };
}

export const payrollAccrualReversal = defineJournalReversal({
  kind: "payroll.accrual", version: 1, schema,
  async preview({ tx, entityId }, command) {
    await prepare(tx, entityId, command);
    return null;
  },
  async apply({ tx, entityId, reversalId }, command) {
    if (!reversalId) throw new JournalReversalRefusal("Активная запись Журнала не найдена");
    const { sources, multiplier } = await prepare(tx, entityId, command);
    await tx.payrollEntry.createMany({ data: sources.map(row => ({
      compensatesId: row.id, compensationActionId: reversalId, compensationRevision: command.revision + 1,
      userId: row.userId, taskId: row.taskId, workId: row.workId, productId: row.productId, projectId: row.projectId,
      scheme: row.scheme, currency: row.currency, month: row.month, projectCurrency: row.projectCurrency,
      amount: row.amount.times(multiplier), bynAmount: row.bynAmount?.times(multiplier), projectAmount: row.projectAmount?.times(multiplier),
      comment: multiplier < 0 ? `Отмена начисления · ${row.comment ?? row.id}` : `Восстановление начисления · ${row.comment ?? row.id}`,
    })) });
    const cachePaths = new Set(["/finance/payroll", "/payroll", "/finance/projects"]);
    for (const row of sources) {
      if (row.projectId) cachePaths.add(`/finance/projects/${encodeURIComponent(row.projectId)}`);
      if (row.productId) cachePaths.add(`/products/${encodeURIComponent(row.productId)}`);
    }
    return { inverse: { ...command, revision: command.revision + 1 },
      oldValue: { revision: command.revision },
      newValue: { revision: command.revision + 1, amounts: sources.map(row => ({
        sourceId: row.id, amount: row.amount.times(multiplier).toFixed(2), currency: row.currency, month: row.month,
      })) }, cachePaths: [...cachePaths] };
  },
});
