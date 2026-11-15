"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { TechnicalSpecifications } from "@pero/kp-template";
import { Label } from "@/components/ui/label";
import type { TechnicalRow } from "@/lib/product-technical-editor";

export function TechnicalList({ children }: { children: ReactNode }) {
  const labelId = useId();
  return <div className="flex min-w-0 flex-col gap-1.5" data-product-technical-specifications>
    <Label id={labelId}>Техническое описание</Label>
    <div role="group" aria-labelledby={labelId} data-technical-field
      onClick={event => {
        if ((event.target as HTMLElement).closest("input,textarea")) return;
        event.currentTarget.querySelector<HTMLTextAreaElement>('[data-technical-trailing="true"] [data-technical-label]')?.focus();
      }}
      className="h-80 min-h-80 w-full max-w-full min-w-0 resize-y overflow-auto rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 md:text-sm dark:bg-input/30">
      <ol className="relative ml-6 min-h-full list-decimal p-0 [--technical-label-width:48%] before:pointer-events-none before:absolute before:inset-y-0 before:left-[var(--technical-label-width)] before:border-l before:border-input before:content-[''] md:[--technical-label-width:42%]">{children}</ol>
    </div>
  </div>;
}

export function TechnicalText({ number, row, onChange, onCommit, issue, disabled, autosave = false, trailing = false, onActive }: {
  rowId: string; number: number; row: TechnicalRow; onChange?: (row: TechnicalRow) => void;
  onCommit?: () => void; issue?: string | null; disabled?: boolean; autosave?: boolean; trailing?: boolean; onActive?: (active: boolean) => void;
}) {
  const domRowId = useId();
  const heading = useRef<HTMLTextAreaElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancel() { if (timer.current) clearTimeout(timer.current); timer.current = null; }
  function schedule() { cancel(); if (autosave && !composing.current) timer.current = setTimeout(() => onCommit?.(), 400); }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLayoutEffect(() => {
    const elements = [heading.current, textarea.current].filter((element): element is HTMLTextAreaElement => element !== null);
    if (!elements.length) return;
    let active = true;
    const widths = new WeakMap<Element, number>();
    const fit = (element: HTMLTextAreaElement) => { element.style.height = "auto"; element.style.height = `${element.scrollHeight}px`; };
    elements.forEach(fit);
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (widths.get(entry.target) === entry.contentRect.width) continue;
        widths.set(entry.target, entry.contentRect.width); fit(entry.target as HTMLTextAreaElement);
      }
    });
    elements.forEach(element => observer.observe(element));
    void document.fonts.ready.then(() => { if (active) elements.forEach(fit); });
    return () => { active = false; observer.disconnect(); };
  }, [row.label, row.value]);
  const events = {
    onCompositionStart: () => { composing.current = true; cancel(); },
    onCompositionEnd: () => { composing.current = false; schedule(); },
    onBlur: () => { cancel(); if (!composing.current) onCommit?.(); },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!event.nativeEvent.isComposing && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault(); cancel(); onCommit?.();
      }
    },
  };
  return <li className={`min-w-0${row.label === "" && row.value === "" ? " marker:text-muted-foreground" : ""}`} data-technical-row={domRowId} data-technical-trailing={trailing || undefined}
    onFocusCapture={() => onActive?.(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onActive?.(false); }}>
    {onChange ? <div className="grid min-w-0 grid-cols-[var(--technical-label-width)_minmax(0,1fr)] items-start">
      <textarea ref={heading} data-technical-label rows={1} aria-label={`Название характеристики ${number}`} placeholder="Название" value={row.label} readOnly={disabled}
        aria-invalid={Boolean(issue)} title={issue || undefined} {...events}
        className="m-0 w-full min-w-0 resize-none overflow-hidden border-0 bg-transparent p-0 pr-2 font-semibold outline-none [overflow-wrap:anywhere]"
        onChange={event => { onChange({ ...row, label: event.target.value }); schedule(); }} />
      <textarea ref={textarea} aria-label={`Значение характеристики ${number}`} rows={1} placeholder="Значение" value={row.value} readOnly={disabled}
        aria-invalid={Boolean(issue)} title={issue || undefined} {...events}
        className="m-0 min-h-0 w-full min-w-0 resize-none overflow-hidden border-0 bg-transparent p-0 pl-2 outline-none [overflow-wrap:anywhere]"
        onChange={event => { onChange({ ...row, value: event.target.value }); schedule(); }} />
    </div> : <div className="grid min-w-0 grid-cols-[var(--technical-label-width)_minmax(0,1fr)] whitespace-pre-wrap [overflow-wrap:anywhere]"><strong className="min-w-0 pr-2">{row.label}</strong><span className="min-w-0 pl-2">{row.value}</span></div>}
  </li>;
}

export function NewProductTechnicalSpecifications({ value, onChange, disabled }: {
  value: TechnicalSpecifications; onChange: (value: TechnicalSpecifications) => void; disabled?: boolean;
}) {
  const [trailing, setTrailing] = useState(() => crypto.randomUUID());
  const rows = [...value.sections, { id: trailing, label: "", value: "" }];
  return <TechnicalList>{rows.map((row, index) => <TechnicalText key={row.id} rowId={row.id} number={index + 1}
    row={row} disabled={disabled} trailing={row.id === trailing}
    onActive={active => { if (!active && row.id !== trailing && row.label === "" && row.value === "") onChange({ ...value, sections: value.sections.filter(item => item.id !== row.id) }); }} onChange={pair => {
      const existing = value.sections.find(section => section.id === row.id);
      const section = existing ? { ...existing, ...pair } : { id: row.id, type: "custom" as const, group: "construction" as const, ...pair };
      onChange({ ...value, sections: existing ? value.sections.map(item => item.id === row.id ? section : item) : [...value.sections, section] });
      if (row.id === trailing && (pair.label !== "" || pair.value !== "")) setTrailing(crypto.randomUUID());
    }} />)}</TechnicalList>;
}
