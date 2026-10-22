import type { ViewableFile } from "./viewable-file";

export function reportDocumentNames(row: { reportDocuments?: readonly ViewableFile[]; reportDocument?: ViewableFile | null } | null | undefined) {
  return (row?.reportDocuments ?? (row?.reportDocument ? [row.reportDocument] : [])).map(file => file.fileName).join(" ");
}
