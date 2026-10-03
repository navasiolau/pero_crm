"use client";
import { CardNumber } from "@/components/card-number";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { globalProductsHref, productDetailHref } from "@/lib/product-return-navigation";
import { useListParams } from "@/lib/list-params";
import { productLineTotal } from "@/lib/product-quantity";
import { formatAmount } from "@/lib/format";
import { productStatusLabels, productStatusStyles } from "@/lib/product-statuses";
import { cn } from "@/lib/utils";

import type { ProductRow } from "./products-view";

// Табличный вид изделий (§15): сортировка/пагинация — серверные
// (события → URL), поиск — в фильтр-баре над таблицей.
export function ProductsTable({
  products,
  total,
  page,
  pageSize,
  showAmount,
}: {
  products: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
  showAmount: boolean;
}) {
  const router = useRouter();
  const { get, set, query } = useListParams();
  const productHref = (number: string) => productDetailHref(number, globalProductsHref(query));

  const columns: DataColumn<ProductRow>[] = [
    {
      id: "number",
      header: "Номер",
      sortable: true,
      cell: (row) => <span className="font-medium">{row.number}</span>,
    },
    {
      id: "title",
      header: "Название",
      sortable: true,
      cell: (row) => (
        <span className="flex flex-col">
          <span>{row.title}</span>
          {row.kind ? (
            <span className="text-xs text-muted-foreground">{row.kind}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "project",
      header: "Проект",
      sortable: true,
      cell: (row) => (
        <Link
          href={`/projects/${row.projectId}`}
          className="underline-offset-2 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.projectNumber} · {row.projectTitle}
        </Link>
      ),
    },
    {
      id: "client",
      header: "Клиент",
      sortable: true,
      cell: (row) => <span className="text-muted-foreground">{row.clientName}</span>,
    },
    {
      id: "engineer",
      header: "Инженер",
      sortable: true,
      sortValue: (row) => row.engineerName ?? "",
      cell: (row) => (
        <span className="text-muted-foreground">{row.engineerName ?? "—"}</span>
      ),
    },
    {
      id: "status",
      header: "Статус",
      sortable: true,
      cell: (row) => (
        <Badge
          variant="outline"
          className={cn("border-transparent", productStatusStyles[row.status].badge)}
        >
          {productStatusLabels[row.status]}
        </Badge>
      ),
    },
    { id: "quantity", header: "Количество", sortable: true, cell: (row) => `${row.quantity} шт.` },
    ...(showAmount
      ? [
          {
            id: "price",
            header: "Цена за 1 шт.",
            sortable: true,
            headerClassName: "text-right",
            className: "text-right",
            cell: (row: ProductRow) => formatAmount(row.expectedPrice, row.currency),
          } satisfies DataColumn<ProductRow>,
          { id: "sum", header: "Сумма", headerClassName: "text-right", className: "text-right",
            cell: (row: ProductRow) => formatAmount(productLineTotal(row.expectedPrice, row.quantity), row.currency) } satisfies DataColumn<ProductRow>,
        ]
      : []),
  ];

  return (
    <DataTable
      columns={columns}
      rows={products}
      renderMobileCard={(row) => (
        <div className="flex flex-col items-start gap-3 text-sm">
          <Link href={productHref(row.number)} className="min-h-12 w-full min-w-0 font-medium underline-offset-2 [overflow-wrap:anywhere] hover:underline">
            <span className="block text-xs text-muted-foreground">Изделие <CardNumber>{row.number}</CardNumber></span>
            {row.title}
          </Link>
          {row.kind && <span className="text-xs text-muted-foreground">{row.kind}</span>}
          <Badge variant="outline" className={cn("border-transparent", productStatusStyles[row.status].badge)}>{productStatusLabels[row.status]}</Badge>
          <dl className="flex w-full flex-col gap-2">
            <div><dt className="text-xs text-muted-foreground">Проект</dt><dd><Link className="block min-h-11 underline-offset-2 hover:underline" href={`/projects/${row.projectId}`}>{row.projectNumber} · {row.projectTitle}</Link></dd></div>
            <div><dt className="text-xs text-muted-foreground">Клиент</dt><dd>{row.clientName}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Инженер</dt><dd>{row.engineerName ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Количество</dt><dd>{row.quantity} шт.</dd></div>
            {showAmount && <div><dt className="text-xs text-muted-foreground">Цена за 1 шт.</dt><dd>{formatAmount(row.expectedPrice, row.currency)}</dd></div>}
            {showAmount && <div><dt className="text-xs text-muted-foreground">Сумма</dt><dd>{formatAmount(productLineTotal(row.expectedPrice, row.quantity), row.currency)}</dd></div>}
          </dl>
        </div>
      )}
      emptyText="Изделий не найдено — ослабьте фильтры"
      onRowClick={(row) => router.push(productHref(row.number))}
      server={{
        total,
        page,
        pageSize,
        sort: get("sort") || "number",
        dir: get("dir") === "asc" ? "asc" : "desc",
        onPageChange: (next) => set({ page: String(next) }),
        onSortChange: (columnId, dir) =>
          set({ sort: columnId, dir, page: null }),
        onPageSizeChange: (size) => set({ pageSize: String(size), page: null }),
      }}
    />
  );
}
