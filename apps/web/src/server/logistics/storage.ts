import { createReadStream } from "node:fs";
import { mkdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import type { LogisticsDocument } from "@prisma/client";
import { UPLOADS_ROOT, s3Get, s3Put, storageConfiguration } from "@/lib/s3";
import { UploadError } from "@/server/files/upload-result";
import type { LogisticsDocumentStorage } from "./documents";

function validateStorage(document: LogisticsDocument) {
  if (document.storageMode !== storageConfiguration().mode)
    throw new UploadError("LOGISTICS_STORAGE_CHANGED", 503, "storage-original", "Хранилище ТТН недоступно в текущей конфигурации");
  if (!/^logistics-documents\/[0-9a-f-]{36}\/[0-9a-f]{64}$/.test(document.storageKey))
    throw new UploadError("LOGISTICS_STORAGE_KEY_INVALID", 500, "storage-original", "Некорректный ключ ТТН");
}
function within(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function localPath(document: LogisticsDocument, write: boolean) {
  const root = path.resolve(UPLOADS_ROOT), target = path.resolve(root, ...document.storageKey.split("/"));
  if (!within(root, target)) throw Error("LOGISTICS_STORAGE_PATH_INVALID");
  if (write) await mkdir(root, { recursive: true });
  const rootReal = await realpath(root);
  let directory = rootReal;
  for (const part of document.storageKey.split("/").slice(0, -1)) {
    const next = path.join(directory, part);
    if (write) await mkdir(next).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    directory = await realpath(next);
    if (!within(rootReal, directory)) throw Error("LOGISTICS_STORAGE_PATH_INVALID");
  }
  const existing = await realpath(target).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (existing && !within(rootReal, existing)) throw Error("LOGISTICS_STORAGE_PATH_INVALID");
  return target;
}
export const logisticsDocumentStorage: LogisticsDocumentStorage = {
  mode: () => storageConfiguration().mode,
  async put(document, bytes) {
    validateStorage(document);
    if (document.storageMode === "s3") return s3Put(document.storageKey, bytes, document.mimeType);
    const target = await localPath(document, true), temporary = `${target}.${randomUUID()}.pending`;
    try { await writeFile(temporary, bytes, { flag: "wx" }); await rename(temporary, target); }
    finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
  },
  async open(document) {
    validateStorage(document);
    if (document.storageMode === "s3") {
      const stream = await s3Get(document.storageKey);
      return stream instanceof Readable ? Readable.toWeb(stream) as ReadableStream<Uint8Array> : stream;
    }
    const target = await localPath(document, false).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (!target) return null;
    const info = await stat(target);
    if (!info.isFile() || info.size !== document.size) return null;
    return Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
  },
};
