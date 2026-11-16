import type { JournalPresentationHints } from "@/server/changelog/contract";

type Context = NonNullable<JournalPresentationHints["contexts"]>[number];
type NumberedObject = { id: string; number?: string | null };

/** Контекст фиксируется при операции; принадлежность изделия не расширяется до проекта. */
export function journalProjectContext(project: NumberedObject): Context {
  return { kind: "project", id: project.id, label: project.number ? `Проект ${project.number}` : "Проект",
    href: `/projects/${encodeURIComponent(project.id)}` };
}

export function journalProductContext(product: NumberedObject): Context {
  return { kind: "product", id: product.id, label: product.number ? `Изделие ${product.number}` : "Изделие",
    href: `/products/${encodeURIComponent(product.id)}` };
}

export function journalAutomatic(actor: { id: string; name?: string | null }, reason: string): JournalPresentationHints {
  return { actor: { type: "system", id: "system", name: "Система" },
    initiator: { id: actor.id, name: actor.name || "Пользователь" }, reason };
}

type DecimalValue = { toString(): string } | number | string | null;
const decimal = (value: DecimalValue | undefined) => value == null ? null : value.toString();

export function materialJournalSnapshot(row: {
  name: string; sku?: string | null; unitId?: string; categoryId?: string | null;
  purchasePrice?: DecimalValue; minStock?: DecimalValue; comment?: string | null;
  active?: boolean; measurementUnit?: { name: string };
}) {
  return { name: row.name, sku: row.sku ?? null, unitId: row.unitId ?? null, unit: row.measurementUnit?.name ?? null,
    categoryId: row.categoryId ?? null, purchasePrice: decimal(row.purchasePrice), minStock: decimal(row.minStock),
    comment: row.comment ?? null, active: row.active ?? true };
}

export function paymentJournalSnapshot(row: {
  projectId?: string | null; direction: string; amount: DecimalValue; currency: string;
  rate?: DecimalValue; rateDate?: Date | null; bynAmount?: DecimalValue; projectAmount?: DecimalValue;
  cashAccountId?: string | null; expenseArticleId?: string | null; paidAt?: Date;
  comment?: string | null; reportDocumentId?: string | null; logisticsAllocationId?: string | null;
}, extra: { project?: string | null; cashAccount?: string | null; expenseArticle?: string | null; documentIds?: readonly string[] } = {}) {
  return { projectId: row.projectId ?? null, project: extra.project ?? null, direction: row.direction,
    amount: decimal(row.amount), currency: row.currency, rate: decimal(row.rate), rateDate: row.rateDate?.toISOString() ?? null,
    bynAmount: decimal(row.bynAmount), projectAmount: decimal(row.projectAmount), cashAccountId: row.cashAccountId ?? null,
    cashAccount: extra.cashAccount ?? null, expenseArticleId: row.expenseArticleId ?? null, expenseArticle: extra.expenseArticle ?? null,
    paidAt: row.paidAt?.toISOString() ?? null, comment: row.comment ?? null,
    reportDocumentIds: extra.documentIds ?? (row.reportDocumentId ? [row.reportDocumentId] : []),
    logisticsAllocationId: row.logisticsAllocationId ?? null };
}

export function payoutJournalSnapshot(row: {
  userId: string; kind: string; amount: DecimalValue; month: string; comment?: string | null;
  cashAccountId?: string | null; cashAmount?: DecimalValue; cashCurrency?: string | null;
  bynAmount?: DecimalValue; cashRate?: DecimalValue; payrollRate?: DecimalValue;
  cashRateDate?: Date | null; payrollRateDate?: Date | null; payrollCurrency?: string | null;
}, names: { user?: string; cashAccount?: string } = {}) {
  return { userId: row.userId, user: names.user ?? null, kind: row.kind, amount: decimal(row.amount), month: row.month,
    comment: row.comment ?? null, cashAccountId: row.cashAccountId ?? null, cashAccount: names.cashAccount ?? null,
    cashAmount: decimal(row.cashAmount), cashCurrency: row.cashCurrency ?? null, bynAmount: decimal(row.bynAmount),
    cashRate: decimal(row.cashRate), payrollRate: decimal(row.payrollRate), cashRateDate: row.cashRateDate?.toISOString() ?? null,
    payrollRateDate: row.payrollRateDate?.toISOString() ?? null, payrollCurrency: row.payrollCurrency ?? null };
}
