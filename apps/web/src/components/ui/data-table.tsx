"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface DataColumn<TRow> {
  id: string;
  header: string;
  cell: (row: TRow) => ReactNode;
  sortable?: boolean;
  sortValue?: (row: TRow) => string | number;
  /** Строки для поиска; если не задано — используется sortValue */
  searchValue?: (row: TRow) => string;
  className?: string;
  headerClassName?: string;
}

/** Сервер-режим: поиск/сортировка/пагинация живут снаружи (в URL),
 * таблица только отображает страницу и отдаёт события. */
export interface DataTableServerState {
  total: number;
  page: number; // 1-based
  pageSize: number;
  sort: string | null;
  dir: "asc" | "desc";
  onPageChange: (page: number) => void;
  onSortChange: (columnId: string, dir: "asc" | "desc") => void;
  onPageSizeChange?: (size: number) => void;
}

// Универсальная таблица: поиск по строкам, сортировка по клику на заголовок,
// пагинация с выбором размера страницы. Использовать для ВСЕХ табличных
// списков сущностей (§ревью: таблица ≠ полная информация, но обязана
// искать, сортировать и листать).
export function DataTable<TRow extends { id: string }>({
  columns,
  rows,
  searchPlaceholder = "Поиск…",
  emptyText = "Ничего не найдено",
  onRowClick,
  rowClassName,
  defaultPageSize = 10,
  server,
  renderMobileCard,
}: {
  columns: DataColumn<TRow>[];
  rows: TRow[];
  searchPlaceholder?: string;
  emptyText?: string;
  onRowClick?: (row: TRow) => void;
  /** Доп. класс строки по условию (напр. подсветка нехватки материалов) */
  rowClassName?: (row: TRow) => string | undefined;
  defaultPageSize?: number;
  /** Сервер-режим: поиск/сортировка/пагинация — снаружи (в URL) */
  server?: DataTableServerState;
  /** Карточный вид до 768 px; данные, сортировка и пагинация общие. */
  renderMobileCard?: (row: TRow) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [sortId, setSortId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const filtered = useMemo(() => {
    // Сервер-режим: данные уже отфильтрованы и отсортированы на сервере
    if (server) return rows;
    const needle = query.trim().toLowerCase();
    let result = rows;
    if (needle) {
      result = result.filter((row) =>
        columns.some((column) => {
          const getter = column.searchValue ?? column.sortValue;
          if (!getter) return false;
          return String(getter(row)).toLowerCase().includes(needle);
        }),
      );
    }
    if (sortId) {
      const column = columns.find((item) => item.id === sortId);
      if (column?.sortValue) {
        const getter = column.sortValue;
        result = [...result].sort((a, b) => {
          const va = getter(a);
          const vb = getter(b);
          const cmp =
            typeof va === "number" && typeof vb === "number"
              ? va - vb
              : String(va).localeCompare(String(vb), "ru");
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }
    return result;
  }, [rows, columns, query, sortId, sortDir, server]);

  const totalCount = server ? server.total : filtered.length;
  const activePageSize = server ? server.pageSize : pageSize;
  const pageCount = Math.max(1, Math.ceil(totalCount / activePageSize));
  const localSafePage = Math.min(page, pageCount - 1);
  const safePage = server ? server.page - 1 : localSafePage;
  const pageRows = server
    ? filtered
    : filtered.slice(safePage * activePageSize, safePage * activePageSize + activePageSize);

  // Клик по заголовку: клиентский режим крутит локальную сортировку,
  // серверный — отдаёт событие наверх (в URL)
  function toggleSort(column: DataColumn<TRow>) {
    if (!column.sortable) return;
    if (server) {
      if (server.sort === column.id) {
        server.onSortChange(column.id, server.dir === "asc" ? "desc" : "asc");
      } else {
        server.onSortChange(column.id, "asc");
      }
      return;
    }
    if (!column.sortValue) return;
    setPage(0);
    if (sortId === column.id) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortId(column.id);
      setSortDir("asc");
    }
  }

  const activeSortId = server ? server.sort : sortId;
  const activeSortDir = server ? server.dir : sortDir;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {server ? null : (
        <div className="relative max-w-sm">
          <Search className="absolute top-2.5 left-2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder={searchPlaceholder}
            className="pl-8"
          />
        </div>
      )}

      {renderMobileCard ? (
        <div className="flex min-w-0 flex-col gap-3 md:hidden">
          <label className="flex min-w-0 flex-col gap-1 text-sm">
            Сортировка
            <select
              aria-label="Сортировка"
              className="min-h-12 w-full min-w-0 rounded-lg border bg-background px-2 text-sm"
              value={activeSortId ? `${activeSortId}:${activeSortDir}` : ""}
              onChange={(event) => {
                const [id, direction] = event.target.value.split(":");
                const dir = direction === "desc" ? "desc" : "asc";
                if (server) server.onSortChange(id, dir);
                else { setSortId(id); setSortDir(dir); setPage(0); }
              }}
            >
              {!activeSortId && <option value="">По умолчанию</option>}
              {columns.filter((column) => column.sortable && (server || column.sortValue)).flatMap((column) => [
                <option key={`${column.id}:asc`} value={`${column.id}:asc`}>{column.header} ↑</option>,
                <option key={`${column.id}:desc`} value={`${column.id}:desc`}>{column.header} ↓</option>,
              ])}
            </select>
          </label>
          {pageRows.map((row) => <article key={row.id} data-slot="mobile-list-card" className={cn("rounded-xl border p-4", rowClassName?.(row))}>{renderMobileCard(row)}</article>)}
          {pageRows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>}
        </div>
      ) : null}

      <div className={cn("min-w-0 rounded-xl border", renderMobileCard && "hidden md:block")}>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.id} className={column.headerClassName}>
                  {column.sortable && (column.sortValue || server) ? (
                    <button
                      type="button"
                      className={cn(
                        "flex items-center gap-1 hover:text-foreground",
                        column.headerClassName?.includes("text-right") &&
                          "w-full justify-end",
                      )}
                      onClick={() => toggleSort(column)}
                    >
                      {column.header}
                      {activeSortId === column.id ? (
                        activeSortDir === "asc" ? (
                          <ArrowUp className="size-3.5" />
                        ) : (
                          <ArrowDown className="size-3.5" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3.5 opacity-40" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(onRowClick && "cursor-pointer", rowClassName?.(row))}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((column) => (
                  <TableCell key={column.id} className={column.className}>
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="py-12 text-center text-muted-foreground"
                >
                  {emptyText}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span>На странице:</span>
          <Select
            value={String(activePageSize)}
            onValueChange={(value) => {
              const size = Number(value ?? 10);
              if (server?.onPageSizeChange) {
                server.onPageSizeChange(size);
                return;
              }
              setPageSize(size);
              setPage(0);
            }}
          >
            <SelectTrigger className="h-8 w-20">
              <SelectValue>{activePageSize}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>
            · {totalCount} {totalCount === 1 ? "запись" : "записей"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={safePage === 0}
            onClick={() =>
              server ? server.onPageChange(safePage) : setPage(safePage - 1)
            }
          >
            Назад
          </Button>
          <span>
            Стр. {safePage + 1} из {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={safePage >= pageCount - 1}
            onClick={() =>
              server ? server.onPageChange(safePage + 2) : setPage(safePage + 1)
            }
          >
            Вперёд
          </Button>
        </div>
      </div>
    </div>
  );
}
