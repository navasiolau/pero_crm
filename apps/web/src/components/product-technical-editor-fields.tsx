"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import FurnitureSpecifications from "@pero/kp-template/furniture-specifications";
import type { TechnicalSpecifications } from "@pero/kp-template";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function TechnicalList({ children }: { children: ReactNode }) {
  return <section className="min-w-0" aria-label="Техническое описание" data-product-technical-specifications>
    <h2 className="mb-3 text-sm font-semibold">Техническое описание</h2>
    <ol className="list-decimal space-y-3 ps-6 text-sm marker:font-medium">{children}</ol>
  </section>;
}

function fitTextarea(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  const borders = element.offsetHeight - element.clientHeight;
  element.style.height = `${element.scrollHeight + borders}px`;
}

export function TechnicalText({ label, value, onChange, onCommit, issue, disabled, autosave = false }: {
  label: string; value: string; onChange?: (value: string) => void; onCommit?: () => void;
  issue?: string | null; disabled?: boolean; autosave?: boolean;
}) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancel() { if (timer.current) clearTimeout(timer.current); timer.current = null; }
  function schedule() { cancel(); if (autosave && !composing.current) timer.current = setTimeout(() => onCommit?.(), 400); }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const editable = Boolean(onChange);
  useLayoutEffect(() => {
    if (textarea.current) fitTextarea(textarea.current);
  }, [value]);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    let active = true;
    let width = -1;
    const observer = new ResizeObserver(entries => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth === undefined || nextWidth === width) return;
      width = nextWidth;
      fitTextarea(element);
    });
    observer.observe(element);
    void document.fonts.ready.then(() => { if (active) fitTextarea(element); });
    return () => { active = false; observer.disconnect(); };
  }, [editable]);
  return <li className="min-w-0 ps-1">
    <Label htmlFor={onChange ? id : undefined} className="mb-1 block text-sm font-medium">{label}</Label>
    {onChange ? <Textarea ref={textarea} id={id} rows={1} value={value} readOnly={disabled}
      aria-invalid={Boolean(issue)} title={issue || undefined}
      className="min-h-9 resize-none overflow-hidden py-1.5 [overflow-wrap:anywhere]"
      onChange={event => { onChange(event.target.value); schedule(); }}
      onCompositionStart={() => { composing.current = true; cancel(); }}
      onCompositionEnd={() => { composing.current = false; schedule(); }}
      onBlur={() => { cancel(); if (!composing.current) onCommit?.(); }}
      onKeyDown={event => {
        if (!event.nativeEvent.isComposing && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault(); cancel(); onCommit?.();
        }
      }} /> : <div className="min-h-5 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{value}</div>}
  </li>;
}

export function NewProductTechnicalSpecifications({ value, onChange, disabled }: {
  value: TechnicalSpecifications; onChange: (value: TechnicalSpecifications) => void; disabled?: boolean;
}) {
  return <TechnicalList>{FurnitureSpecifications.CATALOG.map(item => <TechnicalText key={item.type}
    label={item.label} value={value.sections.find(section => section.type === item.type)?.value ?? ""} disabled={disabled}
    onChange={draft => {
      const existing = value.sections.find(section => section.type === item.type);
      const section = { ...item, id: existing?.id ?? crypto.randomUUID(), value: draft };
      onChange({ ...value, sections: existing ? value.sections.map(row => row.id === existing.id ? section : row) : [...value.sections, section] });
    }} />)}</TechnicalList>;
}
