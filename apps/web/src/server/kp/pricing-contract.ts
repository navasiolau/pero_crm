import { Prisma } from "@prisma/client";

export const PROPOSAL_CURRENCIES = ["BYN", "RUB", "USD", "EUR"] as const;
export type ProposalPricingCurrency = typeof PROPOSAL_CURRENCIES[number];
export type ProposalPricingRateSource = "NBRB" | "MANUAL";
export type ProposalFixedRate = { currency: ProposalPricingCurrency; value: Prisma.Decimal; date: string; source: ProposalPricingRateSource };
export type ProposalFixedRateInput = { currency: string; value: Prisma.Decimal.Value; date: string | Date; source: string };
export type ProposalPricingProjection = {
  rate: ProposalFixedRate;
  items: { id: string; quantity: number; initialPrice: Prisma.Decimal; expectedPrice: Prisma.Decimal }[];
  project: { currency: "BYN"; initialPrice: Prisma.Decimal; servicesTotal: Prisma.Decimal | null;
    delivery: Prisma.Decimal | null; unloading: Prisma.Decimal | null; installation: Prisma.Decimal | null; proposalRoundingAdjustment: Prisma.Decimal };
  source: { subtotal: Prisma.Decimal; services: Prisma.Decimal; base: Prisma.Decimal; discount: Prisma.Decimal; total: Prisma.Decimal };
};

export function proposalCurrency(value: unknown): ProposalPricingCurrency {
  const currency = value === "$" || value === undefined || value === null || value === "" ? "USD" : value === "₽" ? "RUB" : value === "€" ? "EUR" : value;
  if (typeof currency !== "string" || !(PROPOSAL_CURRENCIES as readonly string[]).includes(currency)) throw Error("Укажите поддерживаемую валюту КП");
  return currency as ProposalPricingCurrency;
}

export function proposalRateDate(value: string | Date): string {
  const date = value instanceof Date ? Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : "" : value;
  const parsed = new Date(date + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw Error("Укажите календарную дату курса КП");
  return date;
}

export function fixedProposalRate(input: ProposalFixedRateInput, currency: ProposalPricingCurrency): ProposalFixedRate {
  if (!input.currency || proposalCurrency(input.currency) !== currency) throw Error("Валюта КП изменилась — получите новый курс для выбранной валюты");
  let value: Prisma.Decimal;
  try { value = new Prisma.Decimal(input.value); } catch { throw Error("Курс КП должен быть положительным числом"); }
  if (!value.isFinite() || !value.gt(0) || value.decimalPlaces() > 10 || value.gte("10000000000") || currency === "BYN" && !value.eq(1)) throw Error("Курс КП не соответствует валюте или допустимому пределу");
  if (input.source !== "NBRB" && input.source !== "MANUAL") throw Error("Укажите источник курса КП");
  return { currency, value, date: proposalRateDate(input.date), source: input.source };
}
