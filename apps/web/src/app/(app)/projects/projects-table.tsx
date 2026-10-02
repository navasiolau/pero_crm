"use client";
import { CardNumber } from "@/components/card-number";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useListParams } from "@/lib/list-params";
import { cn } from "@/lib/utils";
import { daysOnStage, stageLabels, stageStyles } from "@/lib/stages";

import { formatAmount } from "./kanban-board";
import type { ProjectCard } from "./projects-view";

// Табличный вид проектов (§7): сортировка/пагинация — серверные
// (события → URL), поиск — в фильтр-баре над таблицей.
export function ProjectsTable({
  projects,
  total,
  page,
  pageSize,
  showAmount,
  onOpen,
}: {
  projects: ProjectCard[];
  total: number;
  page: number;
  pageSize: number;
  showAmount: boolean;
  onOpen: (id: string) => void;
}) {
  const { get, set } = useListParams();

  const columns: DataColumn<ProjectCard>[] = [
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
      cell: (row) => row.title,
    },
    {
      id: "client",
      header: "Клиент",
      sortable: true,
      cell: (row) => (
        <Link
          href="/clients"
          className="underline-offset-2 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.clientName}
        </Link>
      ),
    },
    {
      id: "stage",
      header: "Статус",
      sortable: true,
      cell: (row) => (
        <span className="flex flex-col items-start gap-1">
          <Badge
            variant="outline"
            className={cn("border-transparent", stageStyles[row.stage].badge)}
          >
            {stageLabels[row.stage]} · {daysOnStage(row.stageChangedAt)} дн.
          </Badge>
          {row.hasMaterialShortage ? (
            <Badge variant="destructive" className="text-xs">
              <TriangleAlert />
              Нехватка материалов
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: "products",
      header: "Изделий",
      sortable: true,
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => row.productsCount,
    },
    {
      id: "manager",
      header: "Менеджер",
      sortable: true,
      cell: (row) => (
        <span className="text-muted-foreground">{row.managerName ?? "—"}</span>
      ),
    },
    ...(showAmount
      ? [
          {
            id: "amount",
            header: "Сумма проекта",
            // Σ цен изделий + доставка/выгрузка/монтаж считается по строкам — сервером не сортируется
            sortable: false,
            headerClassName: "text-right",
            className: "text-right",
            cell: (row: ProjectCard) => formatAmount(row.totalPrice, row.currency),
          } satisfies DataColumn<ProjectCard>,
        ]
      : []),
  ];

  return (
    <DataTable
      columns={columns}
      rows={projects}
      renderMobileCard={(row) => (
        <div className="flex flex-col items-start gap-3 text-sm">
          <Link href={`/projects/${row.id}`} className="min-h-12 w-full min-w-0 font-medium underline-offset-2 [overflow-wrap:anywhere] hover:underline">
            <span className="block text-xs text-muted-foreground">Проект <CardNumber>{row.number}</CardNumber></span>
            {row.title}
          </Link>
          <Badge variant="outline" className={cn("border-transparent", stageStyles[row.stage].badge)}>{stageLabels[row.stage]} · {daysOnStage(row.stageChangedAt)} дн.</Badge>
          {row.hasMaterialShortage && <Badge variant="destructive"><TriangleAlert />Нехватка материалов</Badge>}
          <dl className="flex w-full flex-col gap-2">
            <div><dt className="text-xs text-muted-foreground">Клиент</dt><dd><Link href="/clients" className="block min-h-11 underline-offset-2 hover:underline">{row.clientName}</Link></dd></div>
            <div><dt className="text-xs text-muted-foreground">Менеджер</dt><dd>{row.managerName ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Изделий</dt><dd>{row.productsCount}</dd></div>
            {showAmount && <div><dt className="text-xs text-muted-foreground">Сумма проекта</dt><dd>{formatAmount(row.totalPrice, row.currency)}</dd></div>}
          </dl>
        </div>
      )}
      emptyText="Проектов не найдено — ослабьте фильтры"
      onRowClick={(row) => onOpen(row.id)}
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
