"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useListParams } from "@/lib/list-params";
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
  const { get, set } = useListParams();

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
    ...(showAmount
      ? [
          {
            id: "price",
            header: "Цена",
            sortable: true,
            headerClassName: "text-right",
            className: "text-right",
            cell: (row: ProductRow) => formatAmount(row.expectedPrice, row.currency),
          } satisfies DataColumn<ProductRow>,
        ]
      : []),
  ];

  return (
    <DataTable
      columns={columns}
      rows={products}
      emptyText="Изделий не найдено — ослабьте фильтры"
      onRowClick={(row) => router.push(`/products/${row.id}`)}
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
