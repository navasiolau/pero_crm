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
  defaultPageSize = 10,
}: {
  columns: DataColumn<TRow>[];
  rows: TRow[];
  searchPlaceholder?: string;
  emptyText?: string;
  onRowClick?: (row: TRow) => void;
  defaultPageSize?: number;
}) {
  const [query, setQuery] = useState("");
  const [sortId, setSortId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const filtered = useMemo(() => {
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
  }, [rows, columns, query, sortId, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize,
  );

  function toggleSort(column: DataColumn<TRow>) {
    if (!column.sortable || !column.sortValue) return;
    setPage(0);
    if (sortId === column.id) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortId(column.id);
      setSortDir("asc");
    }
  }

  return (
    <div className="flex flex-col gap-3">
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

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.id} className={column.headerClassName}>
                  {column.sortable && column.sortValue ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort(column)}
                    >
                      {column.header}
                      {sortId === column.id ? (
                        sortDir === "asc" ? (
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
                className={cn(onRowClick && "cursor-pointer")}
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
        <div className="flex items-center gap-2">
          <span>На странице:</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              setPageSize(Number(value ?? 10));
              setPage(0);
            }}
          >
            <SelectTrigger className="h-8 w-20">
              <SelectValue>{pageSize}</SelectValue>
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
            · {filtered.length}{" "}
            {filtered.length === 1 ? "запись" : "записей"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
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
            onClick={() => setPage(safePage + 1)}
          >
            Вперёд
          </Button>
        </div>
      </div>
    </div>
  );
}
