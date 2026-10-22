"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileUp, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileListRow } from "@/components/file-list";
import type { FinanceDocumentView } from "@/server/finance-documents/contracts";
import { createFinanceDocumentQueue, uploadFinanceDocumentFile, type FinanceUploadRow } from "./finance-document-queue";

/** Комплект загружается отдельными запросами, строки с ошибкой сохраняют свой UUID. */
export function FinanceDocumentUpload({ onUploaded, onBusyChange, id, disabled = false }: {
  onUploaded: (documents: FinanceDocumentView[]) => void;
  onBusyChange?: (busy: boolean) => void;
  id?: string; disabled?: boolean;
}) {
  const generatedId = useId(), inputId = id ?? generatedId, inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true), callbacks = useRef({ onUploaded, onBusyChange });
  callbacks.current = { onUploaded, onBusyChange };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [rows, setRows] = useState<FinanceUploadRow[]>([]);
  const [queue] = useState(() => createFinanceDocumentQueue(uploadFinanceDocumentFile, next => {
    if (!mounted.current) return;
    setRows(next);
    callbacks.current.onUploaded(next.flatMap(row => row.state === "READY" && row.document ? [row.document] : []));
    callbacks.current.onBusyChange?.(next.some(row => row.state !== "READY"));
  }));
  function add(files: FileList | null) { if (!disabled && files?.length) queue.add(Array.from(files)); }
  return <div className="min-w-0 space-y-2">
    <input ref={inputRef} id={inputId} type="file" multiple className="sr-only" disabled={disabled}
      onChange={event => { add(event.target.files); event.target.value = ""; }} />
    <label htmlFor={inputId} tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
      onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && !disabled) { event.preventDefault(); inputRef.current?.click(); } }}
      onDragOver={event => event.preventDefault()}
      onDrop={event => { event.preventDefault(); add(event.dataTransfer.files); }}
      onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); add(event.clipboardData.files); } }}
      className={`flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-4 text-center focus-visible:outline-2 focus-visible:outline-ring ${disabled ? "pointer-events-none opacity-60" : "hover:bg-muted/50"}`}>
      <span className="flex items-center gap-2 font-medium"><FileUp className="size-4" />Загрузить отчётные документы</span>
      <span className="text-sm text-muted-foreground">Выберите, перетащите или вставьте файлы</span>
    </label>
    <ul className="space-y-2">{rows.map(row => <li key={row.clientMutationId} className="min-w-0 rounded-lg border p-2">
      <div className="flex min-w-0 items-start gap-2"><div className="min-w-0 flex-1">
        {row.document ? <FileListRow file={{ ...row.document, canDelete: false }} /> : <p className="break-all text-sm">{row.file.name}</p>}
        <p role="status" className="text-xs text-muted-foreground">{row.state === "READY" ? "Готово" : row.state === "QUEUED" ? "В очереди"
          : row.state === "UPLOADING" ? row.progress === 100 ? "Подтверждение загрузки…" : `Загрузка ${row.progress}%`
          : row.state === "UNKNOWN" ? "Загрузка не подтверждена" : "Ошибка загрузки"}</p>
        {row.state === "UPLOADING" ? <progress aria-label={`Загрузка ${row.file.name}`} value={row.progress} max={100} className="h-1 w-full" /> : null}
        {row.error ? <p role="alert" className="break-words text-sm text-destructive">{row.error}</p> : null}
      </div>
        <Button type="button" variant="ghost" size="icon" aria-label={`Исключить ${row.file.name} из операции`}
          disabled={disabled || row.state === "UPLOADING"} onClick={() => queue.exclude(row.clientMutationId)}><X className="size-4" /></Button>
      </div>
      {row.state === "ERROR" || row.state === "UNKNOWN" ? <Button type="button" variant="outline" size="sm" disabled={disabled}
        onClick={() => queue.retry(row.clientMutationId)}><RotateCcw className="size-4" />Повторить этот файл</Button> : null}
    </li>)}</ul>
  </div>;
}
