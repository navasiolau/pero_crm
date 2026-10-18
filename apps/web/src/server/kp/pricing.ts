import { Prisma } from "@prisma/client";
import { getNbrbRate } from "../finance/nbrb";
import { fixedProposalRate, proposalCurrency, proposalRateDate, type ProposalFixedRate, type ProposalFixedRateInput, type ProposalPricingProjection } from "./pricing-contract";
import { readPrintedProposalMoney } from "./printed-source-pricing";

const Decimal = Prisma.Decimal.clone({ precision: 64, rounding: Prisma.Decimal.ROUND_HALF_UP });
const zero = () => new Decimal(0);
const cents = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const object = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw Error("Некорректные коммерческие данные КП");
  return value as Record<string, unknown>;
};
function money(value: Prisma.Decimal): Prisma.Decimal {
  const amount = cents(value);
  if (!amount.isFinite() || amount.abs().gt("9999999999.99")) throw Error("Сумма КП превышает допустимый предел CRM");
  return new Prisma.Decimal(amount.toString());
}

/** Проекция вычисляется до записи; состояние и ранее начисленные суммы не изменяются. */
export function projectProposalPricing(input: unknown, rateInput: ProposalFixedRateInput): ProposalPricingProjection {
  const state = object(input);
  const rate = fixedProposalRate(rateInput, proposalCurrency(state.currency));
  const fx = new Decimal(rate.value.toString());
  if (!Array.isArray(state.items)) throw Error("Укажите состав КП");
  const printed = readPrintedProposalMoney(state, state.items.map(object));
  const fromMinor = (minor: number) => new Decimal(String(minor)).dividedBy(100);
  const ids = new Set<string>();
  const items = printed.items.map(({ source: item, quantity, priceMinor }) => {
    if (typeof item.id !== "string" || !item.id.trim() || ids.has(item.id)) throw Error("У каждой позиции КП должен быть уникальный стабильный ID");
    ids.add(item.id);
    return { id: item.id, quantity, price: fromMinor(priceMinor) };
  });
  const groups = { DELIVERY: zero(), UNLOADING: zero(), INSTALLATION: zero() };
  const services = fromMinor(printed.serviceMinor);
  const { visible, itemMode } = printed;
  if (visible) {
    if (itemMode) {
      for (const { source: row, priceMinor } of printed.rows) {
        const kind = row.crmKind;
        if (kind !== "DELIVERY" && kind !== "UNLOADING" && kind !== "INSTALLATION") throw Error("Укажите явную категорию CRM для каждой услуги КП");
        groups[kind] = groups[kind].plus(fromMinor(priceMinor));
      }
    }
  }
  const subtotal = fromMinor(printed.subtotalMinor);
  const base = fromMinor(printed.baseMinor);
  const discount = fromMinor(printed.discountMinor);
  const total = fromMinor(printed.totalMinor);
  const factor = base.eq(0) ? zero() : total.dividedBy(base);
  const projectedItems = items.map(item => ({ id: item.id, quantity: item.quantity,
    initialPrice: money(item.price.times(fx)), expectedPrice: money(item.price.times(factor).times(fx)) }));
  const project = {
    currency: "BYN" as const, initialPrice: money(base.times(fx)),
    servicesTotal: visible && !itemMode ? money(services.times(factor).times(fx)) : null,
    delivery: visible && itemMode ? money(groups.DELIVERY.times(factor).times(fx)) : null,
    unloading: visible && itemMode ? money(groups.UNLOADING.times(factor).times(fx)) : null,
    installation: visible && itemMode ? money(groups.INSTALLATION.times(factor).times(fx)) : null,
    proposalRoundingAdjustment: new Prisma.Decimal(0),
  };
  const parts = projectedItems.reduce((sum, item) => sum.plus(new Decimal(item.expectedPrice.toString()).times(item.quantity)), zero())
    .plus(project.servicesTotal?.toString() ?? "0").plus(project.delivery?.toString() ?? "0").plus(project.unloading?.toString() ?? "0").plus(project.installation?.toString() ?? "0");
  project.proposalRoundingAdjustment = money(cents(total.times(fx)).minus(parts));
  return { rate, items: projectedItems, project, source: { subtotal, services, base, discount, total } };
}

type RateProvider = (currency: string, date: string) => Promise<{ rate: Prisma.Decimal.Value; date: string }>;
const nbrbProvider: RateProvider = (currency, date) => getNbrbRate(currency, new Date(date + "T00:00:00"));

/** Получение курса выполняется до общей транзакции сохранения КП. */
export async function resolveProposalRate(input: { currency: unknown; quoteDate: string; existing?: ProposalFixedRateInput; manual?: ProposalFixedRateInput }, provider: RateProvider = nbrbProvider): Promise<ProposalFixedRate> {
  const currency = proposalCurrency(input.currency);
  if (input.manual) {
    if (input.manual.source !== "MANUAL") throw Error("Ручной курс КП должен иметь источник MANUAL");
    return fixedProposalRate(input.manual, currency);
  }
  if (input.existing) return fixedProposalRate(input.existing, currency);
  const date = proposalRateDate(input.quoteDate);
  if (currency === "BYN") return fixedProposalRate({ currency, value: "1", date, source: "NBRB" }, currency);
  const fetched = await provider(currency, date);
  if (fetched.date !== date) throw Error("НБРБ вернул курс на другую дату КП");
  return fixedProposalRate({ currency, value: fetched.rate, date: fetched.date, source: "NBRB" }, currency);
}
