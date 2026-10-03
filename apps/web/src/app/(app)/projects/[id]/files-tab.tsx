"use client";

import { useRef, useState, useTransition } from "react";
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
import {createUploadAttempt,sendFileUpload,localUploadFailure,uploadAttemptMatchesContext,type UploadAttempt,type UploadFailure} from "@/lib/file-upload-client";
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
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState<FileCategory>(fixedCategory ?? "PHOTO");
  const [error, setError] = useState<UploadFailure | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uncertain = useRef<UploadAttempt | null>(null);
  const active = useRef(false);

  function upload(file?: File,retry=false) {
    if(active.current)return;
    if(uncertain.current&&!retry){const failure=localUploadFailure("Повторите прежнюю загрузку, чтобы проверить её результат.","confirmation",uncertain.current.clientMutationId,"unknown");setError(failure);toast.error(failure.error);return;}
    if(retry&&uncertain.current&&!uploadAttemptMatchesContext(uncertain.current,{projectId,productId,category,stage})){setError(localUploadFailure("Контекст изменился. Откройте прежнюю карточку для проверки загрузки.","confirmation",uncertain.current.clientMutationId,"unknown"));return;}
    if (!retry && file && extensions) {
      const error = validateFileForCategory(
        category,
        file.name,
        extensions[category],
      );
      if (error) {
        setError(localUploadFailure(error));
        toast.error(error);
        return;
      }
    }
    let attempt=retry?uncertain.current:null;
    if(!attempt){if(!file)return;const form=new FormData();form.append("file",file);form.append("projectId",projectId);if(productId)form.append("productId",productId);form.append("category",category);if(stage)form.append("stage",stage);attempt=createUploadAttempt(form);}
    const request=attempt;active.current=true;
    startTransition(async () => {
      let confirmation:{httpStatus:number;requestId:string}|undefined;
      onBusyChange?.(true);
      setError(null);
      try {
      uncertain.current=request;
      const result=await sendFileUpload(request);
      if (result.ok) {
        confirmation={httpStatus:result.httpStatus,requestId:result.requestId};
        uncertain.current=null;
        toast.success("Файл загружен");
        router.refresh();
      } else {
        if(result.failure.commitState==="notCommitted")uncertain.current=null;
        setError(result.failure);toast.error(result.failure.error);
      }
      } catch {
        setError(localUploadFailure(confirmation?"Файл загружен, но интерфейс не обновился. Обновите страницу.":"Не получено подтверждение загрузки. Повторите прежний запрос.","confirmation",request.clientMutationId,confirmation?"committed":"unknown",confirmation?.httpStatus,confirmation?.requestId));
      } finally { active.current=false;onBusyChange?.(false); }
    });
  }

  if (!canEdit) return null;

  return (
    <Card>
      <CardContent className="flex min-w-0 flex-wrap items-end gap-3 p-4">
        {!fixedCategory ? <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium">Категория</span>
          <Select
            value={category}
            disabled={pending||Boolean(uncertain.current)}
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
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload(file);
            event.target.value = "";
          }}
        />
        <Button disabled={pending||Boolean(uncertain.current)} onClick={() => inputRef.current?.click()}>
          <Upload className="size-4" />
          {pending ? "Загрузка…" : "Загрузить файл"}
        </Button>
        {uncertain.current?<Button type="button" variant="outline" disabled={pending} onClick={()=>upload(undefined,true)}>Повторить прежнюю загрузку</Button>:null}
        <UploadErrorDetails failure={error} />
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
