"use client";

import { RotateCcw, Search } from "lucide-react";
import type { ProjectStage } from "@prisma/client";

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
import { STAGES, stageLabels } from "@/lib/stages";

import type { SelectOption } from "./projects-view";

// Фильтр-бар раздела «Проекты»: состояние — в URL (?q=&stage=&client=&…).
// «Только незавершённые» включена по умолчанию (параметра active нет);
// снятая галочка пишется как active=0.
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

  const stageRaw = get("stage");
  const stage = (STAGES.some((item) => item.id === stageRaw)
    ? stageRaw
    : "") as ProjectStage;
  const clientId = get("client");
  const managerId = get("manager");
  const engineerId = get("engineer");
  const activeOnly = get("active") !== "0";
  const hasFilters = canReset || Boolean(q);

  // SelectOption (id/name) → SearchableOption (value/label)
  const toOptions = (items: SelectOption[]) =>
    items.map((item) => ({ value: item.id, label: item.name }));

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
          placeholder="Номер, название, клиент…"
          className="pl-8"
        />
      </div>

      <Select
        value={stage || "all"}
        onValueChange={(value: string | null) =>
          set({ stage: !value || value === "all" ? null : value, page: null })
        }
      >
        <SelectTrigger className="w-40">
          <SelectValue>{stage ? stageLabels[stage] : "Все этапы"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все этапы</SelectItem>
          {STAGES.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="w-48">
        <SearchableSelect
          options={toOptions(clients)}
          value={clientId}
          onChange={(value) => set({ client: value || null, page: null })}
          placeholder="Все клиенты"
          searchPlaceholder="Поиск клиента…"
          allowClear
        />
      </div>
      <div className="w-44">
        <SearchableSelect
          options={toOptions(managers)}
          value={managerId}
          onChange={(value) => set({ manager: value || null, page: null })}
          placeholder="Все менеджеры"
          allowClear
        />
      </div>
      <div className="w-44">
        <SearchableSelect
          options={toOptions(engineers)}
          value={engineerId}
          onChange={(value) => set({ engineer: value || null, page: null })}
          placeholder="Все инженеры"
          allowClear
        />
      </div>

      <div className="flex items-center gap-2 pb-1">
        <Checkbox
          id="projects-active-only"
          checked={activeOnly}
          onCheckedChange={(checked) =>
            set({ active: checked ? null : "0", page: null })
          }
        />
        <Label
          htmlFor="projects-active-only"
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
    </div>
  );
}
