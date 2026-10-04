"use client";

import { RotateCcw, Search } from "lucide-react";

import { ResponsiveFilterPanel } from "@/components/responsive-filter-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { useListParams, useListSearch } from "@/lib/list-params";
import { encodeProjectFilterValue, parseProjectFilterValue } from "@/lib/project-filter-values";
import { STAGES } from "@/lib/stages";

import type { SelectOption } from "./projects-view";

// Фильтр-бар раздела «Проекты»: состояние — в URL (?q=&stage=&client=&…).
// Пустой выбор означает отсутствие ограничения по этой оси.
export function ProjectsFilterBar({
  clients,
  managers,
  engineers,
}: {
  clients: SelectOption[];
  managers: SelectOption[];
  engineers: SelectOption[];
}) {
  const { get, set, reset, pending, canReset } = useListParams();
  const { q, setQ } = useListSearch();

  const stages = parseProjectFilterValue(get("stage"));
  const clientIds = parseProjectFilterValue(get("client"));
  const managerIds = parseProjectFilterValue(get("manager"));
  const engineerIds = parseProjectFilterValue(get("engineer"));
  const activeOnly = get("active") === "1";
  const hasFilters = canReset || Boolean(q);

  // SelectOption (id/name) → пункты чекбоксного фильтра.
  const toOptions = (items: SelectOption[]) =>
    items.map((item) => ({ value: item.id, label: item.name }));

  return (
    <ResponsiveFilterPanel active={hasFilters} pending={pending}>
      <div className="relative w-56">
        <Search className="absolute top-1/2 -translate-y-1/2 left-2 size-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Номер, название, клиент…"
          className="pl-8"
        />
      </div>

      <div className="w-40">
        <MultiSelectFilter
          label="Статус"
          options={STAGES.map((item) => ({ value: item.id, label: item.label }))}
          value={stages}
          onChange={(value) => set({ stage: encodeProjectFilterValue(value), page: null })}
          allLabel="Все статусы"
          searchPlaceholder="Поиск статуса…"
        />
      </div>

      <div className="w-48">
        <MultiSelectFilter
          label="Клиент"
          options={toOptions(clients)}
          value={clientIds}
          onChange={(value) => set({ client: encodeProjectFilterValue(value), page: null })}
          allLabel="Все клиенты"
          searchPlaceholder="Поиск клиента…"
        />
      </div>
      <div className="w-44">
        <MultiSelectFilter
          label="Менеджер"
          options={toOptions(managers)}
          value={managerIds}
          onChange={(value) => set({ manager: encodeProjectFilterValue(value), page: null })}
          allLabel="Все менеджеры"
          searchPlaceholder="Поиск менеджера…"
        />
      </div>
      <div className="w-44">
        <MultiSelectFilter
          label="Инженер"
          options={toOptions(engineers)}
          value={engineerIds}
          onChange={(value) => set({ engineer: encodeProjectFilterValue(value), page: null })}
          allLabel="Все инженеры"
          searchPlaceholder="Поиск инженера…"
        />
      </div>

      <div className="flex items-center gap-2 pb-1">
        <Checkbox
          id="projects-active-only"
          checked={activeOnly}
          onCheckedChange={(checked) =>
            set({ active: checked ? "1" : "0", page: null })
          }
        />
        <Label
          htmlFor="projects-active-only"
          className="text-sm font-normal whitespace-nowrap"
        >
          Незавершённые
        </Label>
      </div>

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={reset}
        >
          <RotateCcw className="size-3.5" /> Сброс
        </Button>
      ) : null}
    </ResponsiveFilterPanel>
  );
}
