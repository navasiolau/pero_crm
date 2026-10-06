"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { FileCategory } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { FileImageThumbnail } from "@/components/file-image-thumbnail";
import { useFileViewer } from "@/components/file-viewer";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { deleteFile } from "@/server/files/actions";
import {UploadErrorDetails} from "@/components/upload-error-details";
import {MULTI_UPLOAD_MAX_FILES,createUploadAttempt,sendUploadBatch,localUploadFailure,type BatchFileFailure,type BatchUploadItem,type UploadFailure} from "@/lib/file-upload-client";
import {
  FILE_CATEGORY_LABELS,
  FILE_STAGES,
  FILE_STAGE_LABELS,
  validateFileForCategory,
  type FileCategoryKey,
  type FileStageKey,
} from "@pero/plugin-file-stages";

export interface FileRow {
  id: string;
  fileName: string;
  category: FileCategory;
  stage: FileStageKey;
  mimeType: string;
  size: number;
  hasThumb: boolean;
  createdAt: string;
  uploaderName: string;
}

function formatSize(size: number): string {
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} МБ`;
  return `${Math.round(size / 1024)} КБ`;
}

// Блок загрузки файла. Для режима этапов (stagesEnabled) принимает stage и
// карту допустимых расширений и проверяет тип файла до отправки.
export function Uploader({
  projectId,
  productId,
  canEdit,
  stage,
  extensions,
  fixedCategory,
  excludeMeasurement = false,
  header,
  onBusyChange,
}: {
  projectId: string;
  productId?: string;
  canEdit: boolean;
  stage?: FileStageKey;
  extensions?: Record<FileCategory, string[]>;
  fixedCategory?: FileCategory;
  excludeMeasurement?: boolean;
  compact?: boolean;
  header?: ReactNode;
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState<FileCategory>(fixedCategory ?? "PHOTO");
  const [batchFailures, setBatchFailures] = useState<BatchFileFailure[]>([]);
  const [batchSummary, setBatchSummary] = useState<{succeeded:number;total:number}|null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const currentTarget=useRef('');currentTarget.current=JSON.stringify({projectId,productId,category,stage});
  const active = useRef(false);

  function buildForm(file:File){
    const form=new FormData();form.append('file',file);form.append('projectId',projectId);if(productId)form.append('productId',productId);form.append('category',category);if(stage)form.append('stage',stage);return form;
  }

  // Пакетная загрузка: каждый файл — отдельный запрос со своим clientMutationId,
  // ошибка одного файла не валит пачку; в конце — один итог и список ошибок.
  function uploadFiles(selected:File[]){
    if(active.current||selected.length===0)return;
    const selectedTarget=currentTarget.current;active.current=true;
    onBusyChange?.(true);
    setBatchFailures([]);setBatchSummary(null);
    startTransition(async () => {
      try {
        const capped=selected.slice(0,MULTI_UPLOAD_MAX_FILES);
        const truncated=selected.length-capped.length;
        const items:BatchUploadItem[]=[];const failures:BatchFileFailure[]=[];
        for(const file of capped){
          if(extensions){const validation=validateFileForCategory(category,file.name,extensions[category]);if(validation){failures.push({fileName:file.name,failure:localUploadFailure(validation)});continue;}}
          items.push({fileName:file.name,size:file.size,attempt:createUploadAttempt(buildForm(file))});
        }
        const summary=await sendUploadBatch(items);if(currentTarget.current!==selectedTarget)return;
        for(const entry of summary.results){
          if(!entry.result.ok)failures.push({fileName:entry.fileName,failure:entry.result.failure});
        }
        const succeeded=summary.results.filter((entry)=>entry.result.ok).length,total=capped.length;
        setBatchFailures(failures);setBatchSummary({succeeded,total});
        if(truncated>0)toast.error(`Выбрано больше ${MULTI_UPLOAD_MAX_FILES} файлов — загружены первые ${MULTI_UPLOAD_MAX_FILES}.`);
        if(failures.length===0){
          toast.success(total===1?"Файл загружен":`Загружено ${succeeded} из ${total}`);
        }else if(succeeded>0){
          toast.error(`Загружено ${succeeded} из ${total}. Ошибок: ${failures.length}`);
        }else{
          toast.error(total===1&&failures[0]?failures[0].failure.error:`Не загружено ни одного файла из ${total}. Ошибок: ${failures.length}`);
        }
        if(succeeded>0)router.refresh();
      } catch {
        if(currentTarget.current!==selectedTarget)return;
        setBatchFailures([{fileName:"",failure:localUploadFailure("Не получено подтверждение загрузки.")}]);
        toast.error("Не получено подтверждение загрузки.");
      } finally { active.current=false;onBusyChange?.(false); }
    });
  }

  if (!canEdit) return null;

  const uploadControl = <>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = event.target.files ? Array.from(event.target.files) : [];
            event.target.value = "";
            if (files.length > 0) uploadFiles(files);
          }}
        />
        <Button disabled={pending} onClick={() => inputRef.current?.click()}>
          <Upload className="size-4" />
          {pending ? "Загрузка…" : "Загрузить файл"}
        </Button>
  </>;

  return (
    <Card>
      <CardContent className="flex min-w-0 flex-wrap items-end gap-3 p-4">
        {!fixedCategory ? <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium">Категория</span>
          <Select
            value={category}
            disabled={pending}
            onValueChange={(value) => setCategory((value ?? "OTHER") as FileCategory)}
          >
            <SelectTrigger className="w-40">
              <SelectValue>{FILE_CATEGORY_LABELS[category as FileCategoryKey]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FILE_CATEGORY_LABELS).filter(([id]) => !excludeMeasurement || id !== "MEASUREMENT").map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div> : null}
        {header ? <header className="flex w-full min-w-0 items-center justify-between gap-3">{header}{uploadControl}</header> : uploadControl}
        {batchSummary && batchFailures.length > 0 ? <div className="w-full min-w-0" role="alert">
          <p className="break-words text-sm text-destructive">Загружено {batchSummary.succeeded} из {batchSummary.total}. Ошибок: {batchFailures.length}</p>
          <ul className="mt-1 min-w-0 list-disc space-y-1 pl-5 text-sm text-destructive">
            {batchFailures.map((entry,index) => <li key={`${entry.fileName}-${index}`} className="break-words">{entry.fileName ? `«${entry.fileName}»: ` : ""}{entry.failure.error}</li>)}
          </ul>
        </div> : null}
        <UploadErrorDetails failure={batchFailures[0]?.failure ?? null} />
      </CardContent>
    </Card>
  );
}

// Сетка фото + список документов с просмотром и удалением.
export function FileGridView({
  files,
  canEdit,
  compact = false,
  onBusyChange,
}: {
  flat?: boolean;
  files: FileRow[];
  canEdit: boolean;
  compact?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [pending] = useTransition();
  const [deleteFor, setDeleteFor] = useState<FileRow | null>(null);
  const [fileError,setFileError]=useState<UploadFailure|null>(null);
  const fileViewer = useFileViewer();

  return (
    <>
      <UploadErrorDetails failure={fileError} />
      {files.map((file) => (
        <Card
          key={file.id}
          className="min-w-0 cursor-pointer transition-colors hover:bg-accent/50"
          data-file-id={file.id}
          onClick={() => fileViewer.open(file)}
        >
          <CardContent className="flex min-w-0 flex-wrap items-center gap-3 p-3">
            <FileText className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className={compact ? "break-all text-sm" : "truncate text-sm"}>{file.fileName}</div>
              <div className="break-words text-xs text-muted-foreground">
                <Badge variant="outline" className="mr-2">
                  {FILE_CATEGORY_LABELS[file.category as FileCategoryKey]}
                </Badge>
                {formatSize(file.size)} · {file.uploaderName} ·{" "}
                {formatDate(file.createdAt)}
              </div>
            </div>
            <FileImageThumbnail file={file} onOpen={()=>fileViewer.open(file)}/>
            <a href={`/api/files/${file.id}`} download onClick={event => event.stopPropagation()}>
              <Button size="icon" variant="ghost" aria-label="Скачать">
                <Download className="size-4" />
              </Button>
            </a>
            {canEdit ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Удалить"
                disabled={pending}
                onClick={(event) => {
                  event.stopPropagation();
                  setFileError(null);
                  setDeleteFor(file);
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ))}

      {files.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Файлов пока нет
        </div>
      ) : null}
      {fileViewer.viewer}
      <ConfirmDeleteDialog
        entityLabel={`файл «${deleteFor?.fileName ?? ""}»`}
        open={!!deleteFor}
        onOpenChange={(open) => !open && setDeleteFor(null)}
        onConfirm={async () => {
          onBusyChange?.(true);
          try {
          const result = await deleteFile(deleteFor!.id);
          if (result.ok) {
            toast.success("Файл удалён");
            router.refresh();
            return true;
          }
          const failure=localUploadFailure(result.error??"Не удалось удалить файл.","confirmation");failure.code="FILE_DELETE_REJECTED";setFileError(failure);toast.error(failure.error);
          return false;
          } catch { const failure=localUploadFailure("Не удалось подтвердить удаление файла. Проверьте результат и повторите попытку.","confirmation",undefined,"unknown");failure.code="FILE_DELETE_UNKNOWN";setFileError(failure);toast.error(failure.error);return false; }
          finally { onBusyChange?.(false); }
        }}
      />
    </>
  );
}

// Вкладка «Файлы» (§13). Когда включён плагин file-stages — файлы
// группируются по этапам (Производство/Сборка/Монтаж) и при загрузке
// проверяется расширение. Иначе — прежний плоский список.
export function FilesTab({
  projectId,
  productId,
  files,
  canEdit,
  stagesEnabled = false,
  stageExtensions = null,
  flatProject = false,
}: {
  projectId: string;
  productId?: string;
  files: FileRow[];
  canEdit: boolean;
  stagesEnabled?: boolean;
  stageExtensions?: Record<FileCategory, string[]> | null;
  flatProject?: boolean;
}) {
  if (flatProject && !productId) return <div className="flex min-w-0 flex-col gap-4" data-project-files="flat"><Uploader projectId={projectId} canEdit={canEdit} extensions={stageExtensions ?? undefined} /><div className="flex min-w-0 flex-col gap-2"><FileGridView files={files} canEdit={canEdit} flat /></div></div>;

  if (!stagesEnabled) {
    return (
      <div className="flex flex-col gap-4">
        <Uploader projectId={projectId} productId={productId} canEdit={canEdit} />
        <FileGridView files={files} canEdit={canEdit} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {FILE_STAGES.map((stage) => {
        const stageFiles = files.filter((file) => file.stage === stage);
        return (
          <section key={stage} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">
                {FILE_STAGE_LABELS[stage as FileStageKey]}
              </h3>
              <Badge variant="secondary">{stageFiles.length}</Badge>
            </div>
            <Uploader
              projectId={projectId}
              productId={productId}
              canEdit={canEdit}
              stage={stage}
              extensions={stageExtensions ?? undefined}
            />
            <FileGridView files={stageFiles} canEdit={canEdit} />
          </section>
        );
      })}
      {files.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Файлов пока нет
        </div>
      ) : null}
    </div>
  );
}

// Справочник для внешних мест (оставлен для совместимости с прежним именем).
export const fileCategoryLabels = FILE_CATEGORY_LABELS as Record<
  FileCategory,
  string
>;
