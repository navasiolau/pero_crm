import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { calculateCashPayout, type CashRates } from "@/lib/cash-ledger";
import { PAYROLL_MANAGE_ROLES } from "@/lib/roles";
import { requireActorRoles } from "@/server/actor";
import { issuePayoutCore, PayoutValidationError, readCashBalance, readOrgBalance, readPayoutDebt, type PayoutActor } from "./cash-core";
import { payoutVisibilityCommand } from "./payout-reversal";

export type BatchInput = { id: string; month: string; cashAccountId: string };
export type BatchDebtor = { userId: string; name: string };
const selectionSchema = z.object({ month: z.string(), cashAccountId: z.string(),
  paidIds: z.array(z.string()), totalPaid: z.string(), shortPaid: z.array(z.string()) }).strict();
type Selection = z.output<typeof selectionSchema>;

export async function readPayoutBatch(db: Pick<Prisma.TransactionClient, "payrollPayoutBatch">, actor: PayoutActor, input: BatchInput) {
  const row = await db.payrollPayoutBatch.findUnique({ where: { id: input.id },
    include: { payouts: { select: { id: true, deletedAt: true } } } });
  if (!row) return null;
  const result = selectionSchema.safeParse(row.selection);
  if (!row.closedAt || row.actorId !== actor.id || !result.success ||
      result.data.month !== input.month || result.data.cashAccountId !== input.cashAccountId) {
    throw new PayoutValidationError("Идентификатор расчёта уже использован");
  }
  if (row.payouts.length !== result.data.paidIds.length ||
      row.payouts.some(payout => payout.deletedAt || !result.data.paidIds.includes(payout.id))) {
    throw new PayoutValidationError("Состав ранее проведённого пакета выплат уже изменён");
  }
  return result.data;
}

export async function settlePayoutBatch(tx: Prisma.TransactionClient, actor: PayoutActor, input: BatchInput,
  debtors: readonly BatchDebtor[], rates: CashRates, comment: string,
) {
  requireActorRoles(actor, PAYROLL_MANAGE_ROLES);
  const existing = await readPayoutBatch(tx, actor, input);
  if (existing) return { result: existing, effects: [] as Awaited<ReturnType<typeof issuePayoutCore>>[] };
  const account = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId } });
  if (!account?.active || account.currency !== rates.cash.currency) {
    throw new PayoutValidationError("Активная касса не найдена");
  }
  const journalId = `payout-batch:${input.id}`;
  const effects: Awaited<ReturnType<typeof issuePayoutCore>>[] = [];
  const result: Selection = { month: input.month, cashAccountId: input.cashAccountId, paidIds: [], totalPaid: "0.00", shortPaid: [] };
  await tx.payrollPayoutBatch.create({ data: { id: input.id, actorId: actor.id, selection: result } });
  let totalPaid = new Prisma.Decimal(0);
  for (const debtor of debtors) {
    const due = await readPayoutDebt(tx, debtor.userId);
    const [cashBalance, orgBalance] = await Promise.all([readCashBalance(tx, account.id), readOrgBalance(tx, "1")]);
    const cap = Prisma.Decimal.min(due, orgBalance);
    const physicalCap = cap.mul(rates.payroll.rate).div(rates.cash.rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    const cash = Prisma.Decimal.min(cashBalance, physicalCap);
    if (!cash.gt(0)) { result.shortPaid.push(debtor.name); continue; }
    let cashAmount = cash.toFixed(2);
    if (new Prisma.Decimal(calculateCashPayout(cashAmount, rates).amount).gt(cap)) cashAmount = cash.minus("0.01").toFixed(2);
    if (new Prisma.Decimal(cashAmount).lte(0)) { result.shortPaid.push(debtor.name); continue; }
    let paid: Awaited<ReturnType<typeof issuePayoutCore>>;
    try {
      paid = await issuePayoutCore(actor, { kind: "SALARY", userId: debtor.userId, cashAccountId: account.id, cashAmount,
        expectedCashCurrency: rates.cash.currency, requestId: randomUUID(), month: input.month, comment }, rates, tx,
      { id: input.id, journalId });
    } catch (error) {
      if (!(error instanceof PayoutValidationError)) throw error;
      result.shortPaid.push(debtor.name);
      continue;
    }
    result.paidIds.push(paid.payoutId);
    totalPaid = totalPaid.plus(paid.amount);
    if (new Prisma.Decimal(paid.amount).lt(due)) result.shortPaid.push(debtor.name);
    effects.push(paid);
  }
  result.totalPaid = totalPaid.toFixed(2);
  if (result.paidIds.length) {
    const rows = await tx.payout.findMany({ where: { batchId: input.id }, orderBy: { id: "asc" } });
    if (rows.length !== result.paidIds.length) throw Error("Состав проведённых выплат изменился");
    await writeChangeLogInTransaction(tx, { id: journalId, entity: "payout", entityId: input.id, action: "issue",
      actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
      reversal: payoutVisibilityCommand(rows, false, undefined, input.id), newValue: result,
    }, { entity: { label: `Групповая выплата зарплаты за ${input.month}` }, contexts: [] });
  }
  await tx.payrollPayoutBatch.update({ where: { id: input.id }, data: { closedAt: new Date(), selection: result } });
  return { result, effects };
}
