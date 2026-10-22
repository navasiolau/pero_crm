"use client";

import { useEffect } from "react";
import { RotateCcw, Search } from "lucide-react";

import { ResponsiveFilterPanel } from "@/components/responsive-filter-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelectFilter, type MultiSelectFilterOption } from "@/components/ui/multi-select-filter";
import { encodeListFilterUiValue, parseListFilterUiValue } from "@/lib/list-filter-values";
import { useListParams, useListSearch } from "@/lib/list-params";
import type { ListSection } from "@/lib/list-state";

export interface EntityListFilterField {
  queryKey: string;
  label: string;
  allLabel: string;
  searchPlaceholder: string;
  options: MultiSelectFilterOption[];
  width: string;
}

// Обе страницы задают только свои поля; чтение, сохранение и сброс едины.
export function EntityListFilterBar({ section, searchPlaceholder, fields, onSearchDraftChange, onModalActiveChange }: {
  section: ListSection;
  searchPlaceholder: string;
  fields: EntityListFilterField[];
  onSearchDraftChange?: (query: string) => void;
  onModalActiveChange?: (active: boolean) => void;
}) {
  const { get, set, reset, pending, canReset } = useListParams();
  const { q, setQ } = useListSearch();
  useEffect(() => { onSearchDraftChange?.(q); }, [q, onSearchDraftChange]);
  const hasFilters = canReset || Boolean(q);
  const activeId = `${section}-active-only`;

  return (
    <ResponsiveFilterPanel active={hasFilters} pending={pending} onModalActiveChange={onModalActiveChange}>
      <div className="relative w-56">
        <Search className="absolute top-1/2 -translate-y-1/2 left-2 size-4 text-muted-foreground" />
        <Input value={q} onChange={(event) => { setQ(event.target.value); onSearchDraftChange?.(event.target.value); }} placeholder={searchPlaceholder} className="pl-8" />
      </div>
      {fields.map((field) => (
        <div key={field.queryKey} className={field.width}>
          <MultiSelectFilter
            label={field.label}
            options={field.options}
            value={parseListFilterUiValue(get(field.queryKey), field.options)}
            onChange={(value) => set({ [field.queryKey]: encodeListFilterUiValue(value, field.options), page: null })}
            allLabel={field.allLabel}
            searchPlaceholder={field.searchPlaceholder}
          />
        </div>
      ))}
      <div className="flex items-center gap-2 pb-1">
        <Checkbox
          id={activeId}
          checked={get("active") === "1"}
          onCheckedChange={(checked) => set({ active: checked ? "1" : "0", page: null })}
        />
        <Label htmlFor={activeId} className="text-sm font-normal whitespace-nowrap">Незавершённые</Label>
      </div>
      {hasFilters ? (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
          <RotateCcw className="size-3.5" /> Сброс
        </Button>
      ) : null}
    </ResponsiveFilterPanel>
  );
}
