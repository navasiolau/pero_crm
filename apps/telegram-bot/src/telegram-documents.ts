import type { TgMessage } from "./tg";

export const TELEGRAM_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
export interface TelegramDocument {
  fileId: string;
  uniqueId: string;
  fileName: string;
  mimeType: string;
  size?: number;
}
export interface TelegramRemoteFile { file_path?: string; file_size?: number }
export class TelegramDocumentError extends Error {}

export function documentFromMessage(message: TgMessage): TelegramDocument | null {
  if (message.document) {
    const file = message.document;
    return { fileId: file.file_id, uniqueId: file.file_unique_id, fileName: file.file_name || `Документ-${file.file_unique_id}`,
      mimeType: file.mime_type || "application/octet-stream", size: file.file_size };
  }
  const largest = message.photo?.length ? message.photo.reduce((chosen, photo) => photo.width * photo.height > chosen.width * chosen.height ? photo : chosen) : undefined;
  return largest ? { fileId: largest.file_id, uniqueId: largest.file_unique_id,
    fileName: `Фото-${largest.file_unique_id.replace(/[^A-Za-z0-9_-]/g, "").slice(0,100)}.jpg`, mimeType: "image/jpeg", size: largest.file_size } : null;
}

function sizeGuard(size: number | undefined) {
  if (size !== undefined && (!Number.isSafeInteger(size) || size <= 0 || size > TELEGRAM_DOCUMENT_MAX_BYTES))
    throw new TelegramDocumentError("Через Telegram можно загрузить файл до 20 МБ. Больший документ загрузите в CRM.");
}

export async function downloadTelegramDocument(document: TelegramDocument, dependencies: {
  origin: string; token: string;
  getFile: (fileId: string) => Promise<TelegramRemoteFile>;
  fetchFile?: typeof fetch;
}): Promise<Buffer> {
  sizeGuard(document.size);
  try {
    const metadata = await dependencies.getFile(document.fileId); sizeGuard(metadata.file_size);
    const segments = metadata.file_path?.split("/");
    if (!segments?.length || segments.some(part => !part || part === "." || part === ".." || /[\\?#:%\x00-\x1f]/.test(part)))
      throw new TelegramDocumentError("Telegram вернул некорректный путь документа. Повторите отправку файла.");
    const origin = new URL(dependencies.origin);
    if (!["https:", "http:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash)
      throw new TelegramDocumentError("Некорректная конфигурация загрузки Telegram");
    const url = `${origin.origin}/file/bot${dependencies.token}/${segments.map(encodeURIComponent).join("/")}`;
    const response = await (dependencies.fetchFile ?? fetch)(url, { redirect: "error", signal: AbortSignal.timeout(45000) });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new TelegramDocumentError("Не удалось скачать документ из Telegram. Повторите загрузку.");
    }
    const declared = response.headers.get("content-length");
    if (declared !== null) {
      try { sizeGuard(Number(declared)); }
      catch (error) { await response.body.cancel().catch(() => {}); throw error; }
    }
    const reader = response.body.getReader(), chunks: Buffer[] = []; let length = 0;
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        length += next.value.byteLength; sizeGuard(length); chunks.push(Buffer.from(next.value));
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    if (length === 0) throw new TelegramDocumentError("Получен пустой документ");
    if ((document.size !== undefined && document.size !== length) ||
        (metadata.file_size !== undefined && metadata.file_size !== length) || (declared !== null && Number(declared) !== length))
      throw new TelegramDocumentError("Документ получен не полностью. Повторите загрузку.");
    return Buffer.concat(chunks, length);
  } catch (error) {
    if (error instanceof TelegramDocumentError) throw error;
    // URL скачивания содержит token; низкоуровневые ошибки не показываются и не логируются.
    throw new TelegramDocumentError("Не удалось скачать документ из Telegram. Повторите загрузку.");
  }
}
