"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {ReportDocumentButton} from "@/components/report-document-button";
import { formatAmount, formatDate, formatMoneyTotal } from "@/lib/format";
import type { PaymentRow, ProjectExpenseRow } from "@/server/finance/contracts";
import type { ExpenseBreakdownRow } from "@/server/finance/project-expense-facts";

const sourceLabel = { PAYMENT: "Денежный расход", WAREHOUSE_ISSUE: "Выдача со склада", WAREHOUSE_RETURN: "Возврат на склад" };
const precise = (value: string) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 9 }).format(Number(value));

export function ProjectExpenseLedger({ rows, breakdown, onDelete }: {
  rows: ProjectExpenseRow[]; breakdown: ExpenseBreakdownRow[]; onDelete?: (payment: PaymentRow) => void;
}) {
  const [article, setArticle] = useState("all");
  const [viewing, setViewing] = useState<ProjectExpenseRow | null>(null);
  const groups = breakdown.filter(row => row.key !== "payroll");
  const selected = article === "all" ? rows : rows.filter(row => row.article.key === article);
  const documentButton = (row: ProjectExpenseRow) => row.payment?.reportDocument
    ? <ReportDocumentButton document={row.payment.reportDocument} /> : "—";
  const columns: DataColumn<ProjectExpenseRow>[] = [
    { id: "date", header: "Дата", sortable: true, sortValue: row => row.date, cell: row => formatDate(row.date) },
    { id: "source", header: "Операция", searchValue: row => sourceLabel[row.source], cell: row => sourceLabel[row.source] },
    { id: "article", header: "Статья", sortable: true, sortValue: row => row.article.label, cell: row => row.article.label },
    { id: "material", header: "Изделие / материал", searchValue: row => row.stock ? `${row.stock.product?.number ?? ""} ${row.stock.materialName}` : row.payment?.cashAccountName ?? "",
      cell: row => row.stock ? <div><div>{row.stock.product?.number ?? "—"} · {row.stock.materialName}</div><div className="text-xs text-muted-foreground">{precise(row.stock.quantity)} {row.stock.unit} × {row.stock.unitPrice === null ? "Нет данных" : `${precise(row.stock.unitPrice)} BYN`}</div></div> : row.payment?.cashAccountName ?? "—" },
    { id: "amount", header: "Расход, BYN", sortable: true, sortValue: row => row.bynAmount ?? Number.NEGATIVE_INFINITY, className: "text-right font-medium",
      cell: row => <div>{formatMoneyTotal(row.bynAmount, "BYN")}{row.payment && row.payment.currency !== "BYN" ? <p className="text-xs text-muted-foreground">{formatAmount(row.payment.amount, row.payment.currency)}</p> : null}</div> },
    { id: "author", header: "Кто внёс", searchValue: row => row.createdByName ?? "", cell: row => row.createdByName ?? "—" },
    { id: "comment", header: "Комментарий", searchValue: row => row.comment ?? "", cell: row => row.comment ?? "—" },
    { id: "document", header: "Отчетный документ", searchValue: row => row.payment?.reportDocument?.fileName ?? "", cell: documentButton },
    { id: "actions", header: "", cell: row => <Button variant="ghost" onClick={event => { event.stopPropagation(); setViewing(row); }}>Открыть</Button> },
  ];
  return <div className="flex min-w-0 flex-col gap-3">
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex min-w-0 flex-col gap-1 text-sm">Статья расходов
        <select className="h-9 max-w-full rounded-md border bg-background px-3" value={article} onChange={event => setArticle(event.target.value)}>
          <option value="all">Все статьи</option>
          {groups.map((group, index) => <option key={group.key} value={group.key}>{group.label}{groups.some((other, otherIndex) => index !== otherIndex && other.label === group.label) ? ` (${group.key.startsWith("article:") ? group.key.slice(8) : "склад"})` : ""}</option>)}
        </select>
      </label>
      {article !== "all" ? <p className="pb-2 text-sm">По статье: <strong>{formatMoneyTotal(groups.find(group => group.key === article)?.amount ?? null, "BYN")}</strong></p> : null}
    </div>
    <DataTable columns={columns} rows={selected} searchPlaceholder="Поиск по расходам…" emptyText="Расходов по проекту пока нет" onRowClick={setViewing}
      renderMobileCard={row => <div className="space-y-1"><div className="flex justify-between gap-2"><b>{formatMoneyTotal(row.bynAmount, "BYN")}</b><span>{formatDate(row.date)}</span></div><p>{sourceLabel[row.source]} · {row.article.label}</p>{row.stock ? <p>{row.stock.product?.number} · {row.stock.materialName} · {precise(row.stock.quantity)} {row.stock.unit}</p> : <p>{row.payment?.cashAccountName ?? "—"}</p>}</div>} />
    <Dialog open={viewing !== null} onOpenChange={open => { if (!open) setViewing(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader>
        <DialogTitle>{viewing ? sourceLabel[viewing.source] : "Расход"}</DialogTitle>
        <DialogDescription>{viewing?.stock ? "Исходное складское движение. Его сохранённая стоимость учтена в расходах проекта." : "Исходная денежная операция проекта."}</DialogDescription>
      </DialogHeader>
        {viewing ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
          <dt>Дата</dt><dd>{formatDate(viewing.date)}</dd><dt>Статья</dt><dd>{viewing.article.label}</dd>
          <dt>Расход, BYN</dt><dd>{formatMoneyTotal(viewing.bynAmount, "BYN")}</dd>
          {viewing.stock ? <><dt>Изделие</dt><dd>{viewing.stock.product?.number ?? "—"}</dd><dt>Материал</dt><dd className="break-words">{viewing.stock.materialName}</dd>
            <dt>Количество</dt><dd>{precise(viewing.stock.quantity)} {viewing.stock.unit}</dd><dt>Учётная цена</dt><dd>{viewing.stock.unitPrice === null ? "Нет данных" : `${precise(viewing.stock.unitPrice)} BYN`}</dd>
            {viewing.stock.sourceMovementId ? <><dt>Исходная выдача</dt><dd><Button variant="link" className="h-auto whitespace-normal break-all p-0" onClick={() => {
              const original = rows.find(row => row.sourceId === viewing.stock?.sourceMovementId && row.source === "WAREHOUSE_ISSUE");
              if (original) setViewing(original);
            }} disabled={!rows.some(row => row.sourceId === viewing.stock?.sourceMovementId && row.source === "WAREHOUSE_ISSUE")}>{viewing.stock.sourceMovementId}</Button></dd></> : null}
          </> : <><dt>Касса</dt><dd>{viewing.payment?.cashAccountName ?? "—"}</dd><dt>Сумма</dt><dd>{viewing.payment ? formatAmount(viewing.payment.amount, viewing.payment.currency) : "—"}</dd><dt>Отчетный документ</dt><dd>{documentButton(viewing)}</dd></>}
          <dt>Кто внёс</dt><dd>{viewing.createdByName ?? "—"}</dd><dt>Комментарий</dt><dd className="whitespace-pre-wrap break-words">{viewing.comment ?? "—"}</dd>
          <dt>Операция</dt><dd className="break-all text-muted-foreground">{viewing.sourceId}</dd>
        </dl> : null}
        <DialogFooter><Button variant="outline" onClick={() => setViewing(null)}>Закрыть</Button>
          {viewing?.payment?.logisticsTripId ? <span className="text-sm text-muted-foreground">Расход исправляется в логистике</span> : viewing?.payment && onDelete ? <Button variant="destructive" onClick={() => { onDelete(viewing.payment!); setViewing(null); }}>Удалить расход</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

