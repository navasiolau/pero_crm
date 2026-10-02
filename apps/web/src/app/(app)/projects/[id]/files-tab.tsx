"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { FileCategory } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  caption: string | null;
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
function Uploader({
  projectId,
  productId,
  canEdit,
  stage,
  extensions,
}: {
  projectId: string;
  productId?: string;
  canEdit: boolean;
  stage?: FileStageKey;
  extensions?: Record<FileCategory, string[]>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState<FileCategory>("PHOTO");
  const [caption, setCaption] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  function upload(file: File) {
    if (extensions) {
      const error = validateFileForCategory(
        category,
        file.name,
        extensions[category],
      );
      if (error) {
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
    if (caption.trim()) form.append("caption", caption.trim());
    startTransition(async () => {
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: form,
      });
      if (response.ok) {
        toast.success("Файл загружен");
        setCaption("");
        router.refresh();
      } else {
        const data = await response.json().catch(() => ({}));
        toast.error(data.error ?? "Ошибка загрузки");
      }
    });
  }

  if (!canEdit) return null;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Категория</span>
          <Select
            value={category}
            onValueChange={(value) => setCategory((value ?? "OTHER") as FileCategory)}
          >
            <SelectTrigger className="w-40">
              <SelectValue>{FILE_CATEGORY_LABELS[category as FileCategoryKey]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FILE_CATEGORY_LABELS).map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium">Пояснение</span>
          <Input
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="не обязательно"
          />
        </div>
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
      </CardContent>
    </Card>
  );
}

// Сетка фото + список документов с просмотром и удалением.
function FileGridView({
  files,
  canEdit,
  flat = false,
}: {
  flat?: boolean;
  files: FileRow[];
  canEdit: boolean;
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((file) => (
            <div key={file.id} className="group relative">
              <button
                type="button"
                className="block w-full"
                onClick={() => fileViewer.open(file)}
                title="Открыть на просмотр"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/files/${file.id}?thumb=1`}
                  alt={file.caption ?? file.fileName}
                  className="aspect-square w-full rounded-xl border object-cover transition-opacity hover:opacity-90"
                  loading="lazy"
                />
              </button>
              <div className="mt-1 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs">{file.caption ?? file.fileName}</div>
                  <div className="text-xs text-muted-foreground">
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
          className="cursor-pointer transition-colors hover:bg-accent/50"
          onClick={() => fileViewer.open(file)}
        >
          <CardContent className="flex items-center gap-3 p-3">
            {flat && file.hasThumb ? <button type="button" className="size-10 shrink-0" aria-label={`Просмотреть ${file.fileName}`} onClick={event => { event.stopPropagation(); fileViewer.open(file); }}>{ /* eslint-disable-next-line @next/next/no-img-element */ }
                <img src={`/api/files/${file.id}?thumb=1`} alt="" className="size-10 rounded-md object-cover" /></button> : <FileText className="size-5 shrink-0 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{file.caption ?? file.fileName}</div>
              <div className="text-xs text-muted-foreground">
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
          const result = await deleteFile(deleteFor!.id);
          if (result.ok) {
            toast.success("Файл удалён");
            router.refresh();
            return true;
          }
          toast.error(result.error ?? "Ошибка");
          return false;
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
