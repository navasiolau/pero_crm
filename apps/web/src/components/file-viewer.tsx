"use client";

import * as React from "react";
import { useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FullscreenImageViewport } from "@/components/fullscreen-image-viewport";
import {catalogueMediaUrl} from "@/lib/catalogue-media-url";

export interface ViewableFile { id: string; fileName: string; mimeType: string;scope?:"catalogue-media" }
export function getViewableFileSource(file:ViewableFile){return file.scope==="catalogue-media"?catalogueMediaUrl(file.id):`/api/files/${file.id}`;}
export type FileViewerVariant = "standard" | "cover-fullscreen";
export function getFileViewerPresentation(variant: FileViewerVariant = "standard", file?: Pick<ViewableFile,"mimeType">) {
  return (file ? file.mimeType.startsWith("image/") : variant === "cover-fullscreen")
    ? { fullscreen: true, showFilenameBar: false, source: "original" as const,
      popupClassName: "top-[var(--dialog-viewport-top)] left-0 h-[var(--dialog-viewport-height,100dvh)] max-h-none w-screen max-w-none sm:max-w-none -translate-x-0 -translate-y-1/2 gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white ring-0" }
    : { fullscreen: false, showFilenameBar: true, source: "original" as const, popupClassName: "max-w-4xl p-2" };
}
export function isImage(file: ViewableFile) { return file.mimeType.startsWith("image/"); }
export function isVideo(file: ViewableFile) { return file.mimeType.startsWith("video/"); }
export function isPdf(file: ViewableFile) { return file.mimeType === "application/pdf"; }
export function getFileViewerDispatch(file: ViewableFile) {
  return isImage(file) ? "image" : isVideo(file) ? "video" : isPdf(file) ? "pdf" : "download";
}

// Все фотографии — полноэкранные; защищённые оригиналы и прочие форматы сохраняют маршруты.
export function FileViewer({file,open,onOpenChange,variant="standard"}: {
  file: ViewableFile | null; open: boolean; onOpenChange: (open: boolean) => void; variant?: FileViewerVariant;
}) {
  if (!file || !open) return null;
  const presentation=getFileViewerPresentation(variant,file);
  const src=getViewableFileSource(file);
  if (presentation.fullscreen) return <Dialog open={open} onOpenChange={onOpenChange} modal>
    <DialogContent data-file-viewer-variant={variant==="cover-fullscreen"?"cover-fullscreen":"image-fullscreen"} className={presentation.popupClassName} showCloseButton={false} onClick={event=>event.stopPropagation()}>
      <DialogTitle className="sr-only">Полноэкранный просмотр изображения</DialogTitle>
      <button type="button" className="absolute top-3 right-3 z-20 inline-flex size-11 items-center justify-center rounded-md text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="Закрыть полноэкранный просмотр" onClick={()=>onOpenChange(false)}><X className="size-5" /></button>
      <FullscreenImageViewport key={`${variant}:${file.scope??"file"}:${file.id}`} src={src} alt={file.fileName} />
    </DialogContent>
  </Dialog>;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-file-viewer-variant="standard" className={presentation.popupClassName} showCloseButton={false}>
      <DialogTitle className="sr-only">{file.fileName}</DialogTitle>
      <div className="flex items-center justify-between gap-2 px-2 pt-1">
        <span className="truncate text-sm text-muted-foreground">{file.fileName}</span>
        <div className="flex gap-1">
          <a href={src} download><Button size="icon-sm" variant="ghost" aria-label="Скачать оригинал"><Download className="size-4" /></Button></a>
          <Button size="icon-sm" variant="ghost" aria-label="Закрыть" onClick={()=>onOpenChange(false)}><X className="size-4" /></Button>
        </div>
      </div>
      <div className="flex max-h-[80vh] items-center justify-center overflow-auto">{isVideo(file)?<video src={src} controls className="max-h-[78vh] max-w-full rounded-lg" />:null}</div>
    </DialogContent>
  </Dialog>;
}
export function useFileViewer(variant: FileViewerVariant="standard") {
  const [file,setFile]=useState<ViewableFile|null>(null);
  function open(file: ViewableFile) {
    const dispatch=getFileViewerDispatch(file);
    if (dispatch==="image"||dispatch==="video") setFile(file);
    else if (dispatch==="pdf") window.open(`${getViewableFileSource(file)}?view=1`,"_blank","noopener");
    else { const anchor=document.createElement("a"); anchor.href=getViewableFileSource(file); anchor.download=file.fileName; anchor.click(); }
  }
  const viewer=<FileViewer file={file} open={!!file} variant={variant} onOpenChange={open=>!open&&setFile(null)} />;
  return {open,viewer};
}
