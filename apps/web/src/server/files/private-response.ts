type InlineFileMode = "raster" | "pdf" | "raster-or-pdf";

type PrivateFileResponse = {
  mimeType: string;
  fileName?: string;
  size?: number;
  inline?: InlineFileMode;
  cacheControl?: string;
  vary?: string;
};

/** Домены задают режим просмотра; активные документы не получают inline даже по ошибке adapter. */
export function privateFileHeaders({ mimeType, fileName, size, inline,
  cacheControl = "private, no-store", vary = "Cookie" }: PrivateFileResponse): Headers {
  const raster = /^image\/(jpeg|png|gif|webp|avif)$/.test(mimeType);
  const pdf = mimeType === "application/pdf";
  const allowInline = (raster && (inline === "raster" || inline === "raster-or-pdf")) ||
    (pdf && (inline === "pdf" || inline === "raster-or-pdf"));
  const filename = fileName === undefined ? "" : `; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  const headers = new Headers({
    "Content-Type": mimeType,
    "Content-Disposition": `${allowInline ? "inline" : "attachment"}${filename}`,
    "Cache-Control": cacheControl,
    "Vary": vary,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
  });
  if (size !== undefined) headers.set("Content-Length", String(size));
  return headers;
}