"use client";

import { PageHeader } from "@/components/page-header";
import { useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn, type DataTableServerState } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { OrganizationExpenseMobileCard, organizationExpenseColumns, organizationExpensePurpose } from "@/components/organization-expense-row";
import { PaymentDialog } from "@/components/payment-dialog";
import { ReportDocumentButton } from "@/components/report-document-button";
import { formatAmount, formatDate, formatQty, formatMoneyTotal } from "@/lib/format";
import { INTERNAL_CURRENCY } from "@/lib/internal-currency";
import { cn } from "@/lib/utils";
import type { StockMaterialOption } from "@/server/warehouse/contracts";
import type { MaterialCreateOptions } from "@/server/warehouse/material-contracts";
import { deletePayment } from "@/server/payments/actions";
import type { ExpenseArticleOption } from "@/server/finance/contracts";
import type { OrganizationLedgerData, OrganizationPaymentRow } from "@/server/finance/organization-ledger";

export function OrganizationPaymentsView({ direction, rows, cashAccounts, projects, expenseArticles = [], stockMaterials, materialCreateOptions, beforeTable, tableServer, tableSummary, renderDetailActions }: OrganizationLedgerData & {
  direction: "INCOME" | "EXPENSE";
  expenseArticles?: ExpenseArticleOption[];
  stockMaterials?: StockMaterialOption[];
  materialCreateOptions?: MaterialCreateOptions;
  beforeTable?: ReactNode;
  tableServer?: DataTableServerState;
  tableSummary?: ReactNode;
  renderDetailActions?: (row: OrganizationPaymentRow, close: () => void) => ReactNode;
}) {
  const income = direction === "INCOME", noun = income ? "приход" : "расход";
  const title = income ? "Приходы организации" : "Расходы организации";
  const general = income ? "Общий приход организации" : "Общий расход организации";
  const longFieldLabel = income ? undefined : "col-start-1";
  const longFieldValue = income ? undefined : "col-span-full -mt-2 md:col-[2/-1] md:mt-0";
  const [open, setOpen] = useState(false), [viewing, setViewing] = useState<OrganizationPaymentRow | null>(null);
  const [expanded, setExpanded] = useState(false);
  const expandLabel = expanded ? "Вернуть размер" : "Развернуть на весь экран";
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const [deleting, setDeleting] = useState<OrganizationPaymentRow | null>(null), router = useRouter();
  const closeDetailButton = <Button variant="outline" onClick={() => setViewing(null)}>Закрыть</Button>;
  const deleteDetailButton = (
    <Button variant="destructive"
      disabled={viewing?.project?.archived || Boolean(viewing?.stockPurchase || viewing?.receiptLines?.length || viewing?.logisticsTripId)}
      onClick={() => { setDeleting(viewing); setViewing(null); }}>
      Удалить
    </Button>
  );
  const incomeColumns: DataColumn<OrganizationPaymentRow>[] = [
    { id: "date", header: "Дата", sortable: true, sortValue: row => row.paidAt, cell: row => formatDate(row.paidAt) },
    { id: "project", header: "Проект / назначение", searchValue: row => (row.stockPurchase || row.receiptLines?.length) ? `Приход на склад ${row.receiptLines?.map(line => line.materialName).join(" ") || row.stockPurchase?.materialName}` : row.project ? `${row.project.number} ${row.project.title}` : general,
      cell: row => row.project ? <Link className="hover:underline" onClick={event => event.stopPropagation()} href={`/finance/projects/${row.project.id}`}>{row.project.number} · {row.project.title}</Link> : (row.stockPurchase || row.receiptLines?.length) ? "Приход на склад" : general },
    { id: "cash", header: "Касса", sortable: true, sortValue: row => row.cashAccountName ?? "", cell: row => row.cashAccountName ?? "—" },
    { id: "amount", header: "Сумма", sortable: true, sortValue: row => row.amount, className: "text-right", cell: row => formatAmount(row.amount, row.currency) },
    { id: "rate", header: "Курс / дата", cell: row => `${row.rate} / ${row.rateDate ? formatDate(row.rateDate) : "—"}` },
    { id: "byn", header: "Эквивалент BYN", sortable: true, sortValue: row => row.bynAmount, className: "text-right", cell: row => formatAmount(row.bynAmount, "BYN") },
    { id: "comment", header: "Комментарий", searchValue: row => row.comment ?? "", cell: row => row.comment ?? "—" },
    { id: "actions", header: "", cell: row => <Button variant="ghost" disabled={row.project?.archived || Boolean(row.stockPurchase || row.receiptLines?.length) || Boolean(row.logisticsTripId)} onClick={event => { event.stopPropagation(); setDeleting(row); }}>Удалить</Button> },
  ];
  return <section className={income ? "flex min-w-0 flex-col gap-5" : "@container/expenses flex min-w-0 flex-col gap-3"}>
    <PageHeader
      title={title}
      titleClassName={income ? "text-2xl" : "text-xl"}
      actions={
        <>
          {stockMaterials && <Button variant="outline" onClick={() => setPurchaseOpen(true)}>Приход на склад</Button>}
          <Button onClick={() => setOpen(true)}>Добавить {noun}</Button>
        </>
      }
    />
    {income && <p className="text-sm text-muted-foreground">Общий приход без проекта входит в баланс и оборот организации; экономика отдельных проектов не меняется.</p>}
    {beforeTable}
    <DataTable columns={income ? incomeColumns : organizationExpenseColumns} rows={rows} server={tableServer} tableSummary={tableSummary}
      tableHeaderClassName={income ? undefined : "bg-muted/40 [&_tr]:hover:bg-muted/40"}
      searchPlaceholder={income ? "Поиск по приходам…" : "Поиск по расходам…"}
      emptyText={income ? "Приходов пока нет" : "Расходы не найдены"} onRowClick={row => { setExpanded(false); setViewing(row); }}
      rowAriaLabel={income ? undefined : row => `Открыть расход · ${organizationExpensePurpose(row)}`}
      renderMobileCard={row => income
        ? <div className="space-y-2"><div className="flex justify-between gap-2"><b>{formatAmount(row.amount, row.currency)}</b><span>{formatDate(row.paidAt)}</span></div><p>{(row.stockPurchase || row.receiptLines?.length) ? `Приход на склад · ${row.receiptLines?.map(line => line.materialName).join(", ") || row.stockPurchase?.materialName}` : row.project ? `${row.project.number} · ${row.project.title}` : general}</p><p className="text-sm text-muted-foreground">{row.cashAccountName ?? "—"}{row.expenseArticleName ? ` · ${row.expenseArticleName}` : ""}</p></div>
        : <OrganizationExpenseMobileCard row={row} />} />
    <PaymentDialog direction={direction} open={open} onOpenChange={setOpen} projectCurrency="BYN" projectOptions={projects} cashAccounts={cashAccounts} expenseArticles={expenseArticles} />
    {stockMaterials ? <PaymentDialog direction="EXPENSE" open={purchaseOpen} onOpenChange={setPurchaseOpen} projectCurrency="BYN" stockMaterials={stockMaterials} cashAccounts={cashAccounts} expenseArticles={expenseArticles} materialCreateOptions={materialCreateOptions} /> : null}
    <Dialog open={viewing !== null} onOpenChange={next => { if (!next) setViewing(null); }}>
      <DialogContent initialFocus={detailHeading} data-mobile-fullscreen={income ? undefined : true}
        className={income ? undefined : cn(
          "top-[var(--dialog-viewport-top,50%)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 md:[&>[data-slot=dialog-close]]:top-5 md:[&>[data-slot=dialog-close]]:right-5",
          expanded ? "h-[var(--dialog-viewport-height,100dvh)] max-h-none max-w-none rounded-none sm:max-w-none" : "md:min-h-[min(32rem,calc(100dvh-3rem))] md:w-[calc(100%-3rem)] md:max-w-6xl",
        )}>
        <DialogHeader className={income ? undefined : "gap-1 border-b px-4 py-4 pr-16 [overflow-wrap:anywhere] md:px-7 md:py-5 md:pr-24"}>
          <DialogTitle ref={detailHeading} tabIndex={-1} className={cn("outline-none", !income && "text-xl font-semibold")}>{income ? "Приход" : "Расход"}</DialogTitle>
          <DialogDescription className={income ? undefined : "max-h-[24dvh] overflow-y-auto"}>{(viewing?.stockPurchase || viewing?.receiptLines?.length) ? "Оплаченный приход материалов" : viewing && !income ? organizationExpensePurpose(viewing) : viewing?.project ? `${viewing.project.number} · ${viewing.project.title}` : general}</DialogDescription>
          {!income && <Button type="button" size="icon-sm" variant="ghost" data-dialog-size-toggle className="absolute top-5 right-14"
            aria-label={expandLabel} title={expandLabel} onClick={() => setExpanded(current => !current)}>
            {expanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
          </Button>}
        </DialogHeader>
        {viewing ? <dl className={cn("grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm",
          !income && "min-h-0 content-start overflow-y-auto overscroll-contain px-4 py-5 [overflow-wrap:anywhere] md:grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)] md:gap-x-6 md:gap-y-5 md:px-7 md:py-6 [&>dt]:text-muted-foreground")}>
          {!income && <><dt>ID</dt><dd className="select-text break-all font-mono text-xs">{viewing.id}</dd></>}
          <dt>Дата</dt><dd>{formatDate(viewing.paidAt)}</dd><dt>Сумма</dt><dd className={income ? undefined : "font-semibold tabular-nums"}>{formatAmount(viewing.amount, viewing.currency)}</dd>
          {(income || viewing.currency !== INTERNAL_CURRENCY) && <><dt>Эквивалент BYN</dt><dd>{formatAmount(viewing.bynAmount, INTERNAL_CURRENCY)}</dd></>}
          {!income && <><dt>Курс / дата</dt><dd>{viewing.rate} / {viewing.rateDate ? formatDate(viewing.rateDate) : "—"}</dd></>}
          <dt>Касса</dt><dd>{viewing.cashAccountName ?? "—"}</dd>
          {!income ? <><dt>Статья</dt><dd>{viewing.expenseArticleName ?? "—"}</dd></> : null}
          <dt className={longFieldLabel}>Комментарий</dt><dd className={cn("whitespace-pre-wrap break-words", longFieldValue)}>{viewing.comment ?? "—"}</dd>
          {viewing.stockPurchase ? <>
            <dt className={longFieldLabel}>Приход на склад</dt><dd className={cn("break-words", longFieldValue)}>{viewing.stockPurchase.materialName}</dd>
            <dt>Количество</dt><dd>{formatQty(viewing.stockPurchase.quantity)} {viewing.stockPurchase.unit}</dd>
            <dt>Цена единицы</dt><dd>{formatAmount(viewing.stockPurchase.unitPrice, viewing.currency)}</dd>
            <dt>Стоимость запаса</dt><dd>{formatMoneyTotal(viewing.stockPurchase.stockValueByn,"BYN")}</dd>
            <dt>Движение</dt><dd className="break-all">{viewing.stockPurchase.movementId}</dd>
            <dd className="col-span-full text-muted-foreground">Оплата связана с приходом на склад. Отдельно удалить её нельзя.</dd>
          </> : null}
          {!viewing.stockPurchase && viewing.receiptLines?.length ? <>
            <dt className={longFieldLabel}>Приход на склад</dt><dd className={longFieldValue}><ul className="space-y-2">{viewing.receiptLines.map(line =>
              <li key={line.movementId} className="break-words"><b>{line.materialName}</b> · {formatQty(line.quantity)} {line.unit}<br/>
                {formatAmount(Number(line.amount), viewing.currency)} · {formatMoneyTotal(line.stockValueByn === null ? null : Number(line.stockValueByn), "BYN")}
                <div className="text-muted-foreground">Цена единицы {line.unitPrice.replace(".", ",")} {viewing.currency} · Движение {line.movementId}</div>
              </li>)}</ul></dd>
          </> : null}
          {(viewing.reportDocument || viewing.reportDocuments?.length) ? <><dt className={longFieldLabel}>{income ? "Документ" : "Документы"}</dt><dd className={longFieldValue}><ReportDocumentButton document={viewing.reportDocument} documents={viewing.reportDocuments}/></dd></> : null}
          {viewing.logisticsTripId ? <dd className="col-span-full text-muted-foreground"><Link href={`/logistics/${viewing.logisticsTripId}`} className="underline">Расход относится к общему рейсу</Link>. Исправления выполняются в логистике.</dd> : null}
        </dl> : null}
        <DialogFooter className={income ? undefined : "m-0 flex-row flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-none px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:justify-between md:px-7"}>
          {viewing && renderDetailActions && (
            <div className={income ? "contents" : "flex min-w-0 flex-wrap items-center gap-2 empty:hidden [&>button]:max-w-full [&>button]:whitespace-normal"}>
              {renderDetailActions(viewing, () => setViewing(null))}
            </div>
          )}
          {income ? <>{closeDetailButton}{deleteDetailButton}</> : (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {deleteDetailButton}
              {closeDetailButton}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDeleteDialog open={deleting !== null} onOpenChange={next => { if (!next) setDeleting(null); }} entityLabel={noun}
      warning={income ? "Удаление возможно только без отрицательного остатка кассы и организации." : undefined}
      onConfirm={async () => { if (!deleting) return false; const result = await deletePayment(deleting.id);
        if (!result.ok) { toast.error(result.error ?? "Ошибка удаления"); return false; } setDeleting(null); router.refresh(); return true; }} />
  </section>;
}
