"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";

import { OrganizationExpenseDateCalendar } from "@/components/organization-expense-date-calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { encodeListFilterValue, parseListFilterValue } from "@/lib/list-filter-values";
import { useListParams, useListSearch } from "@/lib/list-params";
import {
  expenseChoiceFields,
  expenseRangeFields,
  expenseTextFields,
  normalizeExpenseFilters,
} from "@/lib/organization-expense-filters";
import { cn } from "@/lib/utils";
import type { OrganizationExpensePageData } from "@/server/finance/organization-ledger";

const amountRanges = ["amount", "byn"] as const;
const dateRanges = ["date"] as const;
const exactRanges = ["rateDate", "rate", "stockQty", "stockUnitPrice", "stockValueByn"] as const;
const exactChoices = ["currency", "documentPresence", "material", "stockUnit"] as const;
const primaryChoices = [
  { field: "purpose", label: "Назначение", narrowLabel: "Назн." },
  { field: "cash", label: "Касса" },
  { field: "article", label: "Статья" },
] as const;
const bounds = ["From", "To"] as const;
const exactKeys = [...Object.keys(expenseTextFields), ...exactChoices];
const clearAllFilters = Object.fromEntries<null>([
  "q", ...Object.keys(expenseChoiceFields), ...Object.keys(expenseTextFields),
  ...Object.keys(expenseRangeFields).flatMap(field => bounds.map(boundary => field + boundary)),
].map(key => [key, null]));
const compactTrigger = "h-11 min-w-0 justify-center gap-1 px-1 text-[11px] font-medium transition-colors max-[400px]:px-px max-md:min-h-11! max-md:min-w-0! max-md:text-[11px]! md:h-10 md:px-2 md:text-xs @[52rem]/expenses:justify-between @[52rem]/expenses:px-2.5 @[52rem]/expenses:text-sm";
const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC",
});
const activeTrigger = "border-foreground/35 bg-muted dark:border-foreground/35 dark:bg-muted";

type RangeField = keyof typeof expenseRangeFields;

function dateFilterDetail(from: string, to: string) {
  const format = (day: string) => dateFormat.format(new Date(day + "T00:00:00Z"));
  if (from && to) return format(from) + "–" + format(to);
  if (from) return "с " + format(from);
  if (to) return "по " + format(to);
  return undefined;
}

function FilterTriggerText({ label, narrowLabel, count, detail }: {
  label: string; narrowLabel?: string; count: number; detail?: string;
}) {
  return <>
    <span className="min-w-0 truncate">
      {narrowLabel ? <>
        <span className="min-[360px]:hidden">{narrowLabel}</span>
        <span className="hidden min-[360px]:inline">{label}</span>
      </> : <span>{label}</span>}
      {count > 0 ? (
        <span aria-hidden className={cn("tabular-nums", detail && "@[62rem]/expenses:hidden")}>{"\u202f·\u202f"}{count}</span>
      ) : null}
      {detail ? <span aria-hidden className="ms-1.5 hidden text-xs font-normal text-muted-foreground @[62rem]/expenses:inline">{detail}</span> : null}
    </span>
    <ChevronDown className="hidden size-3.5 shrink-0 text-muted-foreground @[52rem]/expenses:block" />
  </>;
}

function RangeInputs({ field, get }: { field: RangeField; get: (key: string) => string }) {
  const { label, type } = expenseRangeFields[field];
  return (
    <fieldset className={cn("min-w-0 rounded-md border px-2.5 pb-2", type === "date" && "sm:col-span-2")}>
      <legend className="px-1 text-xs font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {bounds.map(boundary => {
          const caption = boundary === "From" ? "От" : "До";
          const name = field + boundary;
          return (
            <label key={name} className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              {caption}
              <Input
                type={type === "date" ? "date" : "text"}
                inputMode={type === "number" ? "decimal" : undefined}
                aria-label={label + " " + caption.toLowerCase()}
                name={name}
                defaultValue={get(name)}
                className={type === "date" ? "px-1.5 text-sm max-md:text-[13px]!" : undefined}
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function ExactChoices({ field, options, initialValue }: {
  field: (typeof exactChoices)[number];
  options: OrganizationExpensePageData["options"][(typeof exactChoices)[number]];
  initialValue: string;
}) {
  const [selected, setSelected] = useState(() => parseListFilterValue(initialValue));
  const label = expenseChoiceFields[field];
  return <div className="grid min-w-0 gap-1">
    <span className="text-xs text-muted-foreground">{label}</span>
    <MultiSelectFilter label={label} options={options} value={selected} onChange={setSelected}
      allLabel="Все значения" searchPlaceholder="Поиск по значениям" showPopoverTitle />
    <input type="hidden" name={field} value={encodeListFilterValue(selected) ?? ""} />
  </div>;
}

function FilterForm({ keys, ranges, onApply, onClear, onClearAll, children }: {
  keys: readonly string[];
  ranges: readonly RangeField[];
  onApply: (filters: Record<string, string | null>) => void;
  onClear: () => void;
  onClearAll?: () => void;
  children: ReactNode;
}) {
  const [error, setError] = useState("");

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const source = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string") source.set(key, value);
    }
    const normalized = new URLSearchParams();
    normalizeExpenseFilters(source, normalized);
    for (const field of ranges) {
      const { label, type } = expenseRangeFields[field];
      const fromKey = field + "From", toKey = field + "To";
      const from = normalized.get(fromKey), to = normalized.get(toKey);
      if ((!from && source.get(fromKey)?.trim()) || (!to && source.get(toKey)?.trim())) {
        setError(type === "date" ? "Проверьте дату в поле «" + label + "»." : "Проверьте число в поле «" + label + "».");
        return;
      }
      if (from && to && (type === "date" ? from > to : new Decimal(from).gt(to))) {
        setError("В поле «" + label + "» значение «От» должно быть не больше значения «До».");
        return;
      }
    }
    onApply(Object.fromEntries(keys.map(key => [key, normalized.get(key)])));
  }

  return (
    <form onSubmit={apply} className="flex min-h-0 flex-col">
      <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-1 pb-2">{children}</div>
      {error ? <p role="alert" className="px-1 pb-2 text-xs text-destructive">{error}</p> : null}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t px-1 pt-2">
        <Button type="submit" size="sm">Применить</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>Сбросить</Button>
        {onClearAll ? (
          <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onClearAll}>
            Сбросить все фильтры
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function ExpenseFilterPopover({ label, ranges, otherKeys = [], popupClassName, searchOptions, triggerDetail, children }: {
  label: string;
  ranges: readonly RangeField[];
  otherKeys?: readonly string[];
  popupClassName?: string;
  searchOptions?: boolean;
  triggerDetail?: string;
  children: ReactNode;
}) {
  const { get, set, resetFilters } = useListParams();
  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const keys = [...otherKeys, ...ranges.flatMap(field => bounds.map(boundary => field + boundary))];
  const applied = keys.map(get);
  const count = applied.filter(Boolean).length;
  const trigger = searchOptions ? (
    <Button
      type="button"
      aria-label="Точные условия поиска"
      aria-description={count ? "Активных условий: " + count : undefined}
      title="Точные условия поиска"
      variant="ghost"
      size="icon-xs"
      className={cn("absolute top-1/2 right-0.5 h-10 w-6 -translate-y-1/2 transition-colors max-md:min-h-0! max-md:min-w-0! max-[359px]:w-5 md:right-1 md:size-8", count > 0 && "bg-muted text-primary")}
    />
  ) : (
    <Button
      type="button"
      aria-label={label}
      aria-description={triggerDetail ?? (count ? "Активных границ: " + count : undefined)}
      variant="outline"
      size="xs"
      className={cn(compactTrigger, count > 0 && activeTrigger)}
    />
  );

  function apply(filters: Record<string, string | null>) {
    if (Object.entries(filters).some(([key, value]) => (value ?? "") !== get(key))) set(filters);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={next => {
      if (next) setOpenCount(current => current + 1);
      setOpen(next);
    }}>
      <PopoverTrigger render={trigger}>
        {searchOptions ? <>
          <SlidersHorizontal className="size-3.5 sm:size-4" />
          {count > 0 ? <span aria-hidden className="absolute top-0 right-0 size-1.5 rounded-full bg-primary" /> : null}
        </> : <FilterTriggerText label={label} count={count} detail={triggerDetail} />}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("max-h-[min(36rem,var(--available-height))] max-w-[calc(100vw-1rem)]", popupClassName)}
      >
        <PopoverTitle className="px-1">{label}</PopoverTitle>
        <FilterForm
          key={JSON.stringify([openCount, ...applied])}
          keys={keys}
          ranges={ranges}
          onApply={apply}
          onClear={() => apply(Object.fromEntries(keys.map(key => [key, null])))}
          onClearAll={searchOptions ? () => { resetFilters(clearAllFilters); setOpen(false); } : undefined}
        >
          {children}
        </FilterForm>
      </PopoverContent>
    </Popover>
  );
}

export function OrganizationExpenseToolbar({ options }: Pick<OrganizationExpensePageData, "options">) {
  const { get, set } = useListParams();
  const { q, setQ } = useListSearch();

  return (
    <div role="group" aria-label="Фильтры расходов" className="flex min-w-0 items-center gap-[3px] max-[400px]:gap-px md:gap-1.5 @[52rem]/expenses:grid @[52rem]/expenses:grid-cols-[minmax(0,2.5fr)_minmax(0,1.5fr)_minmax(max-content,1.2fr)_repeat(3,minmax(max-content,1fr))] @[52rem]/expenses:gap-2">
      <div className="@container/search relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2 hidden size-4 -translate-y-1/2 text-muted-foreground md:block" />
        <Input
          value={q}
          onChange={event => setQ(event.target.value)}
          aria-label="Поиск по расходам"
          autoComplete="off"
          placeholder="Поиск по всем полям"
          maxLength={100}
          className="peer h-11 pr-7 pl-1.5 placeholder:text-transparent max-md:min-h-11! max-md:text-[16px]! max-[400px]:pl-0.5 max-[359px]:pr-6 md:h-10 md:pr-10 md:pl-8 md:placeholder:text-muted-foreground"
        />
        {!q ? (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-6 left-1.5 flex items-center overflow-hidden text-[13px] whitespace-nowrap text-muted-foreground peer-focus:invisible md:hidden">
            <Search className="size-3.5 shrink-0 @[4.25rem]/search:hidden" />
            <span className="hidden @[4.25rem]/search:inline">Поиск</span>
          </span>
        ) : null}
        <ExpenseFilterPopover label="Точные условия" otherKeys={exactKeys} ranges={exactRanges}
          popupClassName="w-[27rem]" searchOptions>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(expenseTextFields).map(([key, label]) => (
              <label key={key} className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                {label}
                <Input name={key} defaultValue={get(key)} maxLength={128} />
              </label>
            ))}
            {exactChoices.map(field => <ExactChoices key={field} field={field} options={options[field]} initialValue={get(field)} />)}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {exactRanges.map(field => <RangeInputs key={field} field={field} get={get} />)}
          </div>
        </ExpenseFilterPopover>
      </div>
      <ExpenseFilterPopover label="Дата" ranges={dateRanges} popupClassName="w-[19.5rem] sm:w-[32rem]"
        triggerDetail={dateFilterDetail(get("dateFrom"), get("dateTo"))}>
        <div className="grid gap-2 sm:grid-cols-2">
          {bounds.map(boundary => (
            <OrganizationExpenseDateCalendar key={boundary} boundary={boundary} initialValue={get("date" + boundary)} />
          ))}
        </div>
      </ExpenseFilterPopover>
      {primaryChoices.map(choice => {
        const selected = parseListFilterValue(get(choice.field));
        const count = selected?.length ?? 0;
        return (
          <MultiSelectFilter
            key={choice.field}
            label={choice.label}
            allLabel="Все значения"
            options={options[choice.field]}
            value={selected}
            onChange={next => set({ [choice.field]: encodeListFilterValue(next) })}
            searchPlaceholder="Поиск по значениям"
            className={cn(compactTrigger, "w-auto @[52rem]/expenses:w-full", count > 0 && activeTrigger)}
            triggerContent={<FilterTriggerText label={choice.label} narrowLabel={"narrowLabel" in choice ? choice.narrowLabel : undefined} count={count} />}
            showPopoverTitle
          />
        );
      })}
      <ExpenseFilterPopover label="Сумма" ranges={amountRanges} popupClassName="w-80">
        {amountRanges.map(field => <RangeInputs key={field} field={field} get={get} />)}
      </ExpenseFilterPopover>
    </div>
  );
}
