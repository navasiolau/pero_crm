"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getJournalEntry } from "@/server/changelog/actions";
import type { JournalScope, JournalValue } from "@/server/changelog/contract";
import { journalFieldLabel } from "@/server/changelog/labels";
import type { JournalEntryDetail, JournalListRow } from "@/server/changelog/query-contract";
import { journalTime, type JournalEntrySection } from "./journal-table";

type Selection = { row: JournalListRow; section: JournalEntrySection };
type DetailState = { id: string; status: "loading" | "error" } | { id: string; status: "ready"; detail: JournalEntryDetail };

function Value({ value }: { value: JournalValue }) {
  if (value === null) return <span className="italic">Не задано</span>;
  if (value === "") return <span className="italic">Пустая строка</span>;
  if (typeof value === "boolean") return <span>{value ? "Да" : "Нет"}</span>;
  if (typeof value !== "object") return <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{String(value)}</span>;
  if (Array.isArray(value)) return value.length ? <ol className="list-decimal space-y-2 pl-5">
    {value.map((item, index) => <li key={index}><Value value={item}/></li>)}
  </ol> : <span className="italic">Пустой список</span>;
  const entries = Object.entries(value);
  return entries.length ? <dl className="space-y-2">
    {entries.map(([key, item]) => <div key={key} className="min-w-0">
      <dt className="font-medium [overflow-wrap:anywhere]">{journalFieldLabel(key)}</dt>
      <dd className="min-w-0 pl-3"><Value value={item}/></dd>
    </div>)}
  </dl> : <span className="italic">Нет полей</span>;
}

export function JournalEntryDialog({ selection, scope, returnFocus, fallbackFocus, onClose }: {
  selection: Selection | null;
  scope: JournalScope;
  returnFocus: RefObject<HTMLElement | null>;
  fallbackFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [state, setState] = useState<DetailState | null>(null);
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const changes = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const id = selection?.row.id;

  useEffect(() => {
    const generation = ++request.current;
    let current = true;
    if (!id) return;
    setState({ id, status: "loading" });
    getJournalEntry(id, scope).then(detail => {
      if (current && generation === request.current) setState({ id, status: "ready", detail });
    }).catch(() => {
      if (current && generation === request.current) setState({ id, status: "error" });
    });
    return () => { current = false; };
  }, [id, scope, retry]);

  const detail = state && state.id === id && state.status === "ready" ? state.detail : null;
  const failed = state !== null && state.id === id && state.status === "error";
  const presentation = detail?.presentation;
  useEffect(() => {
    if (!detail || !scroll.current) return;
    if (selection?.section === "changes" && changes.current) {
      scroll.current.scrollTop += changes.current.getBoundingClientRect().top - scroll.current.getBoundingClientRect().top;
      changes.current.focus({ preventScroll: true });
    } else scroll.current.scrollTop = 0;
  }, [detail, selection?.section]);

  const links = presentation ? [presentation.entity, ...presentation.links,
    ...presentation.contexts.map(context => ({ ...context, type: context.kind }))]
    .filter((link, index, all) => all.findIndex(other => other.type === link.type && other.id === link.id) === index) : [];
  const closeDialog = () => { request.current++; onClose(); };
  return <Dialog open={selection !== null} onOpenChange={open => { if (!open) closeDialog(); }}>
    <DialogContent showCloseButton={false} initialFocus={close}
      finalFocus={() => returnFocus.current?.isConnected && returnFocus.current.getClientRects().length ? returnFocus.current : fallbackFocus.current}
      style={{ maxHeight: "var(--dialog-viewport-height, 100dvh)", overflow: "hidden" }}
      className="h-[100dvh] max-h-[100dvh] w-[100vw] max-w-[100vw] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-none p-0 sm:h-[90dvh] sm:max-h-[90dvh] sm:w-[95vw] sm:max-w-[95vw] sm:rounded-xl">
      <DialogHeader className="relative min-w-0 border-b px-4 py-4 pr-16! sm:px-6">
        <DialogTitle className="break-words text-lg">{presentation?.entity.label ?? selection?.row.entityLabel ?? "Событие журнала"}</DialogTitle>
        <DialogDescription>{presentation?.action.label ?? selection?.row.actionLabel}{selection ? ` · ${journalTime(selection.row.createdAt)}` : ""}</DialogDescription>
        <DialogClose render={<Button ref={close} type="button" variant="ghost" size="icon-sm" className="absolute top-3 right-3"/>}>
          <X className="size-5"/><span className="sr-only">Закрыть</span>
        </DialogClose>
      </DialogHeader>
      <div ref={scroll} className="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6" data-journal-scroll>
        {!detail && !failed ? <p role="status" className="py-8 text-muted-foreground">Загрузка события…</p> : null}
        {failed ? <div role="alert" className="space-y-3 py-8">
          <p>Не удалось загрузить событие</p>
          <Button type="button" variant="outline" onClick={() => setRetry(value => value + 1)}>Повторить</Button>
        </div> : null}
        {detail && presentation ? <div className="min-w-0 space-y-8">
          <dl className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">Время</dt><dd>{journalTime(detail.createdAt)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Пользователь</dt><dd className="[overflow-wrap:anywhere]">{presentation.actor.name}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Действие</dt><dd>{presentation.action.label}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Источник</dt><dd>{presentation.source.label}</dd></div>
            {presentation.initiator ? <div><dt className="text-xs text-muted-foreground">Инициатор</dt><dd className="[overflow-wrap:anywhere]">{presentation.initiator.name}</dd></div> : null}
            {presentation.reason ? <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Причина</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{presentation.reason}</dd></div> : null}
          </dl>
          {links.length ? <section className="space-y-2" aria-label="Связанные объекты">
            <h3 className="font-semibold">Связанные объекты</h3>
            <ul className="flex flex-wrap gap-x-5 gap-y-2">{links.map(link => <li key={`${link.type}:${link.id}`} className="min-w-0 [overflow-wrap:anywhere]">
              {link.href?.startsWith("/") && !link.href.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(link.href) ? <a href={link.href} className="text-primary underline underline-offset-4">{link.label}</a> : link.label}
            </li>)}</ul>
          </section> : null}
          <section ref={changes} tabIndex={-1} className="min-w-0 space-y-4 outline-none" aria-label="Сравнение изменений" data-journal-diff>
            <h3 className="text-lg font-semibold">Было → стало</h3>
            {presentation.changes.length === 0 ? <p className="text-muted-foreground">Нет изменений полей</p> : presentation.changes.map((change, index) => <article key={`${change.path}:${index}`} className="min-w-0 overflow-hidden rounded-lg border">
              <h4 className="bg-muted/40 px-3 py-2 font-medium [overflow-wrap:anywhere]">{change.label}</h4>
              <div className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 bg-red-50 px-3 py-3 text-red-900 dark:bg-red-950/40 dark:text-red-200" data-journal-before>
                <span aria-hidden="true" className="font-mono font-bold">−</span>
                <div className="min-w-0"><span className="sr-only">Было: </span>{change.beforeKnown ? <Value value={change.before}/> : <span className="italic">Прежнее значение не сохранено</span>}</div>
              </div>
              <div className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 bg-green-50 px-3 py-3 text-green-900 dark:bg-green-950/40 dark:text-green-200" data-journal-after>
                <span aria-hidden="true" className="font-mono font-bold">+</span>
                <div className="min-w-0"><span className="sr-only">Стало: </span>{change.afterKnown ? <Value value={change.after}/> : <span className="italic">Новое значение не сохранено</span>}</div>
              </div>
            </article>)}
          </section>
          <details className="min-w-0 rounded-lg border p-3">
            <summary className="cursor-pointer font-medium">Технические сведения</summary>
            <pre className="mt-3 min-w-0 whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">{JSON.stringify({
              id: detail.id, createdAt: detail.createdAt, entity: presentation.entity.type, entityId: presentation.entity.id,
              action: presentation.action.code, source: presentation.source.code, executor: presentation.actor,
              initiator: presentation.initiator, contexts: presentation.contexts, metadata: presentation.technical,
            }, null, 2)}</pre>
          </details>
        </div> : null}
      </div>
    </DialogContent>
  </Dialog>;
}
