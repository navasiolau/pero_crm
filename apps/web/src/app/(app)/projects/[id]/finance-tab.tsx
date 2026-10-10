"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";


import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { formatAmount, formatMoneyTotal, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deletePayment } from "@/server/payments/actions";
import { ProjectExpenseLedger } from "@/components/project-expense-ledger";
import { ReportDocumentButton } from "@/components/report-document-button";


import type { PaymentRow, ProjectExpenseRow, ProjectEconomicsView, CashAccountOption, ExpenseArticleOption } from "@/server/finance/contracts";
export type { PaymentRow, ProjectEconomicsView, CashAccountOption, ExpenseArticleOption } from "@/server/finance/contracts";
import { PaymentDialog } from "@/components/payment-dialog";
export { PaymentDialog } from "@/components/payment-dialog";

// Вкладка «Финансы» проекта (§11, только админ/директор): экономика
// (ожидаемая цена, оплаты, расходы = ЗП + статьи, маржа с индикатором),
// приходы и расходы в любой из 4 валют с курсом НБ РБ в записи.
export function FinanceTab({
  projectId,
  currency,
  economics,
  payments,
  expenseRows,
  cashAccounts,
  expenseArticles,
  canEdit = true,
}: {
  canEdit?: boolean;
  projectId: string;
  currency: string;
  economics: ProjectEconomicsView;
  payments: PaymentRow[];
  expenseRows: ProjectExpenseRow[];
  cashAccounts: CashAccountOption[];
  expenseArticles: ExpenseArticleOption[];
}) {
  const [dialogDirection, setDialogDirection] = useState<
    "INCOME" | "EXPENSE" | null
  >(null);
  const [deleting, setDeleting] = useState<PaymentRow | null>(null);

  const router = useRouter();

  const incomes = payments.filter((payment) => payment.direction === "INCOME");


  function amountCell(row: PaymentRow) {
    return (
      <div className="flex flex-col items-end">
        <span>{formatAmount(row.amount, row.currency)}</span>
        {row.currency !== "BYN" ? (
          <span className="text-xs text-muted-foreground">
            {formatAmount(row.bynAmount, "BYN")} по курсу {row.rate}
          </span>
        ) : null}
      </div>
    );
  }

  function buildColumns(): DataColumn<PaymentRow>[] {
    const columns: DataColumn<PaymentRow>[] = [
      {
        id: "date",
        header: "Дата",
        sortable: true,
        sortValue: (row) => row.paidAt,
        cell: (row) => formatDate(row.paidAt),
      },
    ];
    columns.push(
      {
        id: "account",
        header: "Касса",
        sortable: true,
        sortValue: (row) => row.cashAccountName ?? "",
        cell: (row) => (
          <span className="text-muted-foreground">
            {row.cashAccountName ?? "—"}
          </span>
        ),
      },
      {
        id: "comment",
        header: "Комментарий",
        sortable: true,
        sortValue: (row) => row.comment ?? "",
        cell: (row) => row.comment ?? "—",
      },
      {
        id: "createdBy",
        header: "Кто внёс",
        sortable: true,
        sortValue: (row) => row.createdByName ?? "",
        cell: (row) => (
          <span className="text-muted-foreground">
            {row.createdByName ?? "—"}
          </span>
        ),
      },
      {
        id: "amount",
        header: "Сумма",
        sortable: true,
        sortValue: (row) => row.bynAmount,
        className: "text-right font-medium",
        headerClassName: "text-right",
        cell: amountCell,
      },
      {
        id: "document",
        header: "Отчетный документ",
        searchValue: (row) => row.reportDocument?.fileName ?? "",
        cell: (row) => <ReportDocumentButton document={row.reportDocument} />,
      },
      {
        id: "actions",
        header: "",
        className: "w-10",
        cell: (row) => canEdit ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={row.direction === "INCOME" ? "Удалить приход" : "Удалить расход"}
            disabled={Boolean(row.logisticsTripId)}
            onClick={(event) => {
              event.stopPropagation();
              setDeleting(row);
            }}
          >
            <Trash2 className="size-4 text-muted-foreground" />
          </Button>
        ) : null,
      },
    );
    return columns;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Экономика проекта (§11) */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ожидаемая цена
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {economics.expectedPrice !== null
                ? formatMoneyTotal(economics.expectedPrice, "BYN")
                : formatMoneyTotal(null)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Оплачено
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatMoneyTotal(economics.paidTotal, "BYN")}
            </div>
            {economics.expectedPrice !== null && economics.paidTotal !== null ? (
              <p className="text-xs text-muted-foreground">
                осталось{" "}
                {formatAmount(
                  Math.max(0, economics.expectedPrice - economics.paidTotal),
                  "BYN",
                )}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Расходы
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatMoneyTotal(
                economics.expensesTotal === null || economics.payrollTotal === null ? null : economics.expensesTotal + economics.payrollTotal,
                "BYN",
              )}
            </div>
            {economics.expenseBreakdown.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {economics.expenseBreakdown
                  .map((item) => `${item.label}: ${formatMoneyTotal(item.amount, "BYN")}`)
                  .join(" · ")}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Маржа
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                "text-2xl font-semibold",
                economics.margin === null ? "" : economics.margin >= 0 ? "text-green-600" : "text-red-600",
              )}
            >
              {formatMoneyTotal(economics.margin, "BYN")}
            </div>
            {economics.marginAtFullPrice !== null ? (
              <p className="text-xs text-muted-foreground">
                при полной оплате:{" "}
                <span
                  className={cn(
                    economics.marginAtFullPrice >= 0
                      ? "text-green-600"
                      : "text-red-600",
                  )}
                >
                  {formatMoneyTotal(economics.marginAtFullPrice, "BYN")}
                </span>
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Приходы */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Приходы</h3>
          <Button disabled={!canEdit} onClick={() => setDialogDirection("INCOME")}>
            <Plus className="size-4" />
            Добавить приход
          </Button>
        </div>
        <DataTable
          columns={buildColumns()}
          rows={incomes}
          searchPlaceholder="Поиск по приходам…"
          emptyText="Приходов по проекту пока нет"
        />
      </div>

      {/* Расходы */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Расходы</h3>
          <Button
            variant="outline"
            disabled={!canEdit}
            onClick={() => setDialogDirection("EXPENSE")}
          >
            <Plus className="size-4" />
            Добавить расход
          </Button>
        </div>
        <ProjectExpenseLedger rows={expenseRows} breakdown={economics.expenseBreakdown} onDelete={canEdit ? setDeleting : undefined} />
        <p className="text-xs text-muted-foreground">
          Зарплата учитывается в марже автоматически из начислений по задачам
          проекта — вносить её расходом не нужно.
        </p>
      </div>


      <PaymentDialog
        direction={dialogDirection ?? "INCOME"}
        open={canEdit && dialogDirection !== null}
        onOpenChange={(open) => {
          if (!open) setDialogDirection(null);
        }}
        projectId={projectId}
        projectCurrency={currency}
        cashAccounts={cashAccounts}
        expenseArticles={expenseArticles}
      />

      <ConfirmDeleteDialog
        entityLabel={deleting?.direction === "EXPENSE" ? "расход" : "приход"}
        open={canEdit && deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        warning={
          deleting
            ? `${formatAmount(deleting.amount, deleting.currency)} — ${
                deleting.direction === "INCOME"
                  ? "оборот месяца уменьшится"
                  : "маржа проекта изменится"
              }.`
            : undefined
        }
        onConfirm={async () => {
          if (!deleting) return false;
          const result = await deletePayment(deleting.id);
          if (result.ok) {
            toast.success(
              deleting.direction === "INCOME"
                ? "Приход удалён"
                : "Расход удалён",
            );
            router.refresh();
            return true;
          }
          toast.error(result.error ?? "Ошибка удаления");
          return false;
        }}
      />
    </div>
  );
}
