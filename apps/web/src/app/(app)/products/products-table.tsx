"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProductStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { formatAmount } from "@/lib/format";
import { productStatusLabels, productStatusStyles } from "@/lib/product-statuses";
import { cn } from "@/lib/utils";

export interface ProductRow {
  id: string;
  number: string;
  title: string;
  status: ProductStatus;
  expectedPrice: string | null;
  currency: string;
  projectId: string;
  projectNumber: string;
  projectTitle: string;
  clientName: string;
}

// Общая таблица изделий (§15): все изделия организации со ссылкой
// на проект и карточку изделия.
export function ProductsTable({
  products,
  showAmount,
}: {
  products: ProductRow[];
  showAmount: boolean;
}) {
  const router = useRouter();

  const columns: DataColumn<ProductRow>[] = [
    {
      id: "number",
      header: "Номер",
      sortable: true,
      sortValue: (row) => row.number,
      cell: (row) => <span className="font-medium">{row.number}</span>,
    },
    {
      id: "title",
      header: "Название",
      sortable: true,
      sortValue: (row) => row.title,
      cell: (row) => row.title,
    },
    {
      id: "project",
      header: "Проект",
      sortable: true,
      sortValue: (row) => `${row.projectNumber} ${row.projectTitle}`,
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
      sortValue: (row) => row.clientName,
      cell: (row) => <span className="text-muted-foreground">{row.clientName}</span>,
    },
    {
      id: "status",
      header: "Статус",
      sortable: true,
      sortValue: (row) => productStatusLabels[row.status],
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
            sortValue: (row: ProductRow) => Number(row.expectedPrice ?? 0),
            headerClassName: "text-right",
            className: "text-right",
            cell: (row: ProductRow) => formatAmount(row.expectedPrice, row.currency),
          } satisfies DataColumn<ProductRow>,
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Изделия</h1>
        <p className="text-sm text-muted-foreground">
          Все изделия организации — клик по строке открывает карточку изделия
        </p>
      </div>
      <DataTable
        columns={columns}
        rows={products}
        searchPlaceholder="Поиск изделия…"
        onRowClick={(row) => router.push(`/products/${row.id}`)}
        emptyText="Изделий пока нет — добавьте их в карточке проекта"
      />
    </div>
  );
}
