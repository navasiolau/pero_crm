"use client";

import * as React from "react";
import { useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FullscreenImageViewport } from "@/components/fullscreen-image-viewport";
import { getViewableFileSource, type ViewableFile } from "@/lib/viewable-file";

export { getViewableFileSource, type ViewableFile } from "@/lib/viewable-file";
export type FileViewerVariant = "standard" | "cover-fullscreen" | "fullscreen";
export function getFileViewerPresentation(variant: FileViewerVariant = "standard", file?: Pick<ViewableFile,"mimeType">) {
  const image=file ? file.mimeType.startsWith("image/") : variant === "cover-fullscreen";
  return image||variant==='fullscreen'
    ? { fullscreen: true, showFilenameBar: !image, source: "original" as const,
      popupClassName: "top-[var(--dialog-viewport-top)] left-0 h-[var(--dialog-viewport-height,100dvh)] max-h-none w-screen max-w-none sm:max-w-none -translate-x-0 -translate-y-1/2 gap-0 overflow-hidden rounded-none border-0 p-0 ring-0 "+(image?'bg-black text-white':'flex flex-col bg-background') }
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
  if (isImage(file)) return <Dialog open={open} onOpenChange={onOpenChange} modal>
    <DialogContent data-file-viewer-variant={variant==="cover-fullscreen"?"cover-fullscreen":"image-fullscreen"} className={presentation.popupClassName} showCloseButton={false} onClick={event=>event.stopPropagation()}>
      <DialogTitle className="sr-only">Полноэкранный просмотр изображения</DialogTitle>
      <button type="button" className="absolute top-3 right-3 z-20 inline-flex size-11 items-center justify-center rounded-md text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="Закрыть полноэкранный просмотр" onClick={()=>onOpenChange(false)}><X className="size-5" /></button>
      <FullscreenImageViewport key={`${variant}:${file.source === "finance" ? "finance" : "file"}:${file.id}`} src={src} alt={file.fileName} />
    </DialogContent>
  </Dialog>;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-file-viewer-variant={presentation.fullscreen?'document-fullscreen':'standard'} className={presentation.popupClassName} showCloseButton={false}>
      <DialogTitle className="sr-only">{file.fileName}</DialogTitle>
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <span className="truncate text-sm text-muted-foreground">{file.fileName}</span>
        <div className="flex gap-1">
          <a href={src} download><Button size="icon-sm" variant="ghost" aria-label="Скачать оригинал"><Download className="size-4" /></Button></a>
          <Button size="icon-sm" variant="ghost" aria-label="Закрыть" onClick={()=>onOpenChange(false)}><X className="size-4" /></Button>
        </div>
      </div>
      <div className={presentation.fullscreen?'flex min-h-0 flex-1 items-center justify-center overflow-auto':'flex max-h-[80vh] items-center justify-center overflow-auto'}>
        {isVideo(file)?<video src={src} controls className={presentation.fullscreen?'h-full max-h-full max-w-full':'max-h-[78vh] max-w-full rounded-lg'} />:isPdf(file)?<iframe src={`${src}?view=1`} title={file.fileName} className="h-full w-full border-0"/>:<div className="space-y-3 p-6 text-center"><p>Предпросмотр для этого формата недоступен.</p><a href={src} download className="text-primary underline">Скачать оригинал</a></div>}
      </div>
    </DialogContent>
  </Dialog>;
}
export function useFileViewer(variant: FileViewerVariant="standard") {
  const [file,setFile]=useState<ViewableFile|null>(null);
  function open(file: ViewableFile) {
    const dispatch=getFileViewerDispatch(file);
    if (variant==='fullscreen'||dispatch==="image"||dispatch==="video") setFile(file);
    else if (dispatch==="pdf") window.open(`${getViewableFileSource(file)}?view=1`,"_blank","noopener");
    else { const anchor=document.createElement("a"); anchor.href=getViewableFileSource(file); anchor.download=file.fileName; anchor.click(); }
  }
  const viewer=<FileViewer file={file} open={!!file} variant={variant} onOpenChange={open=>!open&&setFile(null)} />;
  return {open,viewer};
}
