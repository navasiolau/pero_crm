"use client";

import * as React from "react";
import {useRef, useState} from "react";
import {FileDeletePopover, type FileDeleteResult} from "@/components/file-delete-popover";
import {useFileViewer} from "@/components/file-viewer";
import {getViewableFileSource, type ViewableFile} from "@/lib/viewable-file";
import {cn} from "@/lib/utils";

export interface FileListItem extends ViewableFile {
  canDelete: boolean;
}

interface FileListActions {
  onDelete?: (file: FileListItem) => Promise<FileDeleteResult>;
  onDeleted?: (file: FileListItem) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function FileListRow({file, onDelete, onDeleted, onBusyChange, disabled = false, className}: FileListActions & {
  file: FileListItem;
  disabled?: boolean;
  className?: string;
}) {
  const viewer = useFileViewer();
  const nameClass = "min-w-0 flex-1 whitespace-normal break-all text-left text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring";
  return <div data-file-list-row={file.id} role="listitem" className={cn("flex min-w-0 items-center gap-2 py-1", className)}
    onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    {file.mimeType.startsWith("image/") ? (
      <button type="button" className={nameClass} onClick={() => viewer.open(file)}>{file.fileName}</button>
    ) : (
      <a href={getViewableFileSource(file)} download={file.fileName} className={nameClass}>{file.fileName}</a>
    )}
    <FileDeletePopover fileName={file.fileName} disabled={disabled || !file.canDelete || !onDelete} onBusyChange={onBusyChange}
      onConfirm={async () => {
        if (!file.canDelete || !onDelete) return {ok: false, error: "Недостаточно прав"};
        const result = await onDelete(file);
        if (result.ok) onDeleted?.(file);
        return result;
      }} />
    {viewer.viewer}
  </div>;
}

export function FileList({files, onDelete, onDeleted, onBusyChange, className, emptyLabel = "Файлов пока нет"}: FileListActions & {
  files: readonly FileListItem[];
  className?: string;
  emptyLabel?: string;
}) {
  const activeDelete = useRef<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const keyFor = (file: FileListItem) => `${file.source ?? "project"}:${file.id}`;

  async function remove(file: FileListItem): Promise<FileDeleteResult> {
    if (!onDelete || !file.canDelete) return {ok: false, error: "Недостаточно прав"};
    if (activeDelete.current) return {ok: false, error: "Дождитесь завершения удаления"};
    const key = keyFor(file);
    activeDelete.current = key;
    setDeleting(key);
    onBusyChange?.(true);
    try {
      return await onDelete(file);
    } finally {
      activeDelete.current = null;
      setDeleting(null);
      onBusyChange?.(false);
    }
  }

  if (!files.length) return <p className={cn("text-sm text-muted-foreground", className)}>{emptyLabel}</p>;
  return <div role="list" className={cn("min-w-0 space-y-1", className)}>
    {files.map(file => <FileListRow key={keyFor(file)} file={file} onDelete={onDelete ? remove : undefined} onDeleted={onDeleted}
      disabled={deleting !== null && deleting !== keyFor(file)} />)}
  </div>;
}