"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

export interface ChangeLogRow {
  id: string;
  createdAt: string;
  actorName: string;
  actorType: string;
  entity: string;
  entityId: string;
  action: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  source: string;
}

const ACTOR_TYPE_LABELS: Record<string, string> = {
  user: "пользователь",
  plugin: "плагин",
  system: "система",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

// Таблица журнала изменений (§5): поиск, сортировка, пагинация.
export function ChangelogTable({ entries }: { entries: ChangeLogRow[] }) {
  const columns: DataColumn<ChangeLogRow>[] = [
    {
      id: "time",
      header: "Время",
      sortable: true,
      sortValue: (row) => row.createdAt,
      cell: (row) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {new Date(row.createdAt).toLocaleString("ru-RU")}
        </span>
      ),
    },
    {
      id: "actor",
      header: "Кто",
      sortable: true,
      sortValue: (row) => row.actorName,
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          <span>{row.actorName}</span>
          <Badge variant="outline" className="w-fit">
            {ACTOR_TYPE_LABELS[row.actorType] ?? row.actorType}
          </Badge>
        </div>
      ),
    },
    {
      id: "entity",
      header: "Сущность",
      sortable: true,
      sortValue: (row) => `${row.entity}:${row.entityId}`,
      cell: (row) => (
        <code>
          {row.entity}:{row.entityId}
        </code>
      ),
    },
    {
      id: "action",
      header: "Действие",
      sortable: true,
      sortValue: (row) => row.action,
      cell: (row) => (
        <span>
          {row.action}
          {row.field ? (
            <span className="text-muted-foreground"> ({row.field})</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "values",
      header: "Было → стало",
      searchValue: (row) =>
        `${formatValue(row.oldValue)} ${formatValue(row.newValue)}`,
      cell: (row) => (
        <span className="block max-w-72">
          <span className="text-muted-foreground">{formatValue(row.oldValue)}</span>
          {" → "}
          <span>{formatValue(row.newValue)}</span>
        </span>
      ),
    },
    {
      id: "source",
      header: "Источник",
      sortable: true,
      sortValue: (row) => row.source,
      cell: (row) => <Badge variant="secondary">{row.source}</Badge>,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={entries}
      searchPlaceholder="Поиск по журналу…"
      emptyText="По фильтру ничего не найдено"
      defaultPageSize={20}
    />
  );
}
