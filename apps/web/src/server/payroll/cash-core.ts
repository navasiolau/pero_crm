import { createHash } from "node:crypto";
import { isValidPayrollMonth, payrollMonth } from "@/lib/payroll-month";
import {activePaymentWhere} from '@/server/payments/active-records';
import { Prisma } from "@prisma/client";
import { calculateCashPayout, cashMovementDelta, isCashCurrency, parseCashAmount, type CashCurrency, type CashRates } from "@/lib/cash-ledger";
import { requireHistoricalByn } from "@/lib/history-byn";
import { ADVANCE_ROLES, FINANCE_ROLES, hasAnyRole, type Role } from "@/lib/roles";

export type PayoutActor = { id: string; name: string; roles: Role[]; source: "web" | "telegram" | "api" };
export type CashPayoutInput = {
  kind: "ADVANCE" | "SALARY";
  userId: string;
  cashAccountId: string;
  cashAmount: string;
  expectedCashCurrency: CashCurrency;
  requestId: string;
  description?: string;
  comment?: string;
  month?: string;
};

function fail(message: string): never { throw new Error(message); }

export function assertPayoutRole(actor: PayoutActor, kind: CashPayoutInput["kind"]): void {
  if (kind !== "ADVANCE" && kind !== "SALARY") fail("Неизвестный тип выплаты");
  if (!hasAnyRole(actor.roles, kind === "ADVANCE" ? ADVANCE_ROLES : FINANCE_ROLES)) fail("Недостаточно прав");
}

function normalizedInput(actor: PayoutActor, input: CashPayoutInput, now: Date) {
  assertPayoutRole(actor, input.kind);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) fail("Некорректный идентификатор запроса");
  if (!input.userId || !input.cashAccountId) fail("Выберите сотрудника и кассу");
  if (!isCashCurrency(input.expectedCashCurrency)) fail("Неизвестная ожидаемая валюта кассы");
  const cashAmount = parseCashAmount(input.cashAmount);
  const description = input.description?.trim() ?? "";
  const comment = input.comment?.trim() ?? "";
  if (input.kind === "ADVANCE" && !description) fail("Укажите описание работы");
  if (input.kind === "SALARY" && !isValidPayrollMonth(input.month)) fail("Некорректный расчётный месяц");
  const month = input.kind === "ADVANCE" ? payrollMonth(now) : input.month!;
  const fingerprint = createHash("sha256").update(JSON.stringify({ actorId: actor.id, kind: input.kind, userId: input.userId,
    cashAccountId: input.cashAccountId, cashAmount, expectedCashCurrency: input.expectedCashCurrency,
    description, comment, month: input.kind === "SALARY" ? month : null })).digest("hex");
  return { cashAmount, description, comment, month, fingerprint };
}

export async function readCashBalance(tx: Prisma.TransactionClient, cashAccountId: string): Promise<Prisma.Decimal> {
  const [payments, payouts] = await Promise.all([
    tx.payment.groupBy({ by: ["direction"], where: { ...activePaymentWhere, cashAccountId }, _sum: { amount: true } }),
    tx.payout.aggregate({ where: { cashAccountId }, _sum: { cashAmount: true } }),
  ]);
  const paymentBalance = payments.reduce((sum, row) => sum.add(cashMovementDelta(row.direction,row._sum.amount ?? 0)), new Prisma.Decimal(0));
  return paymentBalance.add(cashMovementDelta("EXPENSE",payouts._sum.cashAmount ?? 0));
}

export async function readOrgBalance(tx: Prisma.TransactionClient, _payrollRate: string, paymentBynDelta = "0.00", newPayoutBynDelta = "0.00"): Promise<Prisma.Decimal> {
  const [income, expense, payouts] = await Promise.all([
    tx.payment.aggregate({ where: { ...activePaymentWhere, direction: "INCOME" }, _sum: { bynAmount: true } }),
    tx.payment.aggregate({ where: { ...activePaymentWhere, direction: "EXPENSE" }, _sum: { bynAmount: true } }),
    tx.payout.findMany({ select: { amount: true, payrollCurrency: true, bynAmount: true } }),
  ]);
  return new Prisma.Decimal(income._sum.bynAmount ?? 0).minus(expense._sum.bynAmount ?? 0)
    .plus(paymentBynDelta).minus(requireHistoricalByn(payouts)).minus(newPayoutBynDelta);
}

export async function issuePayoutCore(actor: PayoutActor, input: CashPayoutInput, rates: CashRates, tx: Prisma.TransactionClient) {
  const now = new Date();
  const normalized = normalizedInput(actor, input, now); // role/input validation before any DB read
  const receiptId = `payout-issue:${input.requestId}`;
  const receipt = await tx.changeLog.findUnique({ where: { id: receiptId } });
  if (receipt) {
    const saved = receipt.newValue;
    if (receipt.actorId !== actor.id || receipt.entity !== "payout" || receipt.action !== "issue" || !saved || typeof saved !== "object" || Array.isArray(saved)
      || saved.fingerprint !== normalized.fingerprint || typeof saved.payoutId !== "string") fail("Идентификатор запроса уже использован");
    const original = await tx.payout.findUnique({ where: { id: saved.payoutId } });
    if (!original) fail("Операция отменена");
    return { repeated: true as const, payoutId: original.id, amount: original.amount.toFixed(2),
      cashAmount: original.cashAmount?.toFixed(2) ?? normalized.cashAmount, currency: original.cashCurrency ?? rates.cash.currency,
      payrollCurrency: original.payrollCurrency ?? rates.payroll.currency,
      bynAmount: original.bynAmount === null ? null : new Prisma.Decimal(original.bynAmount).toFixed(2),
      userId: original.userId, month: original.month, eventId: null };
  }

  if (rates.asOf !== now.toISOString().slice(0, 10)) fail("Дата расчёта изменилась; обновите форму");

  const [user, account] = await Promise.all([
    tx.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true, active: true } }),
    tx.cashAccount.findUnique({ where: { id: input.cashAccountId }, select: { id: true, name: true, active: true, currency: true } }),
  ]);
  if (!user || (input.kind === "ADVANCE" && !user.active)) fail("Активный сотрудник не найден");
  if (!account?.active) fail("Активная касса не найдена");
  if (account.currency !== input.expectedCashCurrency || account.currency !== rates.cash.currency ||
    rates.payroll.currency !== "BYN") fail("Валюта или состояние кассы изменились; обновите форму");
  const quote = calculateCashPayout(normalized.cashAmount, rates);
  const [cashBalance, orgBalanceAfter] = await Promise.all([readCashBalance(tx, account.id), readOrgBalance(tx, quote.payrollRate, "0.00", quote.bynAmount)]);
  if (cashBalance.lt(quote.cashAmount)) fail("Недостаточно средств в выбранной кассе");
  if (orgBalanceAfter.lt(0)) fail("Недостаточно средств на балансе организации");
  if (input.kind === "SALARY") {
    const [accrued, paid] = await Promise.all([
      tx.payrollEntry.findMany({ where: { userId: user.id, month: { lt: payrollMonth(now) } }, select: { amount: true, currency: true, bynAmount: true } }),
      tx.payout.findMany({ where: { userId: user.id }, select: { amount: true, payrollCurrency: true, bynAmount: true } }),
    ]);
    const due = requireHistoricalByn(accrued).sub(requireHistoricalByn(paid));
    if (due.lte(0) || due.lt(quote.amount)) fail("Выплата превышает долг за прошлые месяцы");
  }
  const payout = await tx.payout.create({ data: {
    userId: user.id, amount: quote.amount, month: normalized.month, kind: input.kind,
    comment: input.kind === "ADVANCE" ? normalized.description : normalized.comment || null, createdById: actor.id,
    cashAccountId: account.id, cashAmount: quote.cashAmount, cashCurrency: quote.cashCurrency, bynAmount: quote.bynAmount,
    cashRate: quote.cashRate, payrollRate: quote.payrollRate, cashRateDate: new Date(`${quote.cashRateDate}T00:00:00.000Z`),
    payrollRateDate: new Date(`${quote.payrollRateDate}T00:00:00.000Z`), payrollCurrency: quote.payrollCurrency,
  } });
  await tx.changeLog.create({ data: { id: receiptId, actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "payout", entityId: payout.id, action: "issue", newValue: { payoutId: payout.id, fingerprint: normalized.fingerprint,
      userId: user.id, userName: user.name, kind: input.kind, cashAccountId: account.id, cashAmount: quote.cashAmount,
      cashCurrency: quote.cashCurrency, amount: quote.amount, payrollCurrency: quote.payrollCurrency, month: normalized.month } } });
  const event = await tx.domainEvent.create({ data: { type: "payroll.payout", actor: actor.id,
    payload: { payoutId: payout.id, userId: user.id, amount: Number(quote.amount), currency: quote.payrollCurrency,
      cashAmount: quote.cashAmount, cashCurrency: quote.cashCurrency, month: normalized.month, kind: input.kind } } });
  return { repeated: false as const, payoutId: payout.id, amount: quote.amount, cashAmount: quote.cashAmount, bynAmount: quote.bynAmount,
    currency: quote.cashCurrency, payrollCurrency: quote.payrollCurrency, userId: user.id, userName: user.name,
    month: normalized.month, eventId: event.id };
}
