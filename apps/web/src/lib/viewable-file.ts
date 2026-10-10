export interface ViewableFile {
  id: string;
  fileName: string;
  mimeType: string;
  source?: "project" | "finance" | "logistics";
}

/** Источник выбирает известный защищённый route, произвольный URL не принимается. */
export function getViewableFileSource(file: ViewableFile): string {
  if (file.source === "logistics") return `/api/logistics/documents/${encodeURIComponent(file.id)}`;
  return file.source === "finance"
    ? `/api/finance/documents/${encodeURIComponent(file.id)}`
    : `/api/files/${file.id}`;
}
