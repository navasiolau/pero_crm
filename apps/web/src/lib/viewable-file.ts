export interface ViewableFile {
  id: string;
  fileName: string;
  mimeType: string;
  source?: "project" | "finance";
}

/** Источник выбирает известный защищённый route, произвольный URL не принимается. */
export function getViewableFileSource(file: ViewableFile): string {
  return file.source === "finance"
    ? `/api/finance/documents/${encodeURIComponent(file.id)}`
    : `/api/files/${file.id}`;
}
