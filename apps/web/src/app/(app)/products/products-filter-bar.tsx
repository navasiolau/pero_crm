"use client";

import { RotateCcw, Search } from "lucide-react";
import type { ProductStatus } from "@prisma/client";

import { ResponsiveFilterPanel } from "@/components/responsive-filter-panel";
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
import { useListParams, useListSearch } from "@/lib/list-params";
import {
  PRODUCT_STATUSES,
  productStatusLabels,
} from "@/lib/product-statuses";

// Фильтр-бар раздела «Изделия»: состояние — в URL (?q=&status=&project=&…).
// «Только незавершённые» включена по умолчанию (active=0 — снята).
export function ProductsFilterBar({
  projectOptions,
  clientOptions,
  engineerOptions,
}: {
  projectOptions: { value: string; label: string; hint?: string }[];
  clientOptions: { value: string; label: string; hint?: string }[];
  engineerOptions: { value: string; label: string; hint?: string }[];
}) {
  const { get, set, reset, pending, canReset } = useListParams();
  const { q, setQ } = useListSearch();

  const statusRaw = get("status");
  const status = (PRODUCT_STATUSES.some((item) => item.id === statusRaw)
    ? statusRaw
    : "") as ProductStatus;
  const projectId = get("project");
  const clientId = get("client");
  const engineerId = get("engineer");
  const activeOnly = get("active") !== "0";
  const hasFilters = canReset || Boolean(q);

  return (
    <ResponsiveFilterPanel active={hasFilters} pending={pending}>
      <div className="relative w-56">
        <Search className="absolute top-1/2 -translate-y-1/2 left-2 size-4 text-muted-foreground" />
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
      <div className="w-44">
        <SearchableSelect
          options={engineerOptions}
          value={engineerId}
          onChange={(value) => set({ engineer: value || null, page: null })}
          placeholder="Все инженеры"
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
          onClick={reset}
        >
          <RotateCcw className="size-3.5" /> Сбросить
        </Button>
      ) : null}
    </ResponsiveFilterPanel>
  );
}
