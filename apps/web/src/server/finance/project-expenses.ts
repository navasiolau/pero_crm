import type { Prisma, PrismaClient } from "@prisma/client";
import {activeStockMovementWhere} from '@/server/warehouse/active-records';
import { requireFinanceWorkspaceActor, type FinanceWorkspaceActor } from "./project-refs";
import { paymentView, type PaymentRecord } from "./payment-view";
import { paymentExpenseArticle, stockExpenseAmount, WAREHOUSE_EXPENSE_ARTICLE } from "./project-expense-facts";
import type { ProjectExpenseRow } from "./contracts";

const stockExpenseSelect = {
  id: true, type: true, quantity: true, unitPrice: true, totalByn: true, createdAt: true, createdById: true, comment: true,
  material: { select: { id: true, name: true, unit: true } },
  product: { select: { id: true, number: true } },
  warehouseValuation: { select: { unitCost: true, sourceMovementId: true } },
} satisfies Prisma.StockMovementSelect;
export type ProjectStockExpenseRecord = Prisma.StockMovementGetPayload<{ select: typeof stockExpenseSelect }>;

export async function loadProjectStockExpenses(actor: FinanceWorkspaceActor, projectId: string, db: Pick<PrismaClient, "stockMovement">) {
  requireFinanceWorkspaceActor(actor);
  return db.stockMovement.findMany({ where: { ...activeStockMovementWhere, product: { projectId }, type: { in: ["EXPENSE", "RETURN"] } }, select: stockExpenseSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}
export function projectExpenseRows(payments: readonly PaymentRecord[], movements: readonly ProjectStockExpenseRecord[], people: ReadonlyMap<string, string>): ProjectExpenseRow[] {
  const rows: ProjectExpenseRow[] = payments.filter(row => row.direction === "EXPENSE").map(row => {
    const payment = paymentView(row, people);
    return { id: `payment:${row.id}`, source: "PAYMENT", sourceId: row.id, date: payment.paidAt,
      article: paymentExpenseArticle(row.expenseArticle), bynAmount: payment.bynAmount,
      comment: row.comment, createdByName: payment.createdByName, payment, stock: null };
  });
  for (const row of movements) {
    if (row.type !== "EXPENSE" && row.type !== "RETURN") continue;
    rows.push({ id: `stock:${row.id}`, source: row.type === "RETURN" ? "WAREHOUSE_RETURN" : "WAREHOUSE_ISSUE", sourceId: row.id,
      date: row.createdAt.toISOString(), article: WAREHOUSE_EXPENSE_ARTICLE, bynAmount: stockExpenseAmount(row),
      comment: row.comment, createdByName: row.createdById ? people.get(row.createdById) ?? null : null, payment: null,
      stock: { materialId: row.material.id, materialName: row.material.name, unit: row.material.unit,
        quantity: row.quantity.toString(), unitPrice: (row.warehouseValuation?.unitCost ?? row.unitPrice)?.toString() ?? null,
        product: row.product ? { id: row.product.id, number: row.product.number } : null,
        sourceMovementId: row.warehouseValuation?.sourceMovementId ?? null } });
  }
  return rows.sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

