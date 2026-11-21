import { Prisma } from "@prisma/client";

import { CALENDAR_TIMEZONE } from "@/lib/calendar-dates";
import { CURRENCY_SYMBOLS } from "@/lib/format";
import { expenseSortFields, isExpenseIsoDate } from "@/lib/organization-expense-filters";
import { parseListFilterValue } from "@/lib/list-filter-values";
import { normalizeListQuery } from "@/lib/list-state";
import { activePaymentWhere } from "@/server/payments/active-records";
import { activeStockMovementWhere } from "@/server/warehouse/active-records";
import { isCurrency } from "./nbrb";

const baseWhere = { ...activePaymentWhere, direction: "EXPENSE" } satisfies Prisma.PaymentWhereInput;
export const expenseBaseWhere: Prisma.PaymentWhereInput = baseWhere;

type SortField = (typeof expenseSortFields)[number];
const sorts: Record<SortField, (direction: Prisma.SortOrder) => Prisma.PaymentOrderByWithRelationInput> = {
  id: dir => ({ id: dir }),
  date: dir => ({ paidAt: dir }),
  cash: dir => ({ cashAccount: { name: dir } }),
  article: dir => ({ expenseArticle: { name: dir } }),
  amount: dir => ({ amount: dir }),
  byn: dir => ({ bynAmount: dir }),
};

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function contains(value: string) {
  return { contains: escapeLike(value), mode: "insensitive" as const };
}

function bounds(params: URLSearchParams, field: string) {
  return [params.get(field + "From") ?? undefined, params.get(field + "To") ?? undefined] as const;
}

function moneyRange(params: URLSearchParams, field: string) {
  const [gte, lte] = bounds(params, field);
  return gte || lte ? { gte, lte } : undefined;
}

const dayMs = 86_400_000;
const moscowOffset = new Intl.DateTimeFormat("en-GB", { timeZone: CALENDAR_TIMEZONE, timeZoneName: "longOffset" });

function moscowMidnight(iso: string) {
  const utcMidnight = Date.parse(iso + "T00:00:00Z");
  // Смещение до полуночи московской даты, в том числе в дни исторических переводов часов.
  const offset = moscowOffset.formatToParts(utcMidnight - dayMs / 2).find(part => part.type === "timeZoneName")?.value;
  const match = offset?.match(/^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return new Date(utcMidnight);
  const [, sign, hours, minutes, seconds = "0"] = match;
  const offsetMs = (Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds)) * 1_000;
  return new Date(utcMidnight + (sign === "+" ? -offsetMs : offsetMs));
}

function dateRange(from?: string, to?: string) {
  if (!from && !to) return undefined;
  const next = to ? new Date(Date.parse(to + "T00:00:00Z") + dayMs).toISOString().split("T")[0] : undefined;
  return { gte: from ? moscowMidnight(from) : undefined, lt: next ? moscowMidnight(next) : undefined };
}

// Порядок источников соответствует paymentView и reportDocumentFiles.
function matchingDocument(name?: string): Prisma.PaymentWhereInput {
  const fileName = name ? contains(name) : undefined;
  return { OR: [
    { logisticsAllocation: { posting: { documents: { some: { document: { state: "READY", hiddenAt: null, fileName } } } } } },
    { logisticsAllocationId: null, reportDocuments: { some: { document: { state: "READY", fileName } } } },
    { logisticsAllocationId: null, reportDocuments: { none: {} }, reportDocument: { state: "READY", fileName } },
  ] };
}

function purpose(value: string): Prisma.PaymentWhereInput {
  if (value === "@stock") return { projectId: null, OR: [
    { stockPurchase: { isNot: null } }, { expenseReceipts: { some: { cancelledAt: null } } },
  ] };
  if (value === "@general") return {
    projectId: null, stockPurchase: { is: null }, expenseReceipts: { none: { cancelledAt: null } },
  };
  if (value === "@logistics") return { logisticsAllocationId: { not: null } };
  return { projectId: value };
}

function article(value: string): Prisma.PaymentWhereInput {
  if (value === "@logistics") return { logisticsAllocationId: { not: null } };
  return { logisticsAllocationId: null, expenseArticleId: value === "@none" ? null : value };
}

const choicePredicates = {
  purpose,
  article,
  cash: (value: string) => ({ cashAccountId: value === "@none" ? null : value }),
  currency: (value: string) => ({ currency: value }),
  documentPresence: (value: string) => value === "yes" ? matchingDocument() : { NOT: matchingDocument() },
} satisfies Record<string, (value: string) => Prisma.PaymentWhereInput>;

type StockFields = {
  movementId?: ReturnType<typeof contains>;
  unitPrice?: string | ReturnType<typeof moneyRange>;
  movement?: Prisma.StockMovementWhereInput;
};
type StockMatch = StockFields & { OR?: StockFields[] };

function matchingStockLines(legacy: StockMatch, receipt: Prisma.ExpenseReceiptLineWhereInput = legacy): Prisma.PaymentWhereInput {
  const active = { movement: activeStockMovementWhere };
  return { OR: [
    { stockPurchase: { AND: [legacy, active] } },
    { stockPurchase: { is: null }, expenseReceipts: { some: { cancelledAt: null, lines: { some: { AND: [receipt, active] } } } } },
  ] };
}

// Все складские условия должны совпасть на одной строке закупки.
function matchingStockPurchase(params: URLSearchParams): Prisma.PaymentWhereInput | undefined {
  const materials = parseListFilterValue(params.get("material") ?? undefined);
  const units = parseListFilterValue(params.get("stockUnit") ?? undefined);
  const movement = params.get("movement");
  const quantity = moneyRange(params, "stockQty");
  const unitPrice = moneyRange(params, "stockUnitPrice");
  const totalByn = moneyRange(params, "stockValueByn");
  if (!materials && !units && !movement && !quantity && !unitPrice && !totalByn) return undefined;
  return matchingStockLines({
    movementId: movement ? contains(movement) : undefined,
    unitPrice,
    movement: { materialId: materials ? { in: materials } : undefined,
      material: units ? { unitId: { in: units } } : undefined, quantity, totalByn },
  });
}

function currencyCode(value: string) {
  const code = value.toUpperCase();
  if (isCurrency(code)) return code;
  return Object.keys(CURRENCY_SYMBOLS).find(key => CURRENCY_SYMBOLS[key] === value);
}

function parseSearchNumber(search: string) {
  const match = search.match(/^([+−-]?(?:\d{1,3}(?:[ \u00A0\u202F]\d{3})+|\d+)(?:[.,]\d+)?(?:e[+-]?\d{1,2})?)(?:[ \u00A0\u202F]+(\S.*)|([a-z]{3}|[$€₽]))?$/i);
  if (!match) return undefined;
  const [, raw, spacedSuffix, attachedSuffix] = match;
  const decimal = new Prisma.Decimal(raw.replace(/[ \u00A0\u202F]/g, "").replace("−", "-").replace(",", "."));
  // DECIMAL(27,12) — максимальная точность отображаемых полей, у цены единицы строки прихода.
  if (decimal.decimalPlaces() > 12 || decimal.abs().gte("1000000000000000")) return undefined;
  return { value: decimal.toFixed(), suffix: spacedSuffix ?? attachedSuffix };
}

function matchingNumbers(search: string): Prisma.PaymentWhereInput[] {
  const number = parseSearchNumber(search);
  if (!number) return [];
  const { value, suffix } = number;
  const currency = suffix ? currencyCode(suffix) : undefined;
  if (suffix && !currency) {
    return [matchingStockLines({ movement: { quantity: value,
      material: { measurementUnit: { name: { equals: suffix, mode: "insensitive" } } } } })];
  }
  const unitPrice = { unitPrice: value };
  const stockValue = { movement: { totalByn: value } };
  const sourceAmount = { amount: value };
  const bynAmount = { bynAmount: value };
  if (!currency) {
    const stock = [unitPrice, stockValue, { movement: { quantity: value } }];
    return [sourceAmount, bynAmount, { rate: value }, matchingStockLines({ OR: stock }, { OR: [...stock, sourceAmount] })];
  }
  const source = { currency, OR: [sourceAmount, matchingStockLines(unitPrice, { OR: [unitPrice, sourceAmount] })] };
  return currency === "BYN" ? [source, bynAmount, matchingStockLines(stockValue)] : [source];
}

function matchingDay(search: string) {
  const localizedDate = search.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const iso = localizedDate ? `${localizedDate[3]}-${localizedDate[2]}-${localizedDate[1]}` : search;
  return isExpenseIsoDate(iso) ? dateRange(iso, iso) : undefined;
}

function matchingRateAndDate(search: string): Prisma.PaymentWhereInput | undefined {
  const pair = /^(.+?)\s*\/\s*(.+)$/.exec(search);
  if (!pair) return undefined;
  const rate = parseSearchNumber(pair[1]);
  const rateDate = pair[2] === "—" ? null : matchingDay(pair[2]);
  return rate && !rate.suffix && rateDate !== undefined ? { rate: rate.value, rateDate } : undefined;
}

function matchingSearch(search: string): Prisma.PaymentWhereInput {
  const term = contains(search);
  const day = matchingDay(search);
  const rateAndDate = matchingRateAndDate(search);
  const currency = currencyCode(search);
  const projectLabel = /^(.+?)\s*·\s*(.+)$/.exec(search);
  const label = search.toLowerCase();
  return { OR: [
    { id: term }, { comment: term }, { currency: term }, { cashAccount: { name: term } },
    { logisticsAllocationId: null, expenseArticle: { name: term } },
    { project: { OR: [{ number: term }, { title: term }] } },
    ...(projectLabel ? [{ project: {
      number: { endsWith: escapeLike(projectLabel[1]), mode: "insensitive" as const },
      title: { startsWith: escapeLike(projectLabel[2]), mode: "insensitive" as const },
    } }] : []),
    matchingStockLines({ OR: [
      { movementId: term }, { movement: { material: { OR: [{ name: term }, { measurementUnit: { name: term } }] } } },
    ] }),
    matchingDocument(search),
    ...("общий расход организации".includes(label) ? [purpose("@general")] : []),
    ...(["приход на склад", "оплаченный приход материалов"].some(name => name.includes(label)) ? [purpose("@stock")] : []),
    ...(["логистика", "расход по рейсу", "расход относится к общему рейсу"].some(name => name.includes(label)) ? [article("@logistics")] : []),
    ...(day ? [{ paidAt: day }, { rateDate: day }] : []),
    ...(rateAndDate ? [rateAndDate] : []),
    ...(currency && currency !== search.toUpperCase() ? [{ currency }] : []),
    ...matchingNumbers(search),
  ] };
}

export function organizationExpenseQuery(query: string) {
  const params = new URLSearchParams(normalizeListQuery("organizationExpenses", query));
  const id = params.get("id"), comment = params.get("comment"), document = params.get("document"), search = params.get("q");
  const and: Prisma.PaymentWhereInput[] = [expenseBaseWhere, {
    id: id ? contains(id) : undefined,
    comment: comment ? contains(comment) : undefined,
    paidAt: dateRange(...bounds(params, "date")),
    rateDate: dateRange(...bounds(params, "rateDate")),
    amount: moneyRange(params, "amount"),
    bynAmount: moneyRange(params, "byn"),
    rate: moneyRange(params, "rate"),
  }];
  for (const key of Object.keys(choicePredicates) as (keyof typeof choicePredicates)[]) {
    const values = parseListFilterValue(params.get(key) ?? undefined);
    if (values?.length) and.push({ OR: values.map(choicePredicates[key]) });
  }
  if (document) and.push(matchingDocument(document));
  const stockPurchase = matchingStockPurchase(params);
  if (stockPurchase) and.push(stockPurchase);
  if (search) and.push(matchingSearch(search));

  const sort = (params.get("sort") ?? "date") as keyof typeof sorts;
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  const orderBy: Prisma.PaymentOrderByWithRelationInput[] = [
    sorts[sort](dir),
    ...(sort === "id" ? [] : [{ id: "desc" } as const]),
  ];
  const page = Number(params.get("page")) || 1;
  const size = params.get("pageSize");
  const pageSize = size === "all" ? "all" : Number(size) || 10;
  return { where: { AND: and } satisfies Prisma.PaymentWhereInput, orderBy, sort, dir, page, pageSize } as const;
}
