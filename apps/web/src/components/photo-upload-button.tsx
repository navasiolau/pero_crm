"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { measurementUploadFields, type MeasurementUploadContext } from "@/lib/measurement-upload-context";
import { validateFileForCategory } from "@pero/plugin-file-stages";

// Кнопка «Фото» для замера (§6.2): открывает ВИДИМЫЙ диалог с дроп-зоной —
// файл можно перетащить или выбрать кликом. Не зависит от того, как браузер
// рисует системный диалог выбора файла (в т.ч. в средах автоматизации).
export function PhotoUploadButton({
  taskId,
  projectId,
  productId,
  stage,
  filesCount,
  size = "sm",
  extensions,
  onBusyChange,
  onUploaded,
}: MeasurementUploadContext & {
  filesCount: number;
  size?: "sm" | "default";
  extensions?: string[];
  onBusyChange?: (busy: boolean) => void;
  onUploaded?: (id: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      if (productId && !file.type.startsWith("image/")) throw Error("Выберите фотографию; документ можно приложить отдельно в блоке замера.");
      if (extensions) {
        const validation = validateFileForCategory("MEASUREMENT", file.name, extensions);
        if (validation) throw Error(validation);
      }
      const form = new FormData();
      form.append("file", file);
      const context = taskId ? { projectId, taskId } as const : { projectId, productId: productId!, stage: stage! } as const;
      for (const [key, value] of Object.entries(measurementUploadFields(context))) form.append(key, value);
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok === true && typeof data.id === "string") {
        toast.success("Фото приложено");
        onUploaded?.(data.id);
        setOpen(false);
        router.refresh();
      } else {
        setError(data.error ?? "Ошибка загрузки");
        toast.error(data.error ?? "Ошибка загрузки");
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "Не удалось загрузить фото. Проверьте соединение и повторите.";
      setError(message); toast.error(message);
    } finally {
      active.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size={size}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <Camera className="size-4" />
        {filesCount > 0 ? `Фото (${filesCount})` : "Фото"}
      </Button>

      <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
        <DialogContent onPaste={event => { const file = event.clipboardData?.files?.[0]; if (file) { event.preventDefault(); void upload(file); } }}>
          <DialogHeader>
            <DialogTitle>{productId ? "Фото замера изделия" : "Фото к задаче"}</DialogTitle>
            <DialogDescription>
              Фото или замерный лист — попадёт в проект с категорией «Замер»
            </DialogDescription>
          </DialogHeader>
          {error ? <p role="alert" className="min-w-0 break-words text-sm text-destructive">{error}</p> : null}

          <div className="flex flex-col gap-2">
            <Button variant="outline" disabled={busy} onClick={() => cameraInput.current?.click()}><Camera className="size-4" />Снять фото</Button>
            <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}><UploadCloud className="size-4" />Выбрать файл</Button>
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }} />
          </div>

          <label
            data-measurement-photo-dropzone
            className={cn(
              "flex min-h-44 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-sm text-muted-foreground transition-colors",
              dragOver
                ? "border-primary bg-primary/5 text-foreground"
                : "hover:border-primary/50 hover:bg-accent/40",
              busy && "pointer-events-none opacity-60",
            )}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void upload(file);
            }}
            onPaste={(event) => {
              const file = event.clipboardData?.files?.[0];
              if (file) {
                event.preventDefault();
                void upload(file);
              }
            }}
          >
            <UploadCloud className="size-10" />
            {busy
              ? "Загрузка…"
              : dragOver
                ? "Отпускайте файл"
                : "Перетащите файл, нажмите для выбора или вставьте из буфера (Ctrl+V)"}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = "";
              }}
            />
          </label>
        </DialogContent>
      </Dialog>
    </>
  );
}
