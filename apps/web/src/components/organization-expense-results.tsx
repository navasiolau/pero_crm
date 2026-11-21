"use client";
import { LogisticsReallocationButton } from "@/components/logistics/reallocation-dialog";

import { ExpenseProjectAssignmentDialog } from "@/components/expense-project-assignment-dialog";
import { ExpenseReceiptIssueDialog } from "@/components/expense-receipt-issue-dialog";
import { ExpenseReceiptDialog } from "@/components/expense-receipt-dialog";
import { OrganizationExpenseToolbar } from "@/components/organization-expense-toolbar";
import { OrganizationPaymentsView } from "@/components/organization-payments-view";
import { INTERNAL_CURRENCY } from "@/lib/internal-currency";
import { formatExactMoney } from "@/lib/format";
import { useListParams } from "@/lib/list-params";
import type { OrganizationExpensePageData } from "@/server/finance/organization-ledger";

const expensePlural = new Intl.PluralRules("ru");

export function OrganizationExpenseResults({ options, page, pageSize, total, totalByn, sort, dir, canAssignProject, canRedistributeLogistics, ...ledger }: OrganizationExpensePageData &
  Pick<Parameters<typeof OrganizationPaymentsView>[0], "expenseArticles" | "stockMaterials" | "materialCreateOptions"> & { canAssignProject?: boolean; canRedistributeLogistics?: boolean }) {
  const { set, pending } = useListParams();
  const plural = expensePlural.select(total);
  return <OrganizationPaymentsView direction="EXPENSE" {...ledger}
    renderDetailActions={(row, close) => <>
      {canAssignProject && !row.project?.archived && !row.stockPurchase && !row.hasActiveExpenseReceipt && !row.logisticsTripId ? (
        <ExpenseProjectAssignmentDialog key={row.id} paymentId={row.id} currentProjectId={row.project?.id ?? null}
          expectedHead={row.lastActionId} projects={ledger.projects.filter(project => project.currency === INTERNAL_CURRENCY || project.id === row.project?.id)} onApplied={close}/>
      ) : null}
      {canAssignProject && row.receiptLines?.length ? <ExpenseReceiptIssueDialog key={"issue:" + row.id} paymentId={row.id} onApplied={close}/> : null}
      {ledger.stockMaterials ? <ExpenseReceiptDialog key={"receipt:" + row.id} payment={row} stockMaterials={ledger.stockMaterials} onApplied={close}/> : null}
      {canRedistributeLogistics && row.logisticsTripId ? <LogisticsReallocationButton key={"logistics:" + row.id} paymentId={row.id} closeExpense={close}/> : null}
    </>}
    beforeTable={<OrganizationExpenseToolbar options={options}/>}
    tableSummary={
      <div aria-live="polite" aria-atomic="true" aria-busy={pending}
        className="flex min-w-0 items-center justify-between gap-3 py-0.5 sm:px-1 sm:py-1">
        <span className="shrink-0 text-sm font-medium">{total.toLocaleString("ru-RU")} {plural === "one" ? "расход" : plural === "few" ? "расхода" : "расходов"}</span>
        <div className="flex min-w-0 flex-col items-end gap-0.5 text-right sm:flex-row sm:items-baseline sm:gap-3">
          <span className="text-xs text-muted-foreground">Итого по выборке</span>
          <strong className="text-lg leading-tight font-semibold tracking-tight tabular-nums sm:text-2xl">{formatExactMoney(totalByn, "BYN")}</strong>
        </div>
      </div>
    }
    tableServer={{
      page, pageSize: pageSize === "all" ? 10 : pageSize, allRows: pageSize === "all", total, sort, dir,
      onPageChange: next => set({ page: String(next) }),
      onSortChange: (field, direction) => set({ sort: field, dir: direction }),
      onPageSizeChange: size => set({ pageSize: String(size) }),
      onShowAll: () => set({ pageSize: "all" }),
    }}/>;
}
