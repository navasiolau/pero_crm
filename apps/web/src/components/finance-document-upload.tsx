"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileUp, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {FileListRow} from "@/components/file-list";
import { createRequestId } from "@/lib/request-id";
import { uploadSizeLimitError, uploadSizeLimitFor } from "@/server/files/upload-limits";
import type { FinanceDocumentView } from "@/server/finance-documents/contracts";

/** Подтверждённая загрузка документа непосредственно в форме операции. */
export function FinanceDocumentUpload({ onUploaded, onBusyChange, id, disabled = false }: {
  onUploaded: (document: FinanceDocumentView) => void;
  onBusyChange?: (busy: boolean) => void;
  id?: string;
  disabled?: boolean;
}) {
  const generatedId = useId(), inputId = id ?? generatedId, inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = useRef<{ file: File; clientMutationId: string } | null>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [uploaded, setUploaded] = useState<FinanceDocumentView | null>(null);

  async function send(file?: File) {
    if (disabled || busy.current) return;
    if (file) {
      const limit = uploadSizeLimitFor({ mimeType: file.type });
      if (file.size === 0 || file.size > limit.maxBytes) {
        setError(file.size === 0 ? "Выберите непустой файл" : uploadSizeLimitError(limit.kind)); return;
      }
      current.current = { file, clientMutationId: createRequestId() };
    }
    const request = current.current;
    if (!request) return;
    busy.current = true; setPending(true); setError(""); onBusyChange?.(true);
    try {
      const form = new FormData(); form.set("file", request.file); form.set("clientMutationId", request.clientMutationId);
      const response = await fetch("/api/finance/documents/upload", { method: "POST", body: form });
      const body = await response.json() as { ok?: boolean; document?: FinanceDocumentView; error?: string };
      if (!response.ok || !body.ok || !body.document) throw new Error(body.error ?? "Не удалось подтвердить загрузку");
      if (!mounted.current) return;
      setUploaded(body.document); current.current = null;
      onUploaded(body.document);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Не удалось загрузить документ. Повторите запрос.");
    } finally {
      busy.current = false;
      if (mounted.current) { setPending(false); onBusyChange?.(false); }
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return <div className="min-w-0 space-y-2">
    <input ref={inputRef} id={inputId} type="file" className="sr-only" disabled={disabled || pending}
      onChange={event => { const file = event.target.files?.[0]; if (file) void send(file); }} />
    <label htmlFor={inputId} tabIndex={disabled || pending ? -1 : 0} aria-disabled={disabled || pending}
      onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && !disabled && !pending) { event.preventDefault(); inputRef.current?.click(); } }}
      onDragOver={event => event.preventDefault()}
      onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void send(file); }}
      onPaste={event => { const file = event.clipboardData.files[0]; if (file) { event.preventDefault(); void send(file); } }}
      className={`flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-4 text-center focus-visible:outline-2 focus-visible:outline-ring ${disabled || pending ? "pointer-events-none opacity-60" : "hover:bg-muted/50"}`}>
      <span className="flex items-center gap-2 font-medium"><FileUp className="size-4" />{pending ? "Загрузка…" : "Загрузить отчётный документ"}</span>
      <span className="text-sm text-muted-foreground">Выберите, перетащите или вставьте файл</span>
    </label>
    {error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
      <span>{error}</span>{current.current ? <Button type="button" variant="outline" size="sm" disabled={pending || disabled} onClick={() => void send()}><RotateCcw className="size-4" />Повторить</Button> : null}
    </div> : null}
    {uploaded ? <FileListRow file={{...uploaded, canDelete: false}} /> : null}
  </div>;
}
