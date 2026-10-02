"use client";
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { useInlineSave } from "@/hooks/use-inline-save";
import type { InlineSaveController, InlineValue } from "@/lib/inline-save-controller";

type Props = { id: string; label: string; controller: InlineSaveController<InlineValue>; readOnly?: boolean; hint?: ReactNode };
function SaveState({ field, readOnly }: { field: ReturnType<typeof useInlineSave<InlineValue>>; readOnly?: boolean }) {
  return <div className="min-w-0 break-words text-xs" aria-live="polite">
    {field.error ? <div role="alert" className="break-words text-destructive">{field.error}</div> : <span className="text-muted-foreground">{field.status === "saving" ? "Сохраняется…" : field.status === "dirty" ? "Есть изменения" : field.status === "saved" ? "Сохранено" : ""}</span>}
    {!readOnly && field.status === "error" ? <Button type="button" variant="link" className="h-auto max-w-full px-0 text-xs" onClick={() => void field.retry()}>Повторить сохранение</Button> : null}
    {field.status === "conflict" && field.currentClientId ? <p className="break-words text-muted-foreground">Актуальный клиент: {field.currentClientLabel ?? field.currentClientId}. Сохранение моего ввода изменит телефон этого клиента.</p> : null}
    {field.status === "conflict" && field.currentValue === undefined ? <p className="break-words text-muted-foreground">Связь данных изменилась. Скопируйте свой ввод и откройте карточку заново, чтобы проверить актуального клиента.</p> : null}
    {field.status === "conflict" && field.currentValue !== undefined ? <p className="break-words text-muted-foreground">Сейчас сохранено: {field.currentValue === null ? "не задано" : String(field.currentValue)}</p> : null}
    {!readOnly && field.status === "conflict" && field.currentValue !== undefined ? <div className="flex min-w-0 flex-wrap gap-2"><Button type="button" variant="link" className="h-auto px-0 text-xs" onClick={field.acceptCurrent}>Принять сохранённое</Button><Button type="button" variant="link" className="h-auto px-0 text-xs" onClick={() => void field.rebaseAndRetry()}>Сохранить мой ввод</Button></div> : null}
  </div>;
}
export function InlineTextField({ id, label, controller, readOnly, hint, multiline, inputMode, inputClassName, largeDescription }: Props & { inputClassName?: string; multiline?: boolean; largeDescription?: boolean; inputMode?: "text" | "decimal" | "numeric" | "tel" }) {
  const field = useInlineSave(controller);
  const shared = { id, value: field.draft, readOnly, "aria-invalid": Boolean(field.error), "aria-describedby": `${id}-state`, onChange: (event: { target: { value: string } }) => field.setDraft(event.target.value), onBlur: () => { if (!readOnly) void field.commit(); }, onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && (!multiline || event.ctrlKey || event.metaKey)) { event.preventDefault(); if (!readOnly) void field.commit(); }
  } };
  return <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor={id}>{label}</Label>{multiline ? <Textarea {...shared} rows={largeDescription ? 12 : undefined} className={largeDescription ? "h-80 min-h-80 w-full max-w-full min-w-0 resize-y field-sizing-fixed" : "min-h-24 min-w-0 field-sizing-content"} /> : <Input {...shared} inputMode={inputMode} className={`min-w-0 ${inputClassName ?? ""}`} />}{hint ? <p className="break-words text-xs text-muted-foreground">{hint}</p> : null}{!readOnly || field.error || field.status === "dirty" ? <div id={`${id}-state`}><SaveState field={field} readOnly={readOnly} /></div> : null}</div>;
}
export function InlineSelectField({ id, label, controller, readOnly, hint, options, allowClear }: Props & { options: SearchableOption[]; allowClear?: boolean }) {
  const field = useInlineSave(controller);
  return <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor={id}>{label}</Label><SearchableSelect id={id} options={options} value={field.draft} disabled={readOnly} allowClear={allowClear} className="min-w-0 max-w-full" onChange={value => { field.setDraft(value); void field.commit(); }} searchPlaceholder={`Поиск: ${label.toLowerCase()}…`} />{hint ? <p className="break-words text-xs text-muted-foreground">{hint}</p> : null}{!readOnly || field.error || field.status === "dirty" ? <div id={`${id}-state`}><SaveState field={field} readOnly={readOnly} /></div> : null}</div>;
}
