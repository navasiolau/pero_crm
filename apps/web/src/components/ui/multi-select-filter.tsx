"use client";

import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject, type KeyboardEvent } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useOptionsFilter } from "@/hooks/use-options-filter";
import { cn } from "@/lib/utils";

export interface MultiSelectFilterOption { value: string; label: string; }
type Props = { label: string; options: MultiSelectFilterOption[]; value: readonly string[] | undefined; onChange: (value: string[] | undefined) => void; allLabel: string; searchPlaceholder?: string; className?: string; };

const OptionRow = memo(function OptionRow({ option, prefix, checked, onToggle }: {
  option: MultiSelectFilterOption; prefix: string; checked: boolean; onToggle: (value: string, checked: boolean) => void;
}) {
  const optionId = `${prefix}-${encodeURIComponent(option.value)}`;
  return <div className="flex items-center gap-2 rounded-md px-2 hover:bg-accent">
    <Checkbox id={optionId} aria-label={option.label} checked={checked} onCheckedChange={next => onToggle(option.value, next)} />
    <Label htmlFor={optionId} className="min-w-0 flex-1 cursor-pointer py-2 text-sm font-normal"><span className="truncate">{option.label}</span></Label>
  </div>;
});

function WindowedOptions({ options, prefix, selected, onToggle }: {
  options: readonly MultiSelectFilterOption[]; prefix: string; selected: Set<string>;
  onToggle: (value: string, checked: boolean) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [rowHeight, setRowHeight] = useState(36);
  const [focused, setFocused] = useState<string | null>(null);
  const viewport = list.current?.parentElement?.clientHeight || 224;
  const first = Math.max(0, Math.min(options.length - 1, Math.floor(scrollTop / rowHeight) - 4));
  const last = Math.min(options.length, first + Math.ceil(viewport / rowHeight) + 8);
  const indices = Array.from({ length: Math.max(0, last - first) }, (_, offset) => first + offset);
  const focusedIndex = focused === null ? -1 : options.findIndex(option => option.value === focused);
  // Прокрутка мышью не удаляет checkbox, на котором остался keyboard focus.
  if (focusedIndex >= 0 && !indices.includes(focusedIndex)) indices.push(focusedIndex);
  indices.sort((a, b) => a - b);

  useLayoutEffect(() => {
    const parent = list.current?.parentElement;
    if (!parent) return;
    const updateScroll = () => setScrollTop(parent.scrollTop);
    parent.addEventListener("scroll", updateScroll, { passive: true });
    const firstRow = list.current?.querySelector<HTMLElement>("[data-window-index]")?.firstElementChild;
    const measure = () => {
      // Размер layout не зависит от zoom-анимации Popover.
      const height = firstRow ? parseFloat(getComputedStyle(firstRow).height) : null;
      if (height && height !== rowHeight) setRowHeight(height);
      updateScroll();
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (firstRow) observer.observe(firstRow);
    return () => { parent.removeEventListener("scroll", updateScroll); observer.disconnect(); };
  }, [rowHeight, options]);

  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const row = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-window-value]") ?? []).find(node => node.dataset.windowValue === pendingFocus.current);
    const node = row?.querySelector<HTMLElement>("[role=checkbox]");
    if (node) { node.focus({ preventScroll: true }); pendingFocus.current = null; }
  });

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>("[data-window-index]");
    if (!row || !event.target.closest("[role=checkbox]")) return;
    const next = Number(row.dataset.windowIndex) + (event.shiftKey ? -1 : 1);
    if (next < 0 || next >= options.length) return;
    event.preventDefault();
    pendingFocus.current = options[next].value;
    setFocused(options[next].value);
    const parent = list.current?.parentElement;
    if (parent) {
      const top = next * rowHeight;
      if (top < parent.scrollTop) parent.scrollTop = top;
      else if (top + rowHeight > parent.scrollTop + parent.clientHeight) parent.scrollTop = top + rowHeight - parent.clientHeight;
      setScrollTop(parent.scrollTop);
    }
  }

  return <div ref={list} role="list" style={{ height: options.length * rowHeight, position: "relative" }} onKeyDown={moveFocus}
    onFocusCapture={event => { const row = (event.target as HTMLElement).closest<HTMLElement>("[data-window-value]"); if (row) setFocused(row.dataset.windowValue ?? null); }}>
    {indices.map(index => <div key={options[index].value} role="listitem" aria-posinset={index + 1} aria-setsize={options.length}
      data-window-index={index} data-window-value={options[index].value} style={{ position: "absolute", top: index * rowHeight, left: 0, right: 0 }}>
      <OptionRow option={options[index]} prefix={prefix} checked={selected.has(options[index].value)} onToggle={onToggle} />
    </div>)}
  </div>;
}

function OptionsContent({ options, value, query, setQuery, searchInput, searchPlaceholder, label, prefix, onToggle, onReset }: {
  options: MultiSelectFilterOption[]; value: readonly string[] | undefined; query: string; setQuery: (query: string) => void;
  searchInput: RefObject<HTMLInputElement | null>; searchPlaceholder: string; label: string; prefix: string;
  onToggle: (value: string, checked: boolean) => void; onReset: () => void;
}) {
  const filtered = useOptionsFilter(options, query, { locale: "ru" });
  const selected = useMemo(() => new Set(value ?? []), [value]);
  return <>
    <div className="relative"><Search className="absolute top-2.5 left-2 size-4 text-muted-foreground" />
      <Input ref={searchInput} value={query} onChange={event => setQuery(event.target.value)} aria-label={searchPlaceholder} placeholder={searchPlaceholder} className="pl-8" />
    </div>
    <div className="flex gap-1 border-b pb-2"><Button type="button" variant="ghost" size="sm" onClick={onReset}>Сброс</Button></div>
    <div data-filter-options className="max-h-56 overflow-y-auto overscroll-contain" role="group" aria-label={label}>
      {options.length > 1000 ? <WindowedOptions options={filtered} prefix={prefix} selected={selected} onToggle={onToggle} /> : filtered.map(option => <OptionRow key={option.value} option={option} prefix={prefix} checked={selected.has(option.value)} onToggle={onToggle} />)}
      {filtered.length === 0 ? <div className="px-2 py-6 text-center text-muted-foreground">Ничего не найдено</div> : null}
    </div>
  </>;
}

// Неизвестные IDs сохраняются до явного действия пользователя.
export function MultiSelectFilter({ label, options, value, onChange, allLabel, searchPlaceholder = "Поиск…", className }: Props) {
  const id = useId(), [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const count = value?.length, first = value?.[0];
  const selectedLabel = useMemo(() => !count ? allLabel : count === 1 ? options.find(option => option.value === first)?.label ?? `${label}: 1` : `${label}: ${count}`, [options, count, first, allLabel, label]);
  const toggle = useCallback((optionValue: string, checked: boolean) => {
    const next = new Set(value ?? []);
    if (checked) next.add(optionValue); else next.delete(optionValue);
    const known = new Set(options.map(option => option.value));
    const allKnown = options.length > 0 && options.every(option => next.has(option.value));
    const hasUnknown = [...next].some(item => !known.has(item));
    onChange(next.size === 0 || (checked && allKnown && !hasUnknown) ? undefined : [...next]);
  }, [value, options, onChange]);
  const reset = useCallback(() => onChange(undefined), [onChange]);
  return <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery(""); }}>
    <PopoverTrigger render={<Button variant="outline" aria-label={label} className={cn("w-full justify-between font-normal", className)} />}>
      <span className="truncate">{selectedLabel}</span><ChevronDown className="size-4 shrink-0 opacity-50" />
    </PopoverTrigger>
    <PopoverContent align="start" className="w-72 gap-2 p-2" initialFocus={searchInput}>
      <OptionsContent options={options} value={value} query={query} setQuery={setQuery} searchInput={searchInput} searchPlaceholder={searchPlaceholder} label={label} prefix={id} onToggle={toggle} onReset={reset} />
    </PopoverContent>
  </Popover>;
}