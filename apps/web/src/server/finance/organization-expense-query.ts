import type { Prisma } from "@prisma/client";

import { expenseSortFields } from "@/lib/organization-expense-filters";
import { parseListFilterValue } from "@/lib/list-filter-values";
import { normalizeListQuery } from "@/lib/list-state";
import { activePaymentWhere } from "@/server/payments/active-records";

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

function contains(value: string) {
  return { contains: value.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const };
}

function bounds(params: URLSearchParams, field: string) {
  return [params.get(field + "From") ?? undefined, params.get(field + "To") ?? undefined] as const;
}

function moneyRange(params: URLSearchParams, field: string) {
  const [gte, lte] = bounds(params, field);
  return gte || lte ? { gte, lte } : undefined;
}

function dateRange(params: URLSearchParams, field: string) {
  const [from, to] = bounds(params, field);
  if (!from && !to) return undefined;
  const midnight = (value: string) => new Date(value + "T00:00:00+03:00");
  const gte = from ? midnight(from) : undefined;
  const lt = to ? new Date(midnight(to).getTime() + 86_400_000) : undefined;
  return { gte, lt };
}

// Порядок источников соответствует paymentView и reportDocumentFiles.
function matchingDocument(name?: string): Prisma.PaymentWhereInput {
  const fileName = name ? contains(name) : undefined;
  return { OR: [
    { logisticsAllocation: { posting: { documents: { some: { document: { fileName } } } } } },
    { logisticsAllocationId: null, reportDocuments: { some: { document: { state: "READY", fileName } } } },
    { logisticsAllocationId: null, reportDocuments: { none: {} }, reportDocument: { state: "READY", fileName } },
  ] };
}

function purpose(value: string): Prisma.PaymentWhereInput {
  if (value === "@stock") return { projectId: null, stockPurchase: { isNot: null } };
  if (value === "@general") return { projectId: null, stockPurchase: { is: null } };
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

export function organizationExpenseQuery(query: string) {
  const params = new URLSearchParams(normalizeListQuery("organizationExpenses", query));
  const id = params.get("id"), comment = params.get("comment"), document = params.get("document"), search = params.get("q");
  const and: Prisma.PaymentWhereInput[] = [expenseBaseWhere, {
    id: id ? contains(id) : undefined,
    comment: comment ? contains(comment) : undefined,
    paidAt: dateRange(params, "date"),
    rateDate: dateRange(params, "rateDate"),
    amount: moneyRange(params, "amount"),
    bynAmount: moneyRange(params, "byn"),
    rate: moneyRange(params, "rate"),
  }];
  for (const key of Object.keys(choicePredicates) as (keyof typeof choicePredicates)[]) {
    const values = parseListFilterValue(params.get(key) ?? undefined);
    if (values?.length) and.push({ OR: values.map(choicePredicates[key]) });
  }
  if (document) and.push(matchingDocument(document));
  if (search) {
    const term = contains(search);
    and.push({ OR: [
      { id: term }, { comment: term }, { currency: term }, { cashAccount: { name: term } },
      { logisticsAllocationId: null, expenseArticle: { name: term } },
      { project: { OR: [{ number: term }, { title: term }] } },
      { stockPurchase: { movement: { material: { name: term } } } },
      matchingDocument(search),
      ...("общий расход организации".includes(search.toLowerCase()) ? [purpose("@general")] : []),
      ...("приход на склад".includes(search.toLowerCase()) ? [purpose("@stock")] : []),
      ...("логистика".includes(search.toLowerCase()) ? [article("@logistics")] : []),
      ...(/^-?\d{1,14}(\.\d{1,6})?$/.test(search.replace(",", ".")) ? [
        { amount: search.replace(",", ".") }, { bynAmount: search.replace(",", ".") }, { rate: search.replace(",", ".") },
      ] : []),
    ] });
  }

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
