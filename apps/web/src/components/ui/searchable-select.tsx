"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchableOption {
  value: string;
  label: string;
  hint?: string; // вторая строка (телефон, должность…)
  disabled?: boolean; // занято/недоступно (напр. работа уже в задаче)
}

// Выпадающий список с поиском: поле ввода над списком фильтрует значения.
// Для длинных списков (клиенты, сотрудники), где скролл не масштабируется.
export function SearchableSelect({
  id,
  options,
  value,
  onChange,
  placeholder = "Выберите…",
  searchPlaceholder = "Поиск…",
  emptyText = "Ничего не найдено",
  disabled,
  allowClear,
  className,
}: {
  id?: string;
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.hint?.toLowerCase().includes(needle),
    );
  }, [options, query]);

  const selected = options.find((option) => option.value === value);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            disabled={disabled}
            className={cn("w-full justify-between font-normal", className)}
          />
        }
      >
        <span className="truncate">
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="relative mb-2">
          <Search className="absolute top-2.5 left-2 size-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8"
          />
        </div>
        <div className="max-h-56 overflow-y-auto">
          {allowClear && value ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              — сбросить
            </button>
          ) : null}
          {filtered.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={option.disabled}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                option.value === value && "bg-accent/60",
                option.disabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
              )}
              onClick={() => {
                if (option.disabled) return;
                onChange(option.value);
                setOpen(false);
              }}
            >
              <Check
                className={cn(
                  "size-4 shrink-0",
                  option.value === value ? "opacity-100" : "opacity-0",
                )}
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{option.label}</span>
                {option.hint ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
          {filtered.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">
              {emptyText}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
