"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { listJournal, listJournalFilterOptions } from "@/server/changelog/actions";
import type { JournalScope } from "@/server/changelog/contract";
import type { JournalFilterOptions, JournalPage, JournalQueryInput } from "@/server/changelog/query-contract";
import { JournalEntryDialog } from "./journal-entry-dialog";
import { JournalTable, type JournalEntrySection } from "./journal-table";

type Query = Omit<JournalQueryInput, "scope">;
type Draft = { q: string; actorId: string; entity: string; from: string; to: string };
type Selection = { row: JournalPage["entries"][number]; section: JournalEntrySection };
const GLOBAL_SCOPE: JournalScope = { kind: "global" };

function queryDefaults(query?: Query): Query {
  return { q: query?.q ?? "", actorId: query?.actorId ?? "", entity: query?.entity ?? "",
    from: query?.from ?? "", to: query?.to ?? "", page: query?.page ?? 1, pageSize: query?.pageSize ?? 20,
    sort: query?.sort ?? "time", dir: query?.dir ?? "desc" };
}

function draftFrom(query: Query): Draft {
  return { q: query.q ?? "", actorId: query.actorId ?? "", entity: query.entity ?? "", from: query.from ?? "", to: query.to ?? "" };
}

function saveGlobalQuery(query: Query) {
  const url = new URL(window.location.href);
  for (const key of ["actor", "q", "actorId", "entity", "from", "to", "page", "pageSize", "sort", "dir", "reset"]) url.searchParams.delete(key);
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  window.history.replaceState(window.history.state, "", url);
}

export function Journal({ scope = GLOBAL_SCOPE, initialQuery }: { scope?: JournalScope; initialQuery?: Query }) {
  return <JournalWorkspace key={scope.kind === "global" ? "global" : `${scope.kind}:${scope.id}`} scope={scope} initialQuery={initialQuery}/>;
}

function JournalWorkspace({ scope, initialQuery }: { scope: JournalScope; initialQuery?: Query }) {
  const [query, setQuery] = useState<Query>(() => queryDefaults(initialQuery));
  const [draft, setDraft] = useState<Draft>(() => draftFrom(queryDefaults(initialQuery)));
  const [data, setData] = useState<JournalPage | null>(null);
  const [options, setOptions] = useState<JournalFilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [optionsError, setOptionsError] = useState(false);
  const [formError, setFormError] = useState("");
  const [retry, setRetry] = useState(0);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const generation = useRef(0);
  const returnFocus = useRef<HTMLElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const controlId = useId();

  useEffect(() => {
    const request = ++generation.current;
    let current = true;
    setLoading(true); setError(false);
    listJournal({ ...query, scope }).then(result => {
      if (!current || request !== generation.current) return;
      setData(result); setLoading(false);
    }).catch(() => {
      if (!current || request !== generation.current) return;
      setError(true); setLoading(false);
    });
    return () => { current = false; };
  }, [query, scope, retry]);

  useEffect(() => {
    let current = true;
    setOptionsError(false);
    listJournalFilterOptions(scope).then(result => { if (current) setOptions(result); })
      .catch(() => { if (current) setOptionsError(true); });
    return () => { current = false; };
  }, [scope, optionsRetry]);

  function commit(next: Query) {
    setQuery(next);
    if (scope.kind === "global") saveGlobalQuery(next);
  }
  function apply(event: FormEvent) {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) { setFormError("Дата «С» должна быть не позднее даты «По»"); return; }
    setFormError(""); commit({ ...query, ...draft, page: 1 });
  }
  function reset() {
    const next = queryDefaults();
    setDraft(draftFrom(next)); setFormError(""); commit(next);
  }

  return <div ref={container} tabIndex={-1} className="@container min-w-0 space-y-4 outline-none" data-journal>
    <form onSubmit={apply} className="grid min-w-0 items-end gap-2 sm:grid-cols-2 @min-[58rem]:grid-cols-[minmax(7.5rem,1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_8.75rem_8.75rem_auto]" aria-label="Фильтры журнала">
      <div className="min-w-0 space-y-1 sm:col-span-2 @min-[58rem]:col-span-1">
        <label htmlFor={`${controlId}-search`} className="text-xs text-muted-foreground">Поиск по журналу</label>
        <Input id={`${controlId}-search`} value={draft.q} placeholder="Поиск по всей истории…" onChange={event => setDraft(value => ({ ...value, q: event.target.value }))}/>
      </div>
      <div className="min-w-0 space-y-1">
        <label htmlFor={`${controlId}-actor`} className="text-xs text-muted-foreground">Пользователь</label>
        <SearchableSelect id={`${controlId}-actor`} value={draft.actorId} onChange={actorId => setDraft(value => ({ ...value, actorId }))}
          options={(options?.users ?? []).map(option => ({ value: option.id, label: option.label }))}
          placeholder="Все пользователи" searchPlaceholder="Поиск пользователя…" allowClear wrapOptions disabled={options === null}/>
      </div>
      <div className="min-w-0 space-y-1">
        <label htmlFor={`${controlId}-entity`} className="text-xs text-muted-foreground">Сущность</label>
        <SearchableSelect id={`${controlId}-entity`} value={draft.entity} onChange={entity => setDraft(value => ({ ...value, entity }))}
          options={(options?.entities ?? []).map(option => ({ value: option.id, label: option.label }))}
          placeholder="Все сущности" searchPlaceholder="Поиск сущности…" allowClear wrapOptions disabled={options === null}/>
      </div>
      <div className="min-w-0 space-y-1">
        <label htmlFor={`${controlId}-from`} className="text-xs text-muted-foreground">С</label>
        <Input id={`${controlId}-from`} type="date" value={draft.from} onChange={event => setDraft(value => ({ ...value, from: event.target.value }))}/>
      </div>
      <div className="min-w-0 space-y-1">
        <label htmlFor={`${controlId}-to`} className="text-xs text-muted-foreground">По</label>
        <Input id={`${controlId}-to`} type="date" value={draft.to} onChange={event => setDraft(value => ({ ...value, to: event.target.value }))}/>
      </div>
      <div className="flex flex-wrap gap-2 sm:col-span-2 @min-[58rem]:col-span-1 @min-[58rem]:flex-nowrap">
        <Button type="submit" variant="outline">Применить</Button>
        <Button type="button" variant="ghost" onClick={reset}>Сбросить</Button>
      </div>
      {formError ? <p role="alert" className="col-span-full text-sm text-destructive">{formError}</p> : null}
    </form>
    {optionsError ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
      <span>Не удалось загрузить варианты фильтров</span><Button type="button" size="sm" variant="outline" onClick={() => setOptionsRetry(value => value + 1)}>Повторить загрузку фильтров</Button>
    </div> : null}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">Записи{data && !error ? ` (${data.total})` : ""}</h2>
      {loading ? <span role="status" className="text-sm text-muted-foreground">Загрузка журнала…</span> : null}
    </div>
    {error ? <div role="alert" className="space-y-3 rounded-lg border p-4">
      <p>Не удалось загрузить журнал</p><Button type="button" variant="outline" onClick={() => setRetry(value => value + 1)}>Повторить</Button>
    </div> : data ? <div aria-busy={loading} className="min-w-0">
      <JournalTable entries={data.entries} server={{ total: data.total, page: data.page, pageSize: data.pageSize, sort: data.sort, dir: data.dir,
        onPageChange: page => commit({ ...query, page }),
        onPageSizeChange: pageSize => commit({ ...query, pageSize, page: 1 }),
        onSortChange: (sort, dir) => {
          if (sort === "time" || sort === "actor" || sort === "entity" || sort === "action") commit({ ...query, sort, dir, page: 1 });
        },
      }} onOpen={(row, section, opener) => {
        returnFocus.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : container.current);
        setSelection({ row, section });
      }}/>
    </div> : null}
    <JournalEntryDialog selection={selection} scope={scope} returnFocus={returnFocus} fallbackFocus={container} onClose={() => setSelection(null)}/>
  </div>;
}
