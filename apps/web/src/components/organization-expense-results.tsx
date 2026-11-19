"use client";

import { useId, useState, type FormEvent } from "react";
import { OrganizationPaymentsView } from "@/components/organization-payments-view";
import { ResponsiveFilterPanel } from "@/components/responsive-filter-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { formatExactMoney } from "@/lib/format";
import { encodeListFilterValue, parseListFilterValue } from "@/lib/list-filter-values";
import { useListParams } from "@/lib/list-params";
import { expenseChoiceFields, expenseRangeFields, expenseTextFields } from "@/lib/organization-expense-filters";
import type { OrganizationExpensePageData } from "@/server/finance/organization-ledger";

const textFields = [["q", "Поиск по расходам"], ...Object.entries(expenseTextFields)];
const choiceFields = Object.keys(expenseChoiceFields) as (keyof typeof expenseChoiceFields)[];

function ExpenseFilters({ options }: Pick<OrganizationExpensePageData, "options">) {
  const { get, reset, pending } = useListParams();
  const active = textFields.some(([key]) => Boolean(get(key))) ||
    choiceFields.some(key => Boolean(get(key))) ||
    Object.keys(expenseRangeFields).some(key => Boolean(get(key + "From") || get(key + "To")));

  const applied = [
    ...textFields.map(([key]) => get(key)), ...choiceFields.map(key => get(key)),
    ...Object.keys(expenseRangeFields).flatMap(key => [get(key + "From"), get(key + "To")]),
  ];
  return <ResponsiveFilterPanel active={active} pending={pending} closeLabel="Закрыть">
    <ExpenseFilterForm key={JSON.stringify(applied)} options={options} onReset={reset}/>
  </ResponsiveFilterPanel>;
}

function ExpenseFilterForm({ options, onReset }: Pick<OrganizationExpensePageData, "options"> & { onReset: () => void }) {
  const { get, set } = useListParams();
  const id = useId();
  const [choices, setChoices] = useState(() => Object.fromEntries(choiceFields.map(key => [key, parseListFilterValue(get(key))])));
  const [error, setError] = useState("");
  const [resetRevision, setResetRevision] = useState(0);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    for (const [field, meta] of Object.entries(expenseRangeFields)) {
      const from = String(data.get(field + "From") ?? ""), to = String(data.get(field + "To") ?? "");
      if (from && to && (meta.type === "date" ? from > to : Number(from) > Number(to))) {
        setError(meta.label + ": значение «От» должно быть не больше «До».");
        return;
      }
    }
    setError("");
    set({ ...Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value)])),
      ...Object.fromEntries(choiceFields.map(key => [key, encodeListFilterValue(choices[key])])) });
  }

  return <form key={resetRevision} onSubmit={apply} aria-label="Фильтры расходов" className="w-full space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {textFields.map(([key, label]) => <label className="grid min-w-0 gap-1 text-xs text-muted-foreground" key={key}>
          {label}
          <Input name={key} defaultValue={get(key)} maxLength={key === "q" ? 100 : 128}/>
        </label>)}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {choiceFields.map(key => <div key={key} className="min-w-0">
          <MultiSelectFilter label={expenseChoiceFields[key]} options={options[key]}
            value={choices[key]} onChange={values => setChoices(current => ({ ...current, [key]: values }))} allLabel="Все значения" searchPlaceholder="Поиск значения"/>
        </div>)}
      </div>
      <details open={Object.keys(expenseRangeFields).some(key => Boolean(get(key + "From") || get(key + "To"))) || undefined}>
        <summary className="w-fit cursor-pointer text-sm font-medium">Диапазоны дат, сумм, курса и складских значений</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(expenseRangeFields).map(([key, meta]) => <fieldset key={key} className="min-w-0 rounded-md border px-2 pb-2">
            <legend className="px-1 text-xs text-muted-foreground">{meta.label}</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["From", "To"] as const).map(suffix => {
                const name = key + suffix;
                return <label key={name} htmlFor={id + name} className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                  {suffix === "From" ? "От" : "До"}
                  <Input id={id + name} name={name} type={meta.type} step={meta.type === "number" ? "any" : undefined}
                    aria-label={meta.label + (suffix === "From" ? " от" : " до")} defaultValue={get(name)}/>
                </label>;
              })}
            </div>
          </fieldset>)}
        </div>
      </details>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="outline">Применить</Button>
        <Button type="button" variant="ghost" onClick={() => {
          setError("");
          setChoices({});
          setResetRevision(revision => revision + 1);
          onReset();
        }}>Сбросить</Button>
      </div>
    </form>;
}

export function OrganizationExpenseResults({ options, page, pageSize, total, totalByn, sort, dir, ...ledger }: OrganizationExpensePageData &
  Pick<Parameters<typeof OrganizationPaymentsView>[0], "expenseArticles" | "stockMaterials" | "materialCreateOptions">) {
  const { set, pending } = useListParams();
  return <OrganizationPaymentsView direction="EXPENSE" {...ledger}
    beforeTable={<>
      <ExpenseFilters options={options}/>
      <p className="text-sm" aria-live="polite" aria-busy={pending}>Итого по выборке <strong className="ml-1 tabular-nums">{formatExactMoney(totalByn, "BYN")}</strong></p>
    </>}
    tableServer={{
      page, pageSize: pageSize === "all" ? 10 : pageSize, allRows: pageSize === "all", total, sort, dir,
      onPageChange: next => set({ page: String(next) }),
      onSortChange: (field, direction) => set({ sort: field, dir: direction }),
      onPageSizeChange: size => set({ pageSize: String(size) }),
      onShowAll: () => set({ pageSize: "all" }),
    }}/>;
}
