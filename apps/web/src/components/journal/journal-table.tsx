"use client";

import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn, type DataTableServerState } from "@/components/ui/data-table";
import type { JournalListRow } from "@/server/changelog/query-contract";

export type JournalEntrySection = "summary" | "changes";

export function journalTime(value: string): string {
  return new Date(value).toLocaleString("ru-RU");
}

function changeCountLabel(count: number): string {
  const ending = count % 100 >= 11 && count % 100 <= 14 ? "полей" : count % 10 === 1 ? "поле" : count % 10 >= 2 && count % 10 <= 4 ? "поля" : "полей";
  return `${count} ${ending}`;
}

export function JournalTable({ entries, server, onOpen }: {
  entries: JournalListRow[];
  server: DataTableServerState;
  onOpen: (row: JournalListRow, section: JournalEntrySection, opener?: HTMLElement) => void;
}) {
  const comparison = (row: JournalListRow) => row.hasChanges ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-muted-foreground">{changeCountLabel(row.changeCount)}</span>
      <Button type="button" variant="outline" size="sm" onClick={event => {
        event.stopPropagation(); onOpen(row, "changes", event.currentTarget);
      }}>Показать изменения</Button>
    </div>
  ) : <span className="text-muted-foreground">—</span>;
  const columns: DataColumn<JournalListRow>[] = [
    { id: "time", header: "Время", sortable: true,
      cell: row => <time dateTime={row.createdAt} className="whitespace-nowrap text-muted-foreground">{journalTime(row.createdAt)}</time> },
    { id: "actor", header: "Пользователь", sortable: true,
      cell: row => <span className="break-words">{row.actorName}</span> },
    { id: "entity", header: "Сущность", sortable: true,
      cell: row => <span className="break-words font-medium">{row.entityLabel}</span> },
    { id: "action", header: "Действие", sortable: true, cell: row => row.actionLabel },
    { id: "values", header: "Было → стало", cell: comparison },
  ];
  return <DataTable columns={columns} rows={entries} server={server}
    emptyText="По фильтру ничего не найдено" defaultPageSize={20}
    onRowClick={row => onOpen(row, "summary")}
    rowAriaLabel={row => `Открыть событие: ${row.entityLabel}, ${row.actionLabel}, ${journalTime(row.createdAt)}`}
    renderMobileCard={row => <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="break-words font-medium">{row.entityLabel}</span>
        <time dateTime={row.createdAt} className="text-xs text-muted-foreground">{journalTime(row.createdAt)}</time>
      </div>
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Пользователь</dt><dd className="break-words">{row.actorName}</dd>
        <dt className="text-muted-foreground">Действие</dt><dd className="break-words">{row.actionLabel}</dd>
      </dl>
      {comparison(row)}
    </div>}
  />;
}
