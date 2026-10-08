"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { PaymentDialog } from "@/components/payment-dialog";
import { useFileViewer } from "@/components/file-viewer";
import { formatAmount, formatDate } from "@/lib/format";
import { deletePayment } from "@/server/payments/actions";
import type { ExpenseArticleOption } from "@/server/finance/contracts";
import type { OrganizationLedgerData, OrganizationPaymentRow } from "@/server/finance/organization-ledger";

export function OrganizationPaymentsView({ direction, rows, cashAccounts, projects, expenseArticles = [] }: OrganizationLedgerData & {
  direction: "INCOME" | "EXPENSE";
  expenseArticles?: ExpenseArticleOption[];
}) {
  const income = direction === "INCOME", noun = income ? "приход" : "расход";
  const title = income ? "Приходы организации" : "Расходы организации";
  const general = income ? "Общий приход организации" : "Общий расход организации";
  const [open, setOpen] = useState(false), [viewing, setViewing] = useState<OrganizationPaymentRow | null>(null);
  const [deleting, setDeleting] = useState<OrganizationPaymentRow | null>(null), router = useRouter(), viewer = useFileViewer();
  const columns: DataColumn<OrganizationPaymentRow>[] = [
    { id: "date", header: "Дата", sortable: true, sortValue: row => row.paidAt, cell: row => formatDate(row.paidAt) },
    { id: "project", header: "Проект", searchValue: row => row.project ? `${row.project.number} ${row.project.title}` : general,
      cell: row => row.project ? <Link className="hover:underline" onClick={event => event.stopPropagation()} href={`/finance/projects/${row.project.id}`}>{row.project.number} · {row.project.title}</Link> : general },
    { id: "cash", header: "Касса", sortable: true, sortValue: row => row.cashAccountName ?? "", cell: row => row.cashAccountName ?? "—" },
    ...(!income ? [{ id: "article", header: "Статья", sortable: true, sortValue: (row: OrganizationPaymentRow) => row.expenseArticleName ?? "", cell: (row: OrganizationPaymentRow) => row.expenseArticleName ?? "—" }] : []),
    { id: "amount", header: "Сумма", sortable: true, sortValue: row => row.amount, className: "text-right", cell: row => formatAmount(row.amount, row.currency) },
    { id: "rate", header: "Курс / дата", cell: row => `${row.rate} / ${row.rateDate ? formatDate(row.rateDate) : "—"}` },
    { id: "byn", header: "Эквивалент BYN", sortable: true, sortValue: row => row.bynAmount, className: "text-right", cell: row => formatAmount(row.bynAmount, "BYN") },
    { id: "comment", header: "Комментарий", searchValue: row => row.comment ?? "", cell: row => row.comment ?? "—" },
    ...(!income ? [{ id: "document", header: "Отчетный документ", searchValue: (row: OrganizationPaymentRow) => row.reportDocument?.fileName ?? "",
      cell: (row: OrganizationPaymentRow) => row.reportDocument ? <Button variant="link" className="h-auto max-w-48 whitespace-normal break-all p-0" onClick={event => {
        event.stopPropagation(); if (row.reportDocument) viewer.open(row.reportDocument);
      }}>{row.reportDocument.fileName}</Button> : "—" }] : []),
    { id: "actions", header: "", cell: row => <Button variant="ghost" disabled={row.project?.archived} onClick={event => { event.stopPropagation(); setDeleting(row); }}>Удалить</Button> },
  ];
  return <section className="flex min-w-0 flex-col gap-5">
    <Link href="/finance" className="text-sm text-muted-foreground">Назад к финансам</Link>
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{title}</h1><Button onClick={() => setOpen(true)}>Добавить {noun}</Button></div>
    <p className="text-sm text-muted-foreground">{income ? "Общий приход без проекта входит в баланс и оборот организации; экономика отдельных проектов не меняется." : "Общие расходы уменьшают кассу и баланс организации. В расходы проектов они автоматически не распределяются."}</p>
    <DataTable columns={columns} rows={rows} searchPlaceholder={income ? "Поиск по приходам…" : "Поиск по расходам…"}
      emptyText={income ? "Приходов пока нет" : "Расходов пока нет"} onRowClick={setViewing}
      renderMobileCard={row => <div className="space-y-1"><div className="flex justify-between gap-2"><b>{formatAmount(row.amount, row.currency)}</b><span>{formatDate(row.paidAt)}</span></div><p>{row.project ? `${row.project.number} · ${row.project.title}` : general}</p><p className="text-sm text-muted-foreground">{row.cashAccountName ?? "—"}{row.expenseArticleName ? ` · ${row.expenseArticleName}` : ""}</p></div>} />
    <PaymentDialog direction={direction} open={open} onOpenChange={setOpen} projectCurrency="BYN" projectOptions={projects} cashAccounts={cashAccounts} expenseArticles={expenseArticles} />
    <Dialog open={viewing !== null} onOpenChange={next => { if (!next) setViewing(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{income ? "Приход" : "Расход"}</DialogTitle><DialogDescription>{viewing?.project ? `${viewing.project.number} · ${viewing.project.title}` : general}</DialogDescription></DialogHeader>
        {viewing ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
          <dt>Дата</dt><dd>{formatDate(viewing.paidAt)}</dd><dt>Сумма</dt><dd>{formatAmount(viewing.amount, viewing.currency)}</dd>
          <dt>Эквивалент BYN</dt><dd>{formatAmount(viewing.bynAmount, "BYN")}</dd><dt>Касса</dt><dd>{viewing.cashAccountName ?? "—"}</dd>
          {!income ? <><dt>Статья</dt><dd>{viewing.expenseArticleName ?? "—"}</dd></> : null}
          <dt>Комментарий</dt><dd className="whitespace-pre-wrap break-words">{viewing.comment ?? "—"}</dd>
          {viewing.reportDocument ? <><dt>Документ</dt><dd><Button variant="link" className="h-auto whitespace-normal break-all p-0" onClick={() => { if (viewing.reportDocument) viewer.open(viewing.reportDocument); }}>{viewing.reportDocument.fileName}</Button></dd></> : null}
        </dl> : null}
        <DialogFooter><Button variant="outline" onClick={() => setViewing(null)}>Закрыть</Button><Button variant="destructive" disabled={viewing?.project?.archived}
          onClick={() => { setDeleting(viewing); setViewing(null); }}>Удалить</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDeleteDialog open={deleting !== null} onOpenChange={next => { if (!next) setDeleting(null); }} entityLabel={noun}
      warning={income ? "Удаление возможно только без отрицательного остатка кассы и организации." : undefined}
      onConfirm={async () => { if (!deleting) return false; const result = await deletePayment(deleting.id);
        if (!result.ok) { toast.error(result.error ?? "Ошибка удаления"); return false; } setDeleting(null); router.refresh(); return true; }} />
    {viewer.viewer}
  </section>;
}
