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
import type { SketchFilePreview } from "@/lib/product-hero";
import { sketchUploadForm } from "@/lib/product-sketch-upload";
import { readSketchUploadConfirmation } from "@/lib/product-sketch-ui";
import {UploadErrorDetails} from "@/components/upload-error-details";
import {createUploadAttempt,sendFileUpload,sendUploadBatch,localUploadFailure,MULTI_UPLOAD_MAX_FILES,type BatchFileFailure,type BatchUploadItem,type UploadFailure} from "@/lib/file-upload-client";

type PhotoTarget = (MeasurementUploadContext & { assignCover?: never; coverSurface?:never; expectedSketchFileId?:never }) | { projectId: string; productId: string; taskId?: never; assignCover: true; coverSurface?:boolean; expectedSketchFileId?:string|null };

// Кнопка «Фото» для замера (§6.2): открывает ВИДИМЫЙ диалог с дроп-зоной —
// файл можно перетащить или выбрать кликом. Не зависит от того, как браузер
// рисует системный диалог выбора файла (в т.ч. в средах автоматизации).
export function PhotoUploadButton({
  taskId,
  projectId,
  productId,
  assignCover,
  coverSurface,
  expectedSketchFileId = null,
  filesCount,
  size = "sm",
  onBusyChange,
  onUploaded,
  beforeUpload,
  buttonLabel,
  onUncertainChange,
}: PhotoTarget & {
  filesCount: number;
  size?: "sm" | "default";
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
  const [error, setError] = useState<UploadFailure | null>(null);
  const [batchFailures, setBatchFailures] = useState<BatchFileFailure[]>([]);
  const currentTarget=useRef('');currentTarget.current=JSON.stringify({projectId,productId,taskId,assignCover});

  async function upload(file:File){
    if(active.current)return;active.current=true;setBusy(true);onBusyChange?.(true);setError(null);
    const selectedTarget=currentTarget.current;let mutationId:string|undefined,started=false,acknowledged=false;
    let confirmation:{httpStatus:number;requestId:string}|undefined;
    try{
      if(beforeUpload&&!await beforeUpload())throw Error('\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u0438\u0437\u0434\u0435\u043b\u0438\u044f.');
      if(productId&&!file.type.startsWith('image/'))throw Error(assignCover?'\u042d\u0441\u043a\u0438\u0437 \u0434\u043e\u043b\u0436\u0435\u043d \u0431\u044b\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435\u043c.':'\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0444\u043e\u0442\u043e\u0433\u0440\u0430\u0444\u0438\u044e.');
      mutationId=createRequestId();let form:FormData;
      if(assignCover)form=sketchUploadForm(file,projectId,productId!,mutationId,expectedSketchFileId);
      else{form=new FormData();form.append('file',file);const context=taskId?{projectId,taskId}as const:{projectId,productId:productId!}as const;for(const[key,value]of Object.entries(measurementUploadFields(context)))form.append(key,value);}
      started=true;const result=await sendFileUpload(createUploadAttempt(form,mutationId));if(currentTarget.current!==selectedTarget)return;
      if(!result.ok){setError(result.failure);toast.error(result.failure.error);return;}
      confirmation={httpStatus:result.httpStatus,requestId:result.requestId};const sketch=assignCover?readSketchUploadConfirmation(result.data,mutationId):undefined;acknowledged=true;
      toast.success('\u0424\u043e\u0442\u043e \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u043e');onUploaded?.(result.data.id,sketch);setOpen(false);router.refresh();
    }catch(failure){if(currentTarget.current!==selectedTarget)return;const message=failure instanceof Error?failure.message:'\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0444\u043e\u0442\u043e.';const diagnostic=localUploadFailure(message,started?'confirmation':'validation',mutationId,acknowledged?'committed':started?'unknown':'notCommitted',confirmation?.httpStatus,confirmation?.requestId);setError(diagnostic);toast.error(diagnostic.error);}
    finally{active.current=false;setBusy(false);onBusyChange?.(false);onUncertainChange?.(false);}
  }
  // Пакетная загрузка фото замера (не обложки): каждый файл — отдельный запрос
  // со своим clientMutationId, ошибка одного не валит пачку, в конце — один итог.
  // Обложки (assignCover) сюда не попадают и остаются строго одиночными.
  async function uploadFiles(selected:File[]){
    if(active.current||selected.length===0||assignCover)return;active.current=true;setBusy(true);onBusyChange?.(true);setError(null);setBatchFailures([]);
    const selectedTarget=currentTarget.current;
    try{
      if(beforeUpload&&!await beforeUpload())throw Error('Сначала сохраните изменения изделия.');
      const capped=selected.slice(0,MULTI_UPLOAD_MAX_FILES),truncated=selected.length-capped.length;
      const items:BatchUploadItem[]=[];const failures:BatchFileFailure[]=[];
      for(const file of capped){
        try{
          if(productId&&!file.type.startsWith('image/'))throw Error('Выберите фотографию.');
          const mutationId=createRequestId();const form=new FormData();form.append('file',file);
          const context=taskId?{projectId,taskId}as const:{projectId,productId:productId!}as const;
          for(const[key,value]of Object.entries(measurementUploadFields(context)))form.append(key,value);
          items.push({fileName:file.name,size:file.size,attempt:createUploadAttempt(form,mutationId)});
        }catch(failure){failures.push({fileName:file.name,failure:localUploadFailure(failure instanceof Error?failure.message:'Не удалось загрузить фото.')});}
      }
      const summary=await sendUploadBatch(items);if(currentTarget.current!==selectedTarget)return;
      let succeeded=0;
      for(const entry of summary.results){
        if(entry.result.ok){succeeded++;onUploaded?.(entry.result.data.id,undefined);}
        else failures.push({fileName:entry.fileName,failure:entry.result.failure});
      }
      const total=capped.length;setBatchFailures(failures);setError(failures[0]?.failure??null);
      if(truncated>0)toast.error(`Выбрано больше ${MULTI_UPLOAD_MAX_FILES} файлов — загружены первые ${MULTI_UPLOAD_MAX_FILES}.`);
      if(failures.length===0){toast.success(`Загружено ${succeeded} из ${total}`);setOpen(false);}
      else if(succeeded>0)toast.error(`Загружено ${succeeded} из ${total}. Ошибок: ${failures.length}`);
      else toast.error(total===1&&failures[0]?failures[0].failure.error:`Не загружено ни одного файла из ${total}. Ошибок: ${failures.length}`);
      if(succeeded>0)router.refresh();
    }catch(failure){if(currentTarget.current!==selectedTarget)return;const diagnostic=localUploadFailure(failure instanceof Error?failure.message:'Не удалось загрузить фото.');setError(diagnostic);setBatchFailures([{fileName:"",failure:diagnostic}]);toast.error(diagnostic.error);}
    finally{active.current=false;setBusy(false);onBusyChange?.(false);onUncertainChange?.(false);}
  }
  // Маршрутизация выбора: обложки и одиночные файлы — прежний одиночный путь,
  // несколько фото замера — пачка. Интерфейс (кнопка, зона) не меняется.
  function submitFiles(files:File[]){
    if(files.length===0||busy)return;
    if(assignCover||files.length===1)void upload(files[0]);
    else void uploadFiles(files);
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
        <UploadErrorDetails failure={error} />
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
        <DialogContent onPaste={event => { const files = event.clipboardData?.files ? Array.from(event.clipboardData.files) : []; if (files.length > 0) { event.preventDefault(); submitFiles(files); } }}>
          <DialogHeader>
            <DialogTitle>{assignCover ? expectedSketchFileId ? "Заменить изображение эскиза" : "Добавить изображение эскиза" : productId ? "Фото замера изделия" : "Фото к задаче"}</DialogTitle>
            {!assignCover?<DialogDescription>Фото или замерный лист — попадёт в раздел «Замер»</DialogDescription>:null}
          </DialogHeader>
          <UploadErrorDetails failure={error} />
          {batchFailures.length > 0 ? <div className="min-w-0" role="alert">
            <ul className="min-w-0 list-disc space-y-1 pl-5 text-sm text-destructive">
              {batchFailures.map((entry,index) => <li key={`${entry.fileName}-${index}`} className="break-words">{entry.fileName ? `«${entry.fileName}»: ` : ""}{entry.failure.error}</li>)}
            </ul>
          </div> : null}

          <div className="flex flex-col gap-2">
            {!assignCover?<Button variant="outline" disabled={busy} onClick={() => cameraInput.current?.click()}><Camera className="size-4" />Снять фото</Button>:null}
            <Button variant="outline" disabled={busy} onClick={() => (assignCover?coverInput:fileInput).current?.click()}><UploadCloud className="size-4" />Выбрать файл</Button>
            {!assignCover?<input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(event) => {
              const files = event.target.files ? Array.from(event.target.files) : [];
              event.target.value = "";
              submitFiles(files);
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
              const files = event.dataTransfer.files ? Array.from(event.dataTransfer.files) : [];
              submitFiles(files);
            }}
            onPaste={(event) => {
              const files = event.clipboardData?.files ? Array.from(event.clipboardData.files) : [];
              if (files.length > 0) {
                event.preventDefault();
                submitFiles(files);
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
              multiple={!assignCover}
              className="hidden"
              disabled={busy}
              onChange={(event) => {
                const files = event.target.files ? Array.from(event.target.files) : [];
                event.target.value = "";
                submitFiles(files);
              }}
            />
          </label>
        </DialogContent>
      </Dialog>
    </>
  );
}
