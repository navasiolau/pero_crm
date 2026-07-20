"use client";

import { TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import { daysOnStage, stageLabels, stageStyles } from "@/lib/stages";

import { formatAmount } from "./kanban-board";
import type { ProjectCard } from "./projects-view";

// Табличный вид проектов (§7): поиск, сортировка, пагинация.
export function ProjectsTable({
  projects,
  showAmount,
  onOpen,
}: {
  projects: ProjectCard[];
  showAmount: boolean;
  onOpen: (id: string) => void;
}) {
  const columns: DataColumn<ProjectCard>[] = [
    {
      id: "number",
      header: "Номер",
      sortable: true,
      sortValue: (row) => row.number,
      cell: (row) => <span className="font-medium">{row.number}</span>,
    },
    {
      id: "client",
      header: "Клиент",
      sortable: true,
      sortValue: (row) => row.clientName,
      cell: (row) => row.clientName,
    },
    {
      id: "title",
      header: "Изделие",
      sortable: true,
      sortValue: (row) => row.title,
      cell: (row) => row.title,
    },
    {
      id: "stage",
      header: "Этап",
      sortable: true,
      sortValue: (row) => stageLabels[row.stage],
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
      id: "manager",
      header: "Менеджер",
      sortable: true,
      sortValue: (row) => row.managerName ?? "",
      cell: (row) => (
        <span className="text-muted-foreground">{row.managerName ?? "—"}</span>
      ),
    },
    ...(showAmount
      ? [
          {
            id: "amount",
            header: "Сумма",
            sortable: true,
            sortValue: (row: ProjectCard) => Number(row.expectedPrice ?? 0),
            headerClassName: "text-right",
            className: "text-right",
            cell: (row: ProjectCard) => formatAmount(row.expectedPrice, row.currency),
          } satisfies DataColumn<ProjectCard>,
        ]
      : []),
  ];

  return (
    <DataTable
      columns={columns}
      rows={projects}
      searchPlaceholder="Поиск проекта…"
      onRowClick={(row) => onOpen(row.id)}
      emptyText="Проектов пока нет — создайте первый"
    />
  );
}
