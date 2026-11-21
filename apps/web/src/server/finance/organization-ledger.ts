import type { PaymentDirection, Prisma, PrismaClient } from "@prisma/client";
import { expenseBaseWhere, organizationExpenseQuery } from "./organization-expense-query";
import {activePaymentWhere} from '@/server/payments/active-records';
import { requireFinanceWorkspaceActor, listFinanceWorkspaceProjects, type FinanceWorkspaceActor } from "./project-refs";
import { paymentView } from "./payment-view";
import { reportDocumentSelect, paymentReportDocumentsSelect } from "@/server/finance-documents/view";
import { expenseReceiptSelect, expenseReceiptLinesView } from "@/server/warehouse/expense-receipt-view";
import { EXPENSE_RECEIPT_PROJECT_ROLES, hasAnyRole } from "@/lib/roles";
import { stockPurchaseSelect } from "@/server/warehouse/stock-purchase-view";
import { logisticsAllocationSelect } from "@/server/logistics/payment-view";
import { listActiveCashAccountOptions } from "./default-cash-core";

const organizationPaymentSelect = {
  id: true, direction: true, amount: true, currency: true, rate: true, rateDate: true,
  bynAmount: true, projectAmount: true, paidAt: true, comment: true, createdById: true, lastActionId: true,
  project: { select: { id: true, number: true, title: true, deletedAt: true } }, cashAccount: { select: { name: true } },
  expenseArticle: { select: { id: true, name: true } }, reportDocument: { select: reportDocumentSelect },
  reportDocuments: paymentReportDocumentsSelect, stockPurchase: { select: stockPurchaseSelect },
  logisticsAllocation: { select: logisticsAllocationSelect }, expenseReceipts: expenseReceiptSelect,
} satisfies Prisma.PaymentSelect;

type LedgerRecord = Prisma.PaymentGetPayload<{ select: typeof organizationPaymentSelect }>;
function organizationPaymentView(row: LedgerRecord, actor: FinanceWorkspaceActor) {
  return { ...paymentView(row, new Map()), rateDate: row.rateDate?.toISOString() ?? null,
    project: row.project ? { id: row.project.id, number: row.project.number, title: row.project.title, archived: row.project.deletedAt !== null } : null,
    cashName: row.cashAccount?.name ?? null, lastActionId: row.lastActionId ?? null,
    receiptLines: expenseReceiptLinesView(row.expenseReceipts?.[0], row.stockPurchase, row.amount),
    hasActiveExpenseReceipt: Boolean(row.expenseReceipts?.length),
    canPostExpenseReceipt: row.direction === "EXPENSE" && Boolean(row.cashAccount) && Number(row.bynAmount) > 0 &&
      !row.stockPurchase && !row.expenseReceipts?.length && !row.logisticsAllocation &&
      (!row.project || (!row.project.deletedAt && hasAnyRole(actor.roles, EXPENSE_RECEIPT_PROJECT_ROLES))),
  };
}

export async function loadOrganizationPayments(actor: FinanceWorkspaceActor, direction: PaymentDirection,
  db: Pick<PrismaClient, "project" | "payment" | "cashAccount" | "orgSetting">) {
  requireFinanceWorkspaceActor(actor);
  const [records, cashAccounts, projects] = await Promise.all([
    db.payment.findMany({ where: { ...activePaymentWhere, direction }, select: organizationPaymentSelect, orderBy: { paidAt: "desc" } }),
    listActiveCashAccountOptions(db),
    listFinanceWorkspaceProjects(actor, db),
  ]);
  return { rows: records.map(row => organizationPaymentView(row, actor)), cashAccounts,
    projects: projects.map(({ id, number, title }) => ({ id, number, title })) };
}
export type OrganizationLedgerData = Awaited<ReturnType<typeof loadOrganizationPayments>>;
export type OrganizationPaymentRow = OrganizationLedgerData["rows"][number];

export async function loadOrganizationExpensePage(actor: FinanceWorkspaceActor, query: string, db: Pick<PrismaClient, "$transaction">) {
  requireFinanceWorkspaceActor(actor);
  const { where, orderBy, page, pageSize, sort, dir } = organizationExpenseQuery(query);
  return db.$transaction(async tx => {
    // Компиляция JIT для поиска по связанным строкам может исчерпать тайм-аут транзакции.
    await tx.$executeRaw`SET LOCAL jit = off`;
    const { _count, _sum } = await tx.payment.aggregate({ where, _count: true, _sum: { bynAmount: true } });
    const currentPage = pageSize === "all" ? 1 : Math.min(page, Math.max(1, Math.ceil(_count / pageSize)));
    const skip = pageSize === "all" ? undefined : (currentPage - 1) * pageSize;
    const take = pageSize === "all" ? undefined : pageSize;
    const [records, options, cashAccounts, projects] = await Promise.all([
      sort === "article" ? loadByDisplayedArticle(tx, where, dir, skip, take)
        : tx.payment.findMany({ where, orderBy, select: organizationPaymentSelect, skip, take }),
      loadExpenseFilterOptions(tx),
      listActiveCashAccountOptions(tx),
      listFinanceWorkspaceProjects(actor, tx),
    ]);
    return { rows: records.map(row => organizationPaymentView(row, actor)), options, cashAccounts,
      projects: projects.map(({ id, number, title, currency }) => ({ id, number, title, currency })),
      total: _count, totalByn: _sum.bynAmount?.toFixed(2) ?? "0.00",
      page: currentPage, pageSize, sort, dir };
  }, { isolationLevel: "RepeatableRead" });
}

// У расходов рейса отображается статья «Логистика», которой нет в справочнике.
async function loadByDisplayedArticle(db: Prisma.TransactionClient, where: Prisma.PaymentWhereInput,
  dir: Prisma.SortOrder, skip?: number, take?: number) {
  const rows = await db.payment.findMany({ where, orderBy: { id: "desc" }, select: {
    id: true, logisticsAllocationId: true, expenseArticle: { select: { name: true } },
  } });
  const collator = new Intl.Collator("ru");
  const label = (row: typeof rows[number]) => row.logisticsAllocationId ? "Логистика" : row.expenseArticle?.name ?? "";
  rows.sort((a, b) => collator.compare(label(a), label(b)) * (dir === "asc" ? 1 : -1));
  const start = skip ?? 0;
  const ids = (take === undefined ? rows : rows.slice(start, start + take)).map(row => row.id);
  if (!ids.length) return [];
  // Во «Все» читаем весь исходный scope, чтобы не создавать массив параметров из всех ID.
  const records = await db.payment.findMany({ where: take === undefined ? where : { id: { in: ids } }, select: organizationPaymentSelect });
  const byId = new Map(records.map(record => [record.id, record]));
  return ids.flatMap(id => byId.get(id) ?? []);
}

async function loadExpenseFilterOptions(db: Prisma.TransactionClient) {
  const [projects, cashAccounts, articles, currencies, materials] = await Promise.all([
    db.project.findMany({ where: { payments: { some: expenseBaseWhere } },
      select: { id: true, number: true, title: true }, orderBy: { numberInt: "desc" } }),
    db.cashAccount.findMany({ where: { payments: { some: expenseBaseWhere } }, select: { id: true, name: true, currency: true }, orderBy: { name: "asc" } }),
    db.expenseArticle.findMany({ where: { payments: { some: { AND: [expenseBaseWhere, { logisticsAllocationId: null }] } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.payment.groupBy({ where: expenseBaseWhere, by: ["currency"], orderBy: { currency: "asc" } }),
    db.material.findMany({ where: { movements: { some: { OR: [
      { stockPurchase: { payment: expenseBaseWhere } },
      { expenseReceiptLine: { receipt: { cancelledAt: null, payment: expenseBaseWhere } } },
    ] } } },
      select: { id: true, name: true, measurementUnit: { select: { id: true, name: true } } }, orderBy: { name: "asc" } }),
  ]);
  return {
    purpose: [
      { value: "@general", label: "Общий расход организации" }, { value: "@stock", label: "Приход на склад" },
      { value: "@logistics", label: "Расход по рейсу" },
      ...projects.map(({ id, number, title }) => ({ value: id, label: number + " · " + title })),
    ],
    cash: [...cashAccounts.map(({ id, name, currency }) => ({ value: id, label: name + " · " + currency })), { value: "@none", label: "Без кассы" }],
    article: [...articles.map(({ id, name }) => ({ value: id, label: name })), { value: "@logistics", label: "Логистика" }, { value: "@none", label: "Без статьи" }],
    currency: currencies.map(({ currency }) => ({ value: currency, label: currency })),
    documentPresence: [{ value: "yes", label: "Есть документ" }, { value: "no", label: "Без документа" }],
    material: materials.map(({ id, name }) => ({ value: id, label: name })),
    stockUnit: [...new Map(materials.map(({ measurementUnit }) => [measurementUnit.id, { value: measurementUnit.id, label: measurementUnit.name }])).values()],
  };
}

export type OrganizationExpensePageData = Awaited<ReturnType<typeof loadOrganizationExpensePage>>;
