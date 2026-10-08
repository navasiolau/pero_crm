import { Prisma } from "@prisma/client";

export type CashCurrency = "BYN" | "RUB" | "USD" | "EUR";
export type CashRate = { currency: CashCurrency; rate: string; date: string };
export type CashRates = { asOf: string; cash: CashRate; payroll: CashRate };

const MONEY_MAX = new Prisma.Decimal("9999999999.99"); // DECIMAL(12,2)
const BYN_MAX = new Prisma.Decimal("9999999999999999.99"); // DECIMAL(18,2)
const RATE_MAX = new Prisma.Decimal("99999999.999999"); // DECIMAL(14,6)
const MONEY_RE = /^\d+(?:\.\d{1,2})?$/;
const RATE_RE = /^\d+(?:\.\d{1,6})?$/;
const CURRENCIES: readonly string[] = ["BYN", "RUB", "USD", "EUR"];

export function isCashCurrency(value: string): value is CashCurrency {
  return CURRENCIES.includes(value);
}

/** Common physical ledger sign. Snapshots are never revalued here. */
export function cashMovementDelta(direction:"INCOME"|"EXPENSE",amount:Prisma.Decimal.Value):Prisma.Decimal {
 const value=new Prisma.Decimal(amount);
 return direction==="INCOME"?value:value.negated();
}

function money(value: string, positive = false): Prisma.Decimal {
  if (typeof value !== "string" || value.length > 32 || !MONEY_RE.test(value)) throw new Error("Некорректная сумма");
  const result = new Prisma.Decimal(value);
  if (!result.isFinite() || result.gt(MONEY_MAX) || (positive && result.lte(0))) throw new Error("Сумма вне допустимого предела");
  return result;
}

export function parseCashAmount(value: string): string {
  return money(value, true).toFixed(2);
}

export function parseCashRate(value: string, currency: CashCurrency): string {
  if (typeof value !== "string" || value.length > 32 || !RATE_RE.test(value)) throw new Error("Некорректный курс");
  const rate = new Prisma.Decimal(value);
  if (!rate.isFinite() || rate.lte(0) || rate.gt(RATE_MAX) || (currency === "BYN" && !rate.eq(1))) throw new Error("Некорректный курс");
  return rate.toFixed(6);
}

function roundedMoney(value: Prisma.Decimal, maximum = MONEY_MAX): string {
  const rounded = value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (!rounded.isFinite() || rounded.abs().gt(maximum)) throw new Error("Сумма вне допустимого предела");
  return rounded.toFixed(2);
}

function assertCalendarDate(value: string, asOf: string): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Некорректная дата курса");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value > asOf)
    throw new Error("Некорректная дата курса");
}

export function calculateCashPayout(cashAmount: string, rates: CashRates) {
  if (!isCashCurrency(rates.cash.currency) || !isCashCurrency(rates.payroll.currency)) throw new Error("Неизвестная валюта");
  assertCalendarDate(rates.asOf, new Date().toISOString().slice(0, 10));
  const physical = parseCashAmount(cashAmount);
  const cashRate = parseCashRate(rates.cash.rate, rates.cash.currency);
  const payrollRate = parseCashRate(rates.payroll.rate, rates.payroll.currency);
  if (rates.cash.currency === rates.payroll.currency && (cashRate !== payrollRate || rates.cash.date !== rates.payroll.date))
    throw new Error("Для одной валюты нужны согласованные курс и дата");
  assertCalendarDate(rates.cash.date, rates.asOf);
  assertCalendarDate(rates.payroll.date, rates.asOf);
  const exactByn = new Prisma.Decimal(physical).mul(cashRate);
  const bynAmount = roundedMoney(exactByn, BYN_MAX);
  const amount = roundedMoney(exactByn.div(payrollRate));
  if (new Prisma.Decimal(amount).lte(0)) throw new Error("Эквивалент выплаты должен быть положительным");
  return { cashAmount: physical, cashCurrency: rates.cash.currency, cashRate, cashRateDate: rates.cash.date,
    payrollCurrency: rates.payroll.currency, payrollRate, payrollRateDate: rates.payroll.date, bynAmount, amount };
}

export function calculateExactOrgBalance(paymentByn: string, newPayoutByn: string, legacyPaid: string, currentPayrollRate: string): Prisma.Decimal {
  const rate = new Prisma.Decimal(currentPayrollRate);
  if (!rate.isFinite() || rate.lte(0)) throw new Error("Некорректный курс баланса");
  return new Prisma.Decimal(paymentByn).sub(newPayoutByn).div(rate).sub(legacyPaid);
}

export function calculateOrgBalance(paymentByn: string, newPayoutByn: string, legacyPaid: string, currentPayrollRate: string): string {
  return roundedMoney(calculateExactOrgBalance(paymentByn, newPayoutByn, legacyPaid, currentPayrollRate), BYN_MAX);
}
