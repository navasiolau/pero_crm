"use client";
import { createRequestId } from "@/lib/request-id";

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
import type { SketchFilePreview } from "@/lib/product-hero";
import { sketchUploadForm } from "@/lib/product-sketch-upload";
import { readSketchUploadConfirmation } from "@/lib/product-sketch-ui";

type PhotoTarget = (MeasurementUploadContext & { assignCover?: never; coverSurface?:never }) | { projectId: string; productId: string; taskId?: never; stage?: never; assignCover: true; coverSurface?:boolean };

// Кнопка «Фото» для замера (§6.2): открывает ВИДИМЫЙ диалог с дроп-зоной —
// файл можно перетащить или выбрать кликом. Не зависит от того, как браузер
// рисует системный диалог выбора файла (в т.ч. в средах автоматизации).
export function PhotoUploadButton({
  taskId,
  projectId,
  productId,
  stage,
  assignCover,
  coverSurface,
  filesCount,
  size = "sm",
  extensions,
  onBusyChange,
  onUploaded,
  beforeUpload,
  buttonLabel,
  onUncertainChange,
}: PhotoTarget & {
  filesCount: number;
  size?: "sm" | "default";
  extensions?: string[];
  onBusyChange?: (busy: boolean) => void;
  onUploaded?: (id: string, sketch?: SketchFilePreview) => void;
  beforeUpload?: () => Promise<boolean>;
  buttonLabel?: string;
  onUncertainChange?: (uncertain: boolean) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const uncertain = useRef<{file:File;id:string}|null>(null);
  const [retryAvailable,setRetryAvailable] = useState(false);

  async function upload(file: File, retry = false) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    let mutationId: string | undefined;
    try {
      if (assignCover && uncertain.current && !retry) throw Error("Повторите прежнюю загрузку, чтобы проверить её результат.");
      if (beforeUpload && !await beforeUpload()) throw Error("Сначала сохраните цену, количество и инженера изделия.");
      if (productId && !file.type.startsWith("image/")) throw Error(assignCover ? "Эскиз должен быть изображением." : "Выберите фотографию; документ можно приложить отдельно в блоке замера.");
      if (extensions) {
        const validation = validateFileForCategory(assignCover ? "PHOTO" : "MEASUREMENT", file.name, extensions);
        if (validation) throw Error(validation);
      }
      let form:FormData;
      if (assignCover) {
        mutationId = retry && uncertain.current ? uncertain.current.id : createRequestId();
        form=sketchUploadForm(file,projectId,productId!,mutationId);
      } else {
        form=new FormData();form.append("file",file);
        const context = taskId ? { projectId, taskId } as const : { projectId, productId: productId!, stage: stage! } as const;
        for (const [key, value] of Object.entries(measurementUploadFields(context))) form.append(key, value);
      }
      if (assignCover) { uncertain.current={file,id:mutationId!}; }
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (assignCover && response.ok && data.ok !== false && (data.ok !== true || typeof data.id !== "string")) throw Error("Не получено подтверждение эскиза. Повторите запрос.");
      if (response.ok && data.ok === true && typeof data.id === "string") {
        const sketch = assignCover ? readSketchUploadConfirmation(data, mutationId!) : undefined;
        uncertain.current=null;setRetryAvailable(false);
        onUncertainChange?.(false);
        toast.success("Фото приложено");
        onUploaded?.(data.id,sketch);
        setOpen(false);
        router.refresh();
      } else {
        uncertain.current=null;setRetryAvailable(false);
        onUncertainChange?.(false);
        setError(data.error ?? "Ошибка загрузки");
        toast.error(data.error ?? "Ошибка загрузки");
      }
    } catch (failure) {
      if (assignCover && uncertain.current) { setRetryAvailable(true); onUncertainChange?.(true); }
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
      {assignCover&&coverSurface?<div data-sketch-dropzone role="button" tabIndex={busy?-1:0} aria-label="Выбрать изображение эскиза" aria-disabled={busy} className="absolute inset-0 flex min-h-48 flex-col items-center justify-center gap-3 p-4 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={event=>{if(!busy&&!(event.target instanceof Element&&event.target.closest("button,input")))coverInput.current?.click();}} onKeyDown={event=>{if(event.target===event.currentTarget&&!busy&&(event.key==="Enter"||event.key===" ")){event.preventDefault();coverInput.current?.click();}}} onDragOver={event=>{event.preventDefault();if(!busy)setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={event=>{event.preventDefault();setDragOver(false);const file=event.dataTransfer.files[0];if(file&&!busy)void upload(file);}}>
        <p className="pointer-events-none text-sm text-muted-foreground">{dragOver?"Отпускайте изображение":"Добавьте эскиз"}</p>
      <Button
        variant={assignCover?"default":"outline"}
        size={assignCover?"default":size}
        className={assignCover?"h-12 bg-black px-6 text-base font-semibold text-white hover:bg-black/90":undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {assignCover?<UploadCloud className="size-5" />:<Camera className="size-4" />}
        {buttonLabel ?? (filesCount > 0 ? `Фото (${filesCount})` : "Фото")}
      </Button>
        {error?<p role="alert" className="min-w-0 break-words text-sm text-destructive">{error}</p>:null}
      </div>:      <Button
        variant={assignCover?"default":"outline"}
        size={assignCover?"default":size}
        className={assignCover?"h-12 bg-black px-6 text-base font-semibold text-white hover:bg-black/90":undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {assignCover?<UploadCloud className="size-5" />:<Camera className="size-4" />}
        {buttonLabel ?? (filesCount > 0 ? `Фото (${filesCount})` : "Фото")}
      </Button>}
      {assignCover?<input ref={coverInput} data-sketch-file-input type="file" accept="image/*" className="hidden" disabled={busy} onClick={event=>event.stopPropagation()} onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);event.target.value="";}}/>:null}

      <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
        <DialogContent onPaste={event => { const file = event.clipboardData?.files?.[0]; if (file) { event.preventDefault(); void upload(file); } }}>
          <DialogHeader>
            <DialogTitle>{assignCover ? "Добавить изображение эскиза" : productId ? "Фото замера изделия" : "Фото к задаче"}</DialogTitle>
            {!assignCover?<DialogDescription>Фото или замерный лист — попадёт в проект с категорией «Замер»</DialogDescription>:null}
          </DialogHeader>
          {error ? <p role="alert" className="min-w-0 break-words text-sm text-destructive">{error}</p> : null}
          {retryAvailable ? <Button disabled={busy} onClick={() => {if(uncertain.current)void upload(uncertain.current.file,true);}}>Повторить загрузку</Button> : null}

          <div className="flex flex-col gap-2">
            {!assignCover?<Button variant="outline" disabled={busy} onClick={() => cameraInput.current?.click()}><Camera className="size-4" />Снять фото</Button>:null}
            <Button variant="outline" disabled={busy} onClick={() => (assignCover?coverInput:fileInput).current?.click()}><UploadCloud className="size-4" />Выбрать файл</Button>
            {!assignCover?<input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }} />:null}
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
