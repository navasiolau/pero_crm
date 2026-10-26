import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdtemp, open, realpath, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { finished } from "node:stream/promises";

/** Верхняя граница существующего PostgreSQL Int; не ограничение страниц или времени рендера. */
export const PDF_MAX_BYTES = 2_147_483_647;
export type PdfStreamAsset = { mediaId: string; mimeType: string; size: number; sha256: string;
  openRead(signal?: AbortSignal): Promise<AsyncIterable<Uint8Array>> };
export type PdfFileSource = { kind: "file"; path: string; size: number; sha256: string;
  openRead(signal?: AbortSignal): Promise<Readable>; dispose(): Promise<void> };
export type PdfStreamReply = { body: ReadableStream<Uint8Array>; size: number; mimeType: string; fileName: string; disposition?: "inline" | "attachment" };
const validHash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const samePath = (left: string, right: string) => process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;

export async function* responseChunks(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const reader = body.getReader(), abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    for (;;) { const part = await reader.read(); signal?.throwIfAborted(); if (part.done) break; yield part.value; }
  } finally { signal?.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Только собственный каталог/file; очистка по точным путям, без recursive delete. */
export async function spoolPdf(input: AsyncIterable<Uint8Array>, expected: { size: number; sha256: string }, signal?: AbortSignal, root = process.env.PERO_KP_PDF_SPOOL_ROOT ?? tmpdir()): Promise<PdfFileSource> {
  if (!Number.isSafeInteger(expected.size) || expected.size < 5 || expected.size > PDF_MAX_BYTES || !validHash(expected.sha256)) throw Error("KP_PDF_METADATA_INVALID");
  const parent = path.resolve(root), parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || !samePath(await realpath(parent), parent)) throw Error("KP_PDF_SPOOL_GUARD");
  const directory = await mkdtemp(path.join(parent, "pero-kp-pdf-")); await chmod(directory, 0o700);
  const file = path.join(directory, "document.pdf"), streams = new Set<Readable>(); let created = false, disposed = false;
  const cleanup = async () => {
    if (disposed) return; disposed = true;
    const closing = [...streams].map(stream => finished(stream, { cleanup: true }).catch(() => {}));
    for (const stream of streams) stream.destroy(); await Promise.all(closing);
    if (!samePath(await realpath(directory), directory) || path.dirname(directory) !== parent || !path.basename(directory).startsWith("pero-kp-pdf-")) throw Error("KP_PDF_SPOOL_GUARD");
    if (created) { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw Error("KP_PDF_SPOOL_GUARD"); await unlink(file); }
    await rmdir(directory);
  };
  try {
    signal?.throwIfAborted(); const handle = await open(file, "wx", 0o600); created = true;
    const hash = createHash("sha256"), signature = Buffer.alloc(5); let size = 0, signatureSize = 0;
    try {
      for await (const chunk of input) {
        signal?.throwIfAborted();
        if (!(chunk instanceof Uint8Array) || size + chunk.byteLength > expected.size) throw Error("KP_PDF_SIZE_CHANGED");
        hash.update(chunk); size += chunk.byteLength;
        if (signatureSize < 5) { const count = Math.min(5 - signatureSize, chunk.byteLength); signature.set(chunk.subarray(0, count), signatureSize); signatureSize += count; }
        let offset = 0;
        while (offset < chunk.byteLength) { signal?.throwIfAborted(); const written = await handle.write(chunk, offset, chunk.byteLength - offset); if (!written.bytesWritten) throw Error("KP_PDF_SPOOL_WRITE_FAILED"); offset += written.bytesWritten; }
      }
      signal?.throwIfAborted();
      if (size !== expected.size || hash.digest("hex") !== expected.sha256 || signature.toString("ascii") !== "%PDF-") throw Error("KP_PDF_INTEGRITY_CHANGED");
    } finally { await handle.close(); }
    const original = await lstat(file);
    return { kind: "file", path: file, size: expected.size, sha256: expected.sha256, dispose: cleanup,
      async openRead(readSignal) {
        readSignal?.throwIfAborted(); if (disposed) throw Error("KP_PDF_SPOOL_DISPOSED");
        const current = await lstat(file);
        if (!current.isFile() || current.isSymbolicLink() || current.size !== original.size || current.ino !== original.ino || current.dev !== original.dev || current.mtimeMs !== original.mtimeMs || !samePath(await realpath(file), file)) throw Error("KP_PDF_SPOOL_CHANGED");
        const stream = createReadStream(file, { signal: readSignal }); streams.add(stream);
        stream.on("error", () => {}); stream.once("close", () => streams.delete(stream)); return stream;
      } };
  } catch (error) { await cleanup(); throw error; }
}

/** Отмена HTTP-ответа прерывает и находящийся в ожидании S3 body. */
export function pdfDownloadStream(producer: (signal: AbortSignal) => AsyncIterable<Uint8Array>, signal?: AbortSignal, dispose?: () => Promise<void>): ReadableStream<Uint8Array> {
  const controller = new AbortController(), combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const iterator = producer(combined)[Symbol.asyncIterator](); let closed = false;
  const close = async () => { if (closed) return; closed = true; signal?.removeEventListener("abort", abort); try { await iterator.return?.(); } finally { await dispose?.(); } };
  const abort = () => { controller.abort(signal?.reason); void close().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
  return new ReadableStream<Uint8Array>({
    async pull(target) { try { combined.throwIfAborted(); const part = await iterator.next(); if (part.done) { await close(); target.close(); } else target.enqueue(part.value); } catch (error) { await close(); target.error(error); } },
    async cancel(reason) { controller.abort(reason); await close(); },
  });
}
