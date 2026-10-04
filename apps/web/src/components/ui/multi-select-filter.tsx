"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MultiSelectFilterOption {
  value: string;
  label: string;
}

// Пустой или полный набор не ограничивает результаты; неизвестные ID сохраняются
// при изменении справочника и снимаются только явным действием пользователя.
export function MultiSelectFilter({
  label,
  options,
  value,
  onChange,
  allLabel,
  searchPlaceholder = "Поиск…",
  className,
}: {
  label: string;
  options: MultiSelectFilterOption[];
  value: readonly string[] | undefined;
  onChange: (value: string[] | undefined) => void;
  allLabel: string;
  searchPlaceholder?: string;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const selected = new Set(value ?? []);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    return options.filter((option) => option.label.toLocaleLowerCase("ru").includes(needle));
  }, [options, query]);
  const selectedLabel = !value?.length
    ? allLabel
    : value.length === 1
        ? options.find((option) => option.value === value[0])?.label ?? `${label}: 1`
        : `${label}: ${value.length}`;

  function toggle(optionValue: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(optionValue);
    else next.delete(optionValue);
    const known = new Set(options.map((option) => option.value));
    // Только явное включение последнего пункта возвращает режим «все».
    // Отсутствующие в справочнике ID нельзя потерять при таком переходе.
    const allKnown = options.length > 0 && options.every((option) => next.has(option.value));
    const hasUnknown = [...next].some((item) => !known.has(item));
    onChange(next.size === 0 || (checked && allKnown && !hasUnknown) ? undefined : [...next]);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        render={<Button variant="outline" aria-label={label} className={cn("w-full justify-between font-normal", className)} />}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-2 p-2" initialFocus={searchInput}>
        <div className="relative">
          <Search className="absolute top-2.5 left-2 size-4 text-muted-foreground" />
          <Input
            ref={searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            className="pl-8"
          />
        </div>
        <div className="flex gap-1 border-b pb-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>Сброс</Button>
        </div>
        <div data-filter-options className="max-h-56 overflow-y-auto overscroll-contain" role="group" aria-label={label}>
          {filtered.map((option) => {
            const optionId = `${id}-${encodeURIComponent(option.value)}`;
            return (
              <div key={option.value} className="flex items-center gap-2 rounded-md px-2 hover:bg-accent">
                <Checkbox
                  id={optionId}
                  aria-label={option.label}
                  checked={selected.has(option.value)}
                  onCheckedChange={(checked) => toggle(option.value, checked)}
                />
                <Label htmlFor={optionId} className="min-w-0 flex-1 cursor-pointer py-2 text-sm font-normal">
                  <span className="truncate">{option.label}</span>
                </Label>
              </div>
            );
          })}
          {filtered.length === 0 ? <div className="px-2 py-6 text-center text-muted-foreground">Ничего не найдено</div> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
