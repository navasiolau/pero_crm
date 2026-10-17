import type { PrismaClient } from "@prisma/client";
import {activePaymentWhere} from '@/server/payments/active-records';
import { getFinanceProjectRef, requireFinanceWorkspaceActor, type FinanceWorkspaceActor } from "./project-refs";
import type { ProjectEconomics } from "./queries";
import type { ProjectExpenseFacts } from "./project-expense-facts";
import { loadProjectStockExpenses, projectExpenseRows } from "./project-expenses";
import { paymentView } from "./payment-view";
import { reportDocumentSelect } from "@/server/finance-documents/view";
import { logisticsAllocationSelect } from "@/server/logistics/payment-view";
import { listActiveCashAccountOptions } from "./default-cash-core";

export async function loadFinanceProjectWorkspace(
  actor: FinanceWorkspaceActor, identifier: string,
  db: Pick<PrismaClient, "project" | "payment" | "cashAccount" | "expenseArticle" | "user" | "stockMovement" | "orgSetting">,
  getEconomics: (projectId: string, facts: ProjectExpenseFacts) => Promise<ProjectEconomics | null>,
) {
  requireFinanceWorkspaceActor(actor);
  const project = await getFinanceProjectRef(actor, identifier, db);
  if (!project) return null;
  const [records, movements, cashAccounts, expenseArticles] = await Promise.all([
    db.payment.findMany({ where: { ...activePaymentWhere, projectId: project.id }, select: {
      id: true, direction: true, amount: true, currency: true, rate: true, bynAmount: true, projectAmount: true, paidAt: true, comment: true, createdById: true,
      cashAccount: { select: { name: true } }, expenseArticle: { select: { id: true, name: true } }, reportDocument: { select: reportDocumentSelect },
      logisticsAllocation: { select: logisticsAllocationSelect },
      logisticsAllocationId: true,
    }, orderBy: { paidAt: "desc" } }),
    loadProjectStockExpenses(actor, project.id, db),
    listActiveCashAccountOptions(db),
    db.expenseArticle.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const ids = [...new Set([...records, ...movements].map(row => row.createdById).filter((id): id is string => id !== null))];
  const [economics, people] = await Promise.all([
    getEconomics(project.id, { payments: records, stockMovements: movements }),
    ids.length ? db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  if (!economics) return null;
  const names = new Map(people.map(person => [person.id, person.name]));
  return {
    project, economics: { expectedPrice: economics.expectedPrice, paidTotal: economics.paidTotal, expensesTotal: economics.expensesTotal,
      payrollTotal: economics.payrollTotal, margin: economics.margin, marginAtFullPrice: economics.marginAtFullPrice, expenseBreakdown: economics.expenseBreakdown },
    unavailableReason: economics.unavailableReason, payments: records.map(row => paymentView(row, names)),
    expenseRows: projectExpenseRows(records, movements, names), cashAccounts, expenseArticles,
  };
}
