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
import { useFileViewer } from "@/components/file-viewer";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { deleteFile } from "@/server/files/actions";
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
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function upload(file: File) {
    if (extensions) {
      const error = validateFileForCategory(
        category,
        file.name,
        extensions[category],
      );
      if (error) {
        setError(error);
        toast.error(error);
        return;
      }
    }
    const form = new FormData();
    form.append("file", file);
    form.append("projectId", projectId);
    if (productId) form.append("productId", productId);
    form.append("category", category);
    if (stage) form.append("stage", stage);
    startTransition(async () => {
      onBusyChange?.(true);
      setError(null);
      try {
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok === true && typeof data.id === "string") {
        toast.success("Файл загружен");
        router.refresh();
      } else {
        setError(data.error ?? "Ошибка загрузки");
        toast.error(data.error ?? "Ошибка загрузки");
      }
      } catch {
        setError("Не удалось загрузить файл. Повторите выбор файла.");
      } finally { onBusyChange?.(false); }
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
        <Button disabled={pending} onClick={() => inputRef.current?.click()}>
          <Upload className="size-4" />
          {pending ? "Загрузка…" : "Загрузить файл"}
        </Button>
        {error ? <p role="alert" className="w-full min-w-0 break-words text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

// Сетка фото + список документов с просмотром и удалением.
export function FileGridView({
  files,
  canEdit,
  flat = false,
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
  const fileViewer = useFileViewer();

  const photos = flat ? [] : files.filter((file) => file.hasThumb);
  const documents = flat ? files : files.filter((file) => !file.hasThumb);

  return (
    <>
      {photos.length > 0 ? (
        <div className={compact ? "grid min-w-0 grid-cols-2 gap-3" : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"}>
          {photos.map((file) => (
            <div key={file.id} data-file-id={file.id} className="group relative min-w-0">
              <button
                type="button"
                className="block w-full"
                onClick={() => fileViewer.open(file)}
                title="Открыть на просмотр"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/files/${file.id}?thumb=1`}
                  alt={file.fileName}
                  className="aspect-square w-full rounded-xl border object-cover transition-opacity hover:opacity-90"
                  loading="lazy"
                />
              </button>
              <div className="mt-1 flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className={compact ? "break-all text-xs" : "truncate text-xs"}>{file.fileName}</div>
                  <div className="break-words text-xs text-muted-foreground">
                    {FILE_CATEGORY_LABELS[file.category as FileCategoryKey]} · {file.uploaderName}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <a href={`/api/files/${file.id}`} download onClick={event => event.stopPropagation()}>
                    <Button size="icon-xs" variant="ghost" aria-label="Скачать оригинал">
                      <Download className="size-3.5" />
                    </Button>
                  </a>
                  {canEdit ? (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Удалить"
                      disabled={pending}
                      onClick={() => setDeleteFor(file)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {documents.map((file) => (
        <Card
          key={file.id}
          className="min-w-0 cursor-pointer transition-colors hover:bg-accent/50"
          data-file-id={file.id}
          onClick={() => fileViewer.open(file)}
        >
          <CardContent className="flex min-w-0 flex-wrap items-center gap-3 p-3">
            {flat && file.hasThumb ? <button type="button" className="size-10 shrink-0" aria-label={`Просмотреть ${file.fileName}`} onClick={event => { event.stopPropagation(); fileViewer.open(file); }}>{ /* eslint-disable-next-line @next/next/no-img-element */ }
                <img src={`/api/files/${file.id}?thumb=1`} alt="" className="size-10 rounded-md object-cover" /></button> : <FileText className="size-5 shrink-0 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              <div className={compact ? "break-all text-sm" : "truncate text-sm"}>{file.fileName}</div>
              <div className="break-words text-xs text-muted-foreground">
                <Badge variant="outline" className="mr-2">
                  {FILE_CATEGORY_LABELS[file.category as FileCategoryKey]}
                </Badge>
                {formatSize(file.size)} · {file.uploaderName} ·{" "}
                {new Date(file.createdAt).toLocaleDateString("ru-RU", flat ? { timeZone: "Europe/Moscow" } : undefined)}
              </div>
            </div>
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
          toast.error(result.error ?? "Ошибка");
          return false;
          } catch { toast.error("Не удалось удалить файл. Повторите попытку."); return false; }
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
