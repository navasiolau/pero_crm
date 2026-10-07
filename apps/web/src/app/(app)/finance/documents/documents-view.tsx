"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FinanceDocumentUpload } from "@/components/finance-document-upload";
import { useFileViewer } from "@/components/file-viewer";
import type { FinanceDocumentListInput, FinanceDocumentView } from "@/server/finance-documents/contracts";

const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

export function FinanceDocumentsView({ rows, total, query }: { rows: FinanceDocumentView[]; total: number; query: FinanceDocumentListInput }) {
  const router = useRouter(), viewer = useFileViewer();
  function navigate(changes: Partial<FinanceDocumentListInput>) {
    const next = { ...query, ...changes }, params = new URLSearchParams({ page: String(next.page), pageSize: String(next.pageSize),
      q: next.query, sort: next.sort, dir: next.direction });
    router.push(`/finance/documents?${params}`);
  }
  const columns: DataColumn<FinanceDocumentView>[] = [
    { id: "fileName", header: "Документ", sortable: true, sortValue: row => row.fileName, cell: row => <span className="break-all font-medium">{row.fileName}</span> },
    { id: "createdAt", header: "Загружен", sortable: true, sortValue: row => row.createdAt, cell: row => date(row.createdAt) },
    { id: "size", header: "Размер", cell: row => size(row.size) },
    { id: "payment", header: "Использование", cell: row => row.paymentId ? "Прикреплён к платежу" : "Не прикреплён" },
  ];
  return <section className="min-w-0 space-y-5">
    <div><Link href="/finance" className="text-sm text-muted-foreground hover:underline">Финансы</Link><h1 className="mt-1 text-2xl font-semibold">Отчётные документы</h1></div>
    <div className="max-w-2xl"><FinanceDocumentUpload onUploaded={() => router.refresh()} /></div>
    <form key={query.query} className="flex max-w-2xl gap-2" onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget); navigate({ query: String(data.get("q") ?? ""), page: 1 });
    }}>
      <Input name="q" defaultValue={query.query} maxLength={200} placeholder="Поиск по имени документа…" aria-label="Поиск документов" />
      <Button type="submit" variant="outline"><Search className="size-4" /><span className="sr-only sm:not-sr-only">Найти</span></Button>
    </form>
    <DataTable columns={columns} rows={rows} onRowClick={row => viewer.open(row)} emptyText="Документов пока нет"
      server={{ total, page: query.page, pageSize: query.pageSize, sort: query.sort, dir: query.direction,
        onPageChange: page => navigate({ page }), onPageSizeChange: pageSize => navigate({ pageSize, page: 1 }),
        onSortChange: (columnId, direction) => navigate({ sort: columnId === "fileName" ? "fileName" : "createdAt", direction, page: 1 }) }}
      renderMobileCard={row => <div className="space-y-1"><p className="break-all font-medium">{row.fileName}</p><p className="text-sm text-muted-foreground">{date(row.createdAt)} · {size(row.size)}</p><p className="text-sm">{row.paymentId ? "Прикреплён к платежу" : "Не прикреплён"}</p></div>} />
    {viewer.viewer}
  </section>;
}
