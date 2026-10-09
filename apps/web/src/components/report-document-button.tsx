"use client";
import {FileListRow} from "@/components/file-list";
import type {ViewableFile} from "@/lib/viewable-file";

/** Финансовый документ: текущий backend не предоставляет отдельного удаления. */
export function ReportDocumentButton({document}: {document: ViewableFile | null | undefined}) {
  if (!document) return null;
  return <FileListRow file={{...document, source: document.source ?? "finance", canDelete: false}} />;
}