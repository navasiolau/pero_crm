"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createRequestId } from "@/lib/request-id";
import { uploadTimeoutMsForSize } from "@/lib/file-upload-client";
import { uploadSizeLimitError, uploadSizeLimitFor } from "@/server/files/upload-limits";
import type { LogisticsDocumentView } from "@/server/logistics/contracts";

type Attempt = {
  file: File; clientMutationId: string; stage: "ISSUED" | "SIGNED"; ttnNumber: string;
  status: "pending" | "uploaded" | "failed"; error?: string;
};
export function LogisticsDocumentUpload({ tripId, defaultStage = "ISSUED", onUploaded, onBusyChange, disabled = false }: {
  tripId: string; defaultStage?: "ISSUED" | "SIGNED"; onUploaded: (document: LogisticsDocumentView) => void;
  onBusyChange: (busy: boolean) => void; disabled?: boolean;
}) {
  const inputId = useId(), fileInput = useRef<HTMLInputElement>(null), mounted = useRef(true), busy = useRef(false);
  const attempts = useRef<Attempt[]>([]);
  const [items, setItems] = useState<Attempt[]>([]);
  const [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const [stage, setStage] = useState<"ISSUED" | "SIGNED">(defaultStage);
  const [ttnNumber, setTtnNumber] = useState(""), [confirmed, setConfirmed] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const publish = () => { if (mounted.current) setItems(attempts.current.map(item => ({ ...item }))); };

  async function send(files?: File[]) {
    if (busy.current || disabled) return;
    if (files) {
      if (!confirmed) { setMessage("Подтвердите наличие выбранных печатей на ТТН"); return; }
      const selected: Attempt[] = [];
      for (const file of files) {
        const limit = uploadSizeLimitFor({ mimeType: file.type });
        if (!file.size || file.size > limit.maxBytes) {
          setMessage(file.name + ": " + (!file.size ? "файл пустой" : uploadSizeLimitError(limit.kind))); return;
        }
        selected.push({ file, clientMutationId: createRequestId(), stage, ttnNumber, status: "pending" });
      }
      attempts.current.push(...selected);
    }
    if (!attempts.current.some(item => item.status !== "uploaded")) return;
    busy.current = true; setPending(true); setMessage(""); onBusyChange(true); publish();
    try {
      // Все выбранные файлы обрабатываются последовательно, без ограничения их количества.
      for (const item of attempts.current.filter(candidate => candidate.status !== "uploaded")) {
        item.status = "pending"; item.error = undefined; publish();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), uploadTimeoutMsForSize(item.file.size));
        try {
          const form = new FormData();
          form.set("file", item.file); form.set("tripId", tripId);
          form.set("clientMutationId", item.clientMutationId); form.set("stage", item.stage);
          form.set("ttnNumber", item.ttnNumber);
          const response = await fetch("/api/logistics/documents/upload", { method: "POST", body: form, signal: controller.signal });
          const body = await response.json() as { ok?: boolean; document?: LogisticsDocumentView; error?: string };
          if (!response.ok || !body.ok || !body.document || body.document.tripId !== tripId || body.document.source !== "logistics")
            throw new Error(body.error ?? "Не удалось подтвердить загрузку. Повторите тот же файл.");
          item.status = "uploaded";
          if (mounted.current) onUploaded(body.document);
        } catch (error) {
          item.status = "failed"; item.error = error instanceof Error ? error.message : "Загрузка не подтверждена";
        } finally { clearTimeout(timer); publish(); }
      }
    } finally {
      busy.current = false;
      if (mounted.current) { setPending(false); setConfirmed(false); onBusyChange(false); }
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Номер ТТН
          <Input value={ttnNumber} maxLength={120} disabled={disabled || pending} onChange={event => setTtnNumber(event.target.value)} placeholder="Номер накладной (необязательно)" />
        </label>
        <label className="space-y-1 text-sm">Оформление документа
          <select className="min-h-10 w-full rounded-lg border bg-background px-3" value={stage} disabled={disabled || pending}
            onChange={event => { setStage(event.target.value as "ISSUED" | "SIGNED"); setConfirmed(false); }}>
            <option value="ISSUED">ТТН с одной печатью</option><option value="SIGNED">ТТН с двумя печатями</option>
          </select>
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 size-4" checked={confirmed} disabled={disabled || pending}
          onChange={event => setConfirmed(event.target.checked)} />
        Подтверждаю, что на загружаемой ТТН есть выбранное количество печатей
      </label>
      <input ref={fileInput} id={inputId} type="file" multiple className="sr-only" disabled={disabled || pending || !confirmed}
        onChange={event => { if (event.target.files) void send(Array.from(event.target.files)); }} />
      <label htmlFor={inputId} tabIndex={disabled || pending || !confirmed ? -1 : 0}
        aria-disabled={disabled || pending || !confirmed}
        onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && confirmed && !disabled && !pending) { event.preventDefault(); fileInput.current?.click(); } }}
        onDragOver={event => event.preventDefault()}
        onDrop={event => { event.preventDefault(); if (!disabled && !pending) void send(Array.from(event.dataTransfer.files)); }}
        onPaste={event => { if (event.clipboardData.files.length && !disabled && !pending) { event.preventDefault(); void send(Array.from(event.clipboardData.files)); } }}
        className={"flex min-h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-4 text-center " + (disabled || pending || !confirmed ? "opacity-60" : "cursor-pointer hover:bg-muted/50")}>
        <span className="flex items-center gap-2 font-medium"><FileUp className="size-4" />{pending ? "Загрузка ТТН…" : "Добавить файлы ТТН"}</span>
        <span className="text-xs text-muted-foreground">Выберите, перетащите или вставьте файлы. Количество не ограничено.</span>
      </label>
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      {items.filter(item => item.status !== "uploaded").map(item => (
        <p key={item.clientMutationId} role={item.error ? "alert" : undefined} className="break-all text-sm">
          {item.file.name}: {item.status === "failed" ? item.error : "Загружается…"}
        </p>
      ))}
      {items.some(item => item.status === "failed") && (
        <Button type="button" variant="outline" disabled={disabled || pending} onClick={() => void send()}>
          Повторить неуспешные загрузки
        </Button>
      )}
    </div>
  );
}
