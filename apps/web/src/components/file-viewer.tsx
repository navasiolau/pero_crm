"use client";

import { useState } from "react";
import { Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ViewableFile {
  id: string;
  fileName: string;
  mimeType: string;
}

export function isImage(file: ViewableFile) {
  return file.mimeType.startsWith("image/");
}
export function isVideo(file: ViewableFile) {
  return file.mimeType.startsWith("video/");
}
export function isPdf(file: ViewableFile) {
  return file.mimeType === "application/pdf";
}

// Просмотрщик вложений (§13): изображения и видео — в лайтбоксе,
// PDF — в отдельной вкладке браузера, прочие форматы (b3d и т.п.) — только скачивание.
export function FileViewer({
  file,
  open,
  onOpenChange,
}: {
  file: ViewableFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!file) return null;
  const src = `/api/files/${file.id}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-2" showCloseButton={false}>
        <DialogTitle className="sr-only">{file.fileName}</DialogTitle>
        <div className="flex items-center justify-between gap-2 px-2 pt-1">
          <span className="truncate text-sm text-muted-foreground">
            {file.fileName}
          </span>
          <div className="flex gap-1">
            <a href={src} download>
              <Button size="icon-sm" variant="ghost" aria-label="Скачать оригинал">
                <Download className="size-4" />
              </Button>
            </a>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Закрыть"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
        <div className="flex max-h-[80vh] items-center justify-center overflow-auto">
          {isImage(file) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={file.fileName}
              className="max-h-[78vh] max-w-full rounded-lg object-contain"
            />
          ) : isVideo(file) ? (
            <video src={src} controls className="max-h-[78vh] max-w-full rounded-lg" />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Клик по файлу: картинка/видео — лайтбокс, PDF — новая вкладка, прочее — скачивание.
export function useFileViewer() {
  const [file, setFile] = useState<ViewableFile | null>(null);

  function open(file: ViewableFile) {
    if (isImage(file) || isVideo(file)) {
      setFile(file);
    } else if (isPdf(file)) {
      window.open(`/api/files/${file.id}`, "_blank", "noopener");
    } else {
      const anchor = document.createElement("a");
      anchor.href = `/api/files/${file.id}`;
      anchor.download = file.fileName;
      anchor.click();
    }
  }

  const viewer = (
    <FileViewer file={file} open={!!file} onOpenChange={(open) => !open && setFile(null)} />
  );

  return { open, viewer };
}
