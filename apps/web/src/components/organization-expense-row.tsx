"use client";

import Link from "next/link";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { ReportDocumentButton } from "@/components/report-document-button";
import { Button } from "@/components/ui/button";
import type { DataColumn } from "@/components/ui/data-table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate, formatExactMoney } from "@/lib/format";
import { INTERNAL_CURRENCY } from "@/lib/internal-currency";
import { reportDocumentNames } from "@/lib/report-document-names";
import type { OrganizationPaymentRow } from "@/server/finance/organization-ledger";

export function organizationExpensePurpose(row: OrganizationPaymentRow) {
  if (row.project) return `${row.project.number} · ${row.project.title}`;
  if (row.stockPurchase || row.receiptLines?.length) return "Приход на склад";
  if (row.logisticsTripId) return "Расход по рейсу";
  return "Общий расход организации";
}

function CopyExpenseId({ id }: { id: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button type="button" size="icon-sm" variant="ghost" className="size-11 md:size-7" />}
        aria-label="Скопировать ID"
        aria-description={id}
        onClick={async event => {
          event.stopPropagation();
          try {
            await navigator.clipboard.writeText(id);
            toast.success("ID скопирован");
          } catch {
            toast.error("Не удалось скопировать ID");
          }
        }}
      >
        <Copy aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent role="tooltip" className="break-all font-mono">{id}</TooltipContent>
    </Tooltip>
  );
}

function ExpensePurpose({ row }: { row: OrganizationPaymentRow }) {
  const purpose = organizationExpensePurpose(row);
  return (
    <div className="min-w-0">
      {row.project ? (
        <Link className="block truncate text-primary hover:underline" href={`/finance/projects/${row.project.id}`}>
          {purpose}
        </Link>
      ) : <p className="truncate">{purpose}</p>}
      {row.comment && <p className="truncate text-xs text-muted-foreground">{row.comment}</p>}
    </div>
  );
}

function ExpenseAmount({ row }: { row: OrganizationPaymentRow }) {
  return (
    <div className="ml-auto max-w-full shrink-0 text-right whitespace-nowrap tabular-nums">
      <p className="font-medium">{formatExactMoney(row.amount.toFixed(2), row.currency)}</p>
      {row.currency !== INTERNAL_CURRENCY && (
        <p className="text-xs text-muted-foreground">{formatExactMoney(row.bynAmount.toFixed(2), INTERNAL_CURRENCY)}</p>
      )}
    </div>
  );
}

export const organizationExpenseColumns: DataColumn<OrganizationPaymentRow>[] = [
  {
    id: "id", header: "ID", sortable: true, sortValue: row => row.id,
    className: "w-12 py-1", cell: row => <CopyExpenseId id={row.id} />,
  },
  {
    id: "date", header: "Дата", sortable: true, sortValue: row => row.paidAt,
    className: "py-1", cell: row => formatDate(row.paidAt),
  },
  {
    id: "project", header: "Назначение",
    searchValue: row => [organizationExpensePurpose(row), row.comment, row.stockPurchase?.materialName,
      ...(row.receiptLines ?? []).map(line => line.materialName)].filter(Boolean).join(" "),
    className: "py-1", cell: row => (
      <div className="min-w-36 max-w-[clamp(9rem,calc(33vw-7rem),22rem)]">
        <ExpensePurpose row={row} />
      </div>
    ),
  },
  {
    id: "cash", header: "Касса", sortable: true, sortValue: row => row.cashAccountName ?? "",
    className: "min-w-28 max-w-44 py-1 whitespace-normal break-words", cell: row => row.cashAccountName ?? "—",
  },
  {
    id: "article", header: "Статья", sortable: true, sortValue: row => row.expenseArticleName ?? "",
    className: "min-w-28 max-w-44 py-1 whitespace-normal break-words", cell: row => row.expenseArticleName ?? "—",
  },
  {
    id: "amount", header: "Сумма", sortable: true, sortValue: row => row.amount,
    additionalSorts: [{ id: "byn", header: "Эквивалент BYN", sortValue: row => row.bynAmount }],
    headerClassName: "text-right", className: "py-1", cell: row => <ExpenseAmount row={row} />,
  },
  {
    id: "document", header: "Документы", searchValue: reportDocumentNames,
    headerClassName: "text-center", className: "py-1 text-center",
    cell: row => row.reportDocument || row.reportDocuments?.length
      ? <ReportDocumentButton document={row.reportDocument} documents={row.reportDocuments} compact />
      : <span className="text-muted-foreground">—</span>,
  },
];

export function OrganizationExpenseMobileCard({ row }: { row: OrganizationPaymentRow }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-1.5 max-[359px]:text-[16px]">
        <CopyExpenseId id={row.id} />
        <span className="mr-auto text-sm whitespace-nowrap max-[359px]:text-[14px]">{formatDate(row.paidAt)}</span>
        <ExpenseAmount row={row} />
      </div>
      <ExpensePurpose row={row} />
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs break-words text-muted-foreground">
          {row.cashAccountName ?? "—"}{row.expenseArticleName && ` · ${row.expenseArticleName}`}
        </p>
        <ReportDocumentButton document={row.reportDocument} documents={row.reportDocuments} compact />
      </div>
    </div>
  );
}
