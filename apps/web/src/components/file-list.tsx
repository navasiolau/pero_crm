"use client";

import * as React from "react";
import {useRef, useState} from "react";
import {FilePrintButton} from "@/components/file-print-button";
import {FileDeletePopover, type FileDeleteResult} from "@/components/file-delete-popover";
import {useFileViewer, type FileNameTone} from "@/components/file-viewer";
import {getViewableFileSource, type FileListItem} from "@/lib/viewable-file";
import {cn} from "@/lib/utils";
import {createRequestId} from "@/lib/request-id";


interface FileListActions {
  onDelete?: (file: FileListItem, clientMutationId: string) => Promise<FileDeleteResult>;
  onDeleted?: (file: FileListItem) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function FileListRow({file, onDelete, onDeleted, onBusyChange, disabled = false, className, filenameTone = "default"}: FileListActions & {
  file: FileListItem;
  disabled?: boolean;
  className?: string;
  filenameTone?: FileNameTone;
}) {
  const viewer = useFileViewer("standard", filenameTone);
  const deletion = useRef<string | null>(null);
  const nameClass = cn("min-w-0 flex-1 whitespace-normal break-all text-left text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring", filenameTone === "red" && "text-red-600 dark:text-red-400");
  return <div data-file-list-row={file.id} data-file-id={file.id} data-file-source={file.source ?? "project"} role="listitem" className={cn("flex min-w-0 items-center gap-2 py-1", className)}
    onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    {file.mimeType.startsWith("image/") ? (
      <button type="button" className={nameClass} onClick={() => viewer.open(file)}>{file.fileName}</button>
    ) : (
      <a href={getViewableFileSource(file)} download={file.fileName} className={nameClass}>{file.fileName}</a>
    )}
    <FilePrintButton file={file} disabled={disabled} />
    <FileDeletePopover fileName={file.fileName} disabled={disabled || !file.canDelete || !onDelete} onBusyChange={onBusyChange}
      onConfirm={async () => {
        if (!file.canDelete || !onDelete) return {ok: false, error: "Недостаточно прав"};
        deletion.current ??= createRequestId();
        const result = await onDelete(file, deletion.current);
        if (result.ok) { deletion.current = null; onDeleted?.(file); }
        return result;
      }} />
    {viewer.viewer}
  </div>;
}

export function FileList({files, onDelete, onDeleted, onBusyChange, className, emptyLabel = "Файлов пока нет", filenameTone}: FileListActions & {
  files: readonly FileListItem[];
  className?: string;
  emptyLabel?: string;
  filenameTone?: FileNameTone;
}) {
  const activeDelete = useRef<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const keyFor = (file: FileListItem) => `${file.source ?? "project"}:${file.id}`;

  async function remove(file: FileListItem, clientMutationId: string): Promise<FileDeleteResult> {
    if (!onDelete || !file.canDelete) return {ok: false, error: "Недостаточно прав"};
    if (activeDelete.current) return {ok: false, error: "Дождитесь завершения удаления"};
    const key = keyFor(file);
    activeDelete.current = key;
    setDeleting(key);
    onBusyChange?.(true);
    try {
      return await onDelete(file, clientMutationId);
    } finally {
      activeDelete.current = null;
      setDeleting(null);
      onBusyChange?.(false);
    }
  }

  if (!files.length) return <p className={cn("text-sm text-muted-foreground", className)}>{emptyLabel}</p>;
  return <div role="list" className={cn("min-w-0 space-y-1", className)}>
    {files.map(file => <FileListRow key={keyFor(file)} file={file} onDelete={onDelete ? remove : undefined} onDeleted={onDeleted}
      disabled={deleting !== null && deleting !== keyFor(file)} filenameTone={filenameTone} />)}
  </div>;
}
