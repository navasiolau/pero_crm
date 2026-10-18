"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { formatQty } from "@/lib/format";
import { projectMaterialStatusLabels } from "@/lib/labels";

import type { ProjectMaterialLineView } from "./materials-tab";

export interface ProductMaterialsGroup {
  productId: string;
  productNumber: string;
  productTitle: string;
  lines: ProjectMaterialLineView[];
}

// Вкладка «Материалы» проекта (§12): сводный read-only агрегат потребности
// по всем изделиям. Правки (запрос/возврат/добавление) — в карточке изделия.
export function MaterialsSummaryTab({
  groups,
}: {
  groups: ProductMaterialsGroup[];
}) {
  const columns: DataColumn<ProjectMaterialLineView>[] = [
    {
      id: "material",
      header: "Материал",
      sortable: true,
      sortValue: (row) => row.materialName,
      searchValue: (row) => `${row.materialName} ${row.materialSku ?? ""}`,
      cell: (row) => (
        <div className="flex flex-col">
          <span>{row.materialName}</span>
          {row.materialSku ? (
            <span className="text-xs text-muted-foreground">{row.materialSku}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "unit",
      header: "Ед.",
      cell: (row) => <span className="text-muted-foreground">{row.unit}</span>,
    },
    {
      id: "quantity",
      header: "Нужно",
      sortable: true,
      sortValue: (row) => row.quantity,
      headerClassName: "text-right",
      className: "text-right",
      cell: (row) => formatQty(row.quantity),
    },
    {
      id: "issued",
      header: "Выдано",
      sortable: true,
      sortValue: (row) => row.issuedQty,
      headerClassName: "text-right",
      className: "text-right",
      cell: (row) => formatQty(row.issuedQty),
    },
    {
      id: "debt",
      header: "Осталось",
      sortable: true,
      sortValue: (row) => row.debt,
      headerClassName: "text-right",
      className: "text-right",
      cell: (row) => formatQty(row.debt),
    },
    {
      id: "status",
      header: "Статус",
      sortable: true,
      sortValue: (row) => projectMaterialStatusLabels[row.status] ?? row.status,
      cell: (row) => (
        <Badge
          variant={
            row.status === "SHORTAGE"
              ? "destructive"
              : row.status === "AVAILABLE"
                ? "default"
                : "secondary"
          }
        >
          {projectMaterialStatusLabels[row.status] ?? row.status}
        </Badge>
      ),
    },
  ];

  const nonEmpty = groups.filter((group) => group.lines.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Сводная потребность по изделиям проекта (только просмотр). Запрос и
        возврат со склада — в карточке изделия, вкладка «Материалы».
      </p>
      {nonEmpty.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          По изделиям проекта материалы не добавлены
        </div>
      ) : (
        nonEmpty.map((group) => (
          <div key={group.productId} className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold">
              <Link
                href={`/products/${group.productId}`}
                className="underline-offset-2 hover:underline"
              >
                {group.productNumber}
              </Link>{" "}
              <span className="font-normal text-muted-foreground">
                · {group.productTitle}
              </span>
            </h3>
            <DataTable
              columns={columns}
              rows={group.lines}
              searchPlaceholder="Поиск по материалам…"
              emptyText="Материалы не добавлены"
              rowClassName={(row) =>
                row.status === "SHORTAGE" ? "bg-red-500/10" : undefined
              }
            />
          </div>
        ))
      )}
    </div>
  );
}
