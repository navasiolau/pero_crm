"use client";

import { memo, useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useOptionsFilter } from "@/hooks/use-options-filter";
import { cn } from "@/lib/utils";

export interface SearchableOption {
  value: string;
  label: string;
  hint?: string; // вторая строка (телефон, должность…)
  disabled?: boolean; // занято/недоступно (напр. работа уже в задаче)
}

type Props = {
  id?: string; options: SearchableOption[]; value: string; onChange: (value: string) => void;
  placeholder?: string; searchPlaceholder?: string; emptyText?: string; disabled?: boolean;
  allowClear?: boolean; className?: string;
  onOpenChange?: (open: boolean) => void;
  popupMinWidth?: number; wrapOptions?: boolean;
};

const OptionRow = memo(function OptionRow({ option, selected, onSelect, wrapOptions }: {
  option: SearchableOption; selected: boolean; onSelect: (value: string) => void; wrapOptions?: boolean;
}) {
  return <button key={option.value} type="button" disabled={option.disabled}
    className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent", selected && "bg-accent/60", option.disabled && "cursor-not-allowed opacity-45 hover:bg-transparent")}
    onClick={() => { if (!option.disabled) onSelect(option.value); }}>
    <Check className={cn("size-4 shrink-0", selected ? "opacity-100" : "opacity-0")} />
    <span className="flex min-w-0 flex-col"><span className={wrapOptions ? "whitespace-normal break-words" : "truncate"}>{option.label}</span>
      {option.hint ? <span className={cn("text-xs text-muted-foreground", wrapOptions ? "whitespace-normal break-words" : "truncate")}>{option.hint}</span> : null}
    </span>
  </button>;
});

function OptionsContent({ options, value, searchPlaceholder, emptyText, allowClear, query, setQuery, searchInput, onSelect, wrapOptions }: {
  options: SearchableOption[]; value: string; searchPlaceholder: string; emptyText: string; allowClear?: boolean;
  query: string; setQuery: (query: string) => void; searchInput: RefObject<HTMLInputElement | null>; onSelect: (value: string) => void; wrapOptions?: boolean;
}) {
  const filtered = useOptionsFilter(options, query, { searchHint: true });
  return <>
    <div className="relative mb-2"><Search className="absolute top-2.5 left-2 size-4 text-muted-foreground" />
      <Input ref={searchInput} value={query} onChange={event => setQuery(event.target.value)} placeholder={searchPlaceholder} className="pl-8" />
    </div>
    <div className="max-h-56 overflow-y-auto">
      {allowClear && value ? <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent" onClick={() => onSelect("")}>— сбросить</button> : null}
      {filtered.map(option => <OptionRow key={option.value} option={option} selected={option.value === value} onSelect={onSelect} wrapOptions={wrapOptions} />)}
      {filtered.length === 0 ? <div className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyText}</div> : null}
    </div>
  </>;
}

// Выпадающий список с поиском: закрытый Portal не исполняет OptionsContent.
export function SearchableSelect({ id, options, value, onChange, placeholder = "Выберите…", searchPlaceholder = "Поиск…", emptyText = "Ничего не найдено", disabled, allowClear, className, popupMinWidth, wrapOptions, onOpenChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => options.find(option => option.value === value), [options, value]);
  const onSelect = useCallback((next: string) => { onChange(next); setOpen(false); }, [onChange]);
  return <Popover open={open} onOpenChange={next => { setOpen(next); onOpenChange?.(next); if (!next) setQuery(""); }}>
    <PopoverTrigger render={<Button id={id} variant="outline" disabled={disabled} className={cn("w-full justify-between font-normal", className)} />}>
      <span className="truncate">{selected ? selected.label : placeholder}</span><ChevronDown className="size-4 shrink-0 opacity-50" />
    </PopoverTrigger>
    <PopoverContent className="w-72 p-2" align="start" initialFocus={searchInput}
      style={popupMinWidth === undefined ? undefined : { width: `min(calc(100vw - 24px), max(${popupMinWidth}px, var(--anchor-width)))` }}>
      <OptionsContent options={options} value={value} searchPlaceholder={searchPlaceholder} emptyText={emptyText} allowClear={allowClear} query={query} setQuery={setQuery} searchInput={searchInput} onSelect={onSelect} wrapOptions={wrapOptions} />
    </PopoverContent>
  </Popover>;
}
