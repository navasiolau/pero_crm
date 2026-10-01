import type { StageCurrency } from "@/lib/product-stage-pay";
import { getNbrbRate, isCurrency, type NbrbRate } from "@/server/finance/nbrb";

export interface StageRateSnapshot { currency: StageCurrency; rate: string; date: string }
export interface StageRateQuote {
  asOf: string;
  product: StageRateSnapshot;
  payroll: StageRateSnapshot;
}
export type StageRateReader = (currency: string, date?: Date) => Promise<NbrbRate>;

function dayOf(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error("Некорректная дата расчёта");
  return now.toISOString().slice(0, 10);
}

function assertRateDate(date: string, asOf: string): void {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Некорректная дата курса");
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > asOf)
    throw new Error("Некорректная дата курса");
}

function assertRate(snapshot: StageRateSnapshot, asOf: string): void {
  if (!isCurrency(snapshot.currency)) throw new Error("Неизвестная валюта расчёта");
  if (typeof snapshot.rate !== "string" || !/^\d{1,12}\.\d{6}$/.test(snapshot.rate) ||
    BigInt(snapshot.rate.replace(".", "")) <= BigInt(0) ||
    (snapshot.currency === "BYN" && snapshot.rate !== "1.000000")) throw new Error("Некорректный курс для начисления");
  assertRateDate(snapshot.date, asOf);
}

export async function resolveStageRates(
  productCurrency: string, payrollCurrency: string, now: Date,
  readRate: StageRateReader = getNbrbRate,
): Promise<StageRateQuote> {
  if (!isCurrency(productCurrency) || !isCurrency(payrollCurrency)) throw new Error("Неизвестная валюта расчёта");
  const asOf = dayOf(now);
  const rates = new Map<StageCurrency, StageRateSnapshot>();
  await Promise.all([...new Set([productCurrency, payrollCurrency])].map(async (currency) => {
    if (currency === "BYN") {
      rates.set(currency, { currency, rate: "1.000000", date: asOf });
      return;
    }
    let value: NbrbRate;
    try { value = await readRate(currency, new Date(`${asOf}T12:00:00.000Z`)); }
    catch (cause) { throw new Error(`Не удалось получить курс ${currency}. Обновите расчёт позже`, { cause }); }
    // Provider уже округляет курс до 6 знаков. Не исправляем неверный ответ
    // округлением/подстановкой, а отклоняем весь расчёт до транзакции.
    if (!value || typeof value.rate !== "number" || !Number.isFinite(value.rate) || value.rate <= 0 ||
      !/^\d{1,12}(?:\.\d{1,6})?$/.test(String(value.rate))) throw new Error("Некорректный курс для начисления");
    const snapshot = { currency, rate: value.rate.toFixed(6), date: value.date };
    assertRate(snapshot, asOf);
    rates.set(currency, snapshot);
  }));
  return { asOf, product: { ...rates.get(productCurrency)! }, payroll: { ...rates.get(payrollCurrency)! } };
}

export function assertStageQuoteCurrent(quote: StageRateQuote, productCurrency: string, payrollCurrency: string, now: Date): void {
  if (quote.asOf !== dayOf(now)) throw new Error("Дата расчёта изменилась. Обновите предварительную сумму");
  if (quote.product.currency !== productCurrency || quote.payroll.currency !== payrollCurrency)
    throw new Error("Валюта изменилась. Обновите предварительную сумму");
  assertRate(quote.product, quote.asOf);
  assertRate(quote.payroll, quote.asOf);
  if (productCurrency === payrollCurrency && (quote.product.rate !== quote.payroll.rate || quote.product.date !== quote.payroll.date))
    throw new Error("Для одной валюты нужен согласованный курс");
}
