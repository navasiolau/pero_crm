"use client";
import {FileListRow} from "@/components/file-list";
import type {ViewableFile} from "@/lib/viewable-file";

/** Финансовый документ: текущий backend не предоставляет отдельного удаления. */
export function ReportDocumentButton({document, documents}: {document?: ViewableFile | null; documents?: readonly ViewableFile[]}) {
  const files = documents ?? (document ? [document] : []);
  if (!files.length) return null;
  return <div className="min-w-0 space-y-1">{files.map(file => <FileListRow key={file.id}
    file={{...file, source: file.source ?? "finance", canDelete: false}} />)}</div>;
}
