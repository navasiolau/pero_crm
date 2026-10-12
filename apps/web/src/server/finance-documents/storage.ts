import {documentLocalPath,atomicLocalWrite,asWebFileStream,openLocalDocument} from "@/server/files/document-storage";
import type { FinanceDocument } from "@prisma/client";
import { UPLOADS_ROOT, s3Get, s3Put, s3PutStream, storageConfiguration } from "@/lib/s3";
import { UploadError } from "@/server/files/upload-result";
import type { FinanceDocumentStorage } from "./core";

function validateStorage(document: FinanceDocument) {
  if (document.storageMode !== storageConfiguration().mode)
    throw new UploadError("FINANCE_STORAGE_CHANGED", 503, "storage-original", "Хранилище документа недоступно в текущей конфигурации");
  if (!/^finance-documents\/[0-9a-f-]{36}\/[0-9a-f]{64}$/.test(document.storageKey))
    throw new UploadError("FINANCE_STORAGE_KEY_INVALID", 500, "storage-original", "Некорректный ключ документа");
}

async function localPath(document: FinanceDocument, write: boolean) {
  return documentLocalPath(UPLOADS_ROOT, document.storageKey, write, () => Error("FINANCE_STORAGE_PATH_INVALID"));
}

export const financeDocumentStorage: FinanceDocumentStorage = {
  mode: () => storageConfiguration().mode,
  async put(document, bytes) {
    validateStorage(document);
    if (document.storageMode === "s3") return Buffer.isBuffer(bytes)
      ? s3Put(document.storageKey, bytes, document.mimeType)
      : s3PutStream(document.storageKey, bytes, document.mimeType);
    await atomicLocalWrite(await localPath(document, true), bytes);
  },
  async open(document) {
    validateStorage(document);
    if (document.storageMode === "s3") {
      const stream = await s3Get(document.storageKey);
      return asWebFileStream(stream);
    }
    const target = await localPath(document, false).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!target) return null;
    return openLocalDocument(target, document.size);
  },
};
