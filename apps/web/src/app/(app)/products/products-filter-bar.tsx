"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import type { ProductStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useListParams } from "@/lib/list-params";
import {
  PRODUCT_STATUSES,
  productStatusLabels,
} from "@/lib/product-statuses";

// Фильтр-бар раздела «Изделия»: состояние — в URL (?q=&status=&project=&…).
// «Только незавершённые» включена по умолчанию (active=0 — снята).
export function ProductsFilterBar({
  projectOptions,
  clientOptions,
}: {
  projectOptions: { value: string; label: string; hint?: string }[];
  clientOptions: { value: string; label: string; hint?: string }[];
}) {
  const { get, set, pending } = useListParams();
  const urlQ = get("q");
  const [q, setQ] = useState(urlQ);
  const debounceRef = useRef(urlQ);

  // Синхронизация поля с URL (кнопка «Сбросить», навигация «назад»)
  useEffect(() => {
    setQ(urlQ);
  }, [urlQ]);

  // Отложенная запись поиска в URL — не дёргаем сервер на каждый символ
  useEffect(() => {
    const timer = setTimeout(() => {
      if (debounceRef.current !== q) {
        debounceRef.current = q;
        set({ q: q || null, page: null });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q, set]);

  const statusRaw = get("status");
  const status = (PRODUCT_STATUSES.some((item) => item.id === statusRaw)
    ? statusRaw
    : "") as ProductStatus;
  const projectId = get("project");
  const clientId = get("client");
  const activeOnly = get("active") !== "0";
  const hasFilters =
    Boolean(urlQ || status || projectId || clientId) || !activeOnly;

  return (
    <div
      data-pending={pending || undefined}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="relative w-56">
        <Search className="absolute top-2.5 left-2 size-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Номер, название, проект, клиент…"
          className="pl-8"
        />
      </div>

      <Select
        value={status || "all"}
        onValueChange={(value: string | null) =>
          set({ status: !value || value === "all" ? null : value, page: null })
        }
      >
        <SelectTrigger className="w-44">
          <SelectValue>
            {status ? productStatusLabels[status] : "Все статусы"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все статусы</SelectItem>
          {PRODUCT_STATUSES.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="w-40">
        <SearchableSelect
          options={projectOptions}
          value={projectId}
          onChange={(value) => set({ project: value || null, page: null })}
          placeholder="Все проекты"
          searchPlaceholder="Поиск проекта…"
          allowClear
        />
      </div>
      <div className="w-48">
        <SearchableSelect
          options={clientOptions}
          value={clientId}
          onChange={(value) => set({ client: value || null, page: null })}
          placeholder="Все клиенты"
          searchPlaceholder="Поиск клиента…"
          allowClear
        />
      </div>

      <div className="flex items-center gap-2 pb-1">
        <Checkbox
          id="products-active-only"
          checked={activeOnly}
          onCheckedChange={(checked) =>
            set({ active: checked ? null : "0", page: null })
          }
        />
        <Label
          htmlFor="products-active-only"
          className="text-sm font-normal whitespace-nowrap"
        >
          Только незавершённые
        </Label>
      </div>

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() =>
            set({
              q: null,
              status: null,
              project: null,
              client: null,
              active: null,
              sort: null,
              dir: null,
              page: null,
            })
          }
        >
          <RotateCcw className="size-3.5" /> Сбросить
        </Button>
      ) : null}
    </div>
  );
}
