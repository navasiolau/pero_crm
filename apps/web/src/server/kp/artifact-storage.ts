import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { storageConfiguration } from "@/lib/s3";
import { apiFailure, KpApiError } from "./api-contract";
import { PDF_MAX_BYTES, spoolPdf, type PdfFileSource } from "./pdf-io";
import type { Readable } from "node:stream";

export const KP_ARTIFACT_MAX_BYTES = PDF_MAX_BYTES;
export type ArtifactStorageObject = { id?: string; proposalId?: string | null; contractId?: string | null;
  storageBinding: unknown; key: string; sha256: string; size: number; mimeType?: string };
type Authorize = () => Promise<unknown>;
type StorageConfig = ReturnType<typeof storageConfiguration>;
type ArtifactTransport = Pick<S3Client, "send"> & { destroy?(): void };
export type ArtifactStorageBinding = { endpoint: string; bucket: string; region?: string };
function artifactBinding(input: unknown): ArtifactStorageBinding {
  if (!input || typeof input !== "object" || Array.isArray(input)) return apiFailure("KP_STORAGE_CHANGED", 503, "Некорректная привязка хранилища");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !["endpoint", "bucket", "region"].includes(key)) || typeof value.endpoint !== "string" ||
    typeof value.bucket !== "string" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.bucket) ||
    value.region !== undefined && (typeof value.region !== "string" || !value.region.length || value.region.length > 255))
    return apiFailure("KP_STORAGE_CHANGED", 503, "Некорректная привязка хранилища");
  try {
    const endpoint = new URL(value.endpoint);
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw Error("endpoint");
    return { endpoint: endpoint.toString().replace(/\/$/, ""), bucket: value.bucket, ...(typeof value.region === "string" ? { region: value.region } : {}) };
  } catch { return apiFailure("KP_STORAGE_CHANGED", 503, "Некорректная привязка хранилища"); }
}
function verify(bytes: Uint8Array, artifact: ArtifactStorageObject) {
  if (bytes.byteLength !== artifact.size || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256)
    apiFailure("KP_ARTIFACT_CHECKSUM", 410, "Документ не прошёл проверку целостности");
}
function validate(artifact: ArtifactStorageObject, maxBytes: number) {
  const owner = artifact.proposalId ?? artifact.contractId;
  const prefix = `kp/${artifact.proposalId ? "proposals" : "contracts"}/${owner}/exports/`;
  if (!owner || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(owner) || Boolean(artifact.proposalId) === Boolean(artifact.contractId) ||
    !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > maxBytes || !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
    !artifact.key.startsWith(prefix) || artifact.key.split("/").some(part => !part || part === "." || part === "..") || /[\\\u0000-\u001f]/.test(artifact.key))
    apiFailure("KP_ARTIFACT_INVALID", 410, "Документ недоступен");
  return artifactBinding(artifact.storageBinding);
}
export function createProposalArtifactStorage(options: { maxBytes?: number; timeoutMs?: number;
  configuration?: () => StorageConfig; client?: (configuration: Extract<StorageConfig, { mode: "s3" }>) => ArtifactTransport;
} = {}) {
  const maxBytes = options.maxBytes ?? KP_ARTIFACT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > PDF_MAX_BYTES) apiFailure("KP_ARTIFACT_LIMIT_INVALID", 500, "Некорректный лимит документов");
  const timeoutMs = options.timeoutMs ?? 0;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) apiFailure("KP_ARTIFACT_LIMIT_INVALID", 500, "Некорректный таймаут документов");
  const boundedSignal = (signal?: AbortSignal) => timeoutMs > 0 ? signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) : signal ?? new AbortController().signal;
  const configuration = () => {
    const value = (options.configuration ?? storageConfiguration)();
    if (value.mode !== "s3") return apiFailure("KP_STORAGE_REQUIRED", 503, "Не настроено приватное хранилище документов");
    return value;
  };
  const bindingFor = (config: ReturnType<typeof configuration>) => artifactBinding({ endpoint: config.endpoint, bucket: config.bucket, region: config.region });
  function assertCurrentBinding(binding: ArtifactStorageBinding) {
    const config = configuration();
    const current = bindingFor(config);
    if (binding.endpoint !== current.endpoint || binding.bucket !== current.bucket || binding.region !== current.region)
      return apiFailure("KP_STORAGE_CHANGED", 503, "Изменилась привязка приватного хранилища");
    return config;
  }
  function target(binding: ArtifactStorageBinding) {
    const config = assertCurrentBinding(binding);
    return { bucket: config.bucket, client: options.client?.(config) ?? new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true, maxAttempts: 1,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }) };
  }
  async function* openRead(artifact: ArtifactStorageObject, authorize: Authorize, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    const binding = validate(artifact, maxBytes); await authorize();
    const { client, bucket } = target(binding);
    const ioSignal = boundedSignal(signal);
    let stream: (AsyncIterable<Uint8Array> & { destroy?: (error?: Error) => void }) | undefined;
    // Abort может произойти до for-await, когда обработчик error ещё не прикреплён.
    const abort = () => stream?.destroy?.();
    try {
      ioSignal.throwIfAborted();
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: artifact.key }), { abortSignal: ioSignal });
      if (!response.Body || response.ContentLength !== undefined && response.ContentLength !== artifact.size)
        return apiFailure("KP_ARTIFACT_CHECKSUM", 410, "Документ не прошёл проверку целостности");
      stream = response.Body as unknown as AsyncIterable<Uint8Array> & { destroy?: (error?: Error) => void };
      if (!(Symbol.asyncIterator in stream)) throw Error("body");
      ioSignal.addEventListener("abort", abort, { once: true });
      if (ioSignal.aborted) { abort(); ioSignal.throwIfAborted(); }
      let size = 0, pending: Uint8Array | undefined; const hash = createHash("sha256");
      try {
        for await (const chunk of stream) {
          ioSignal.throwIfAborted(); if (!(chunk instanceof Uint8Array)) throw Error("chunk");
          size += chunk.byteLength;
          if (size > artifact.size || size > maxBytes) return apiFailure("KP_ARTIFACT_CHECKSUM", 410, "Документ не прошёл проверку целостности");
          hash.update(chunk); if (pending) yield pending; pending = chunk;
        }
      } finally { stream.destroy?.(); }
      ioSignal.throwIfAborted();
      if (size !== artifact.size || hash.digest("hex") !== artifact.sha256) return apiFailure("KP_ARTIFACT_CHECKSUM", 410, "Документ не прошёл проверку целостности");
      await authorize(); ioSignal.throwIfAborted(); assertCurrentBinding(binding);
      // Последний chunk выдаётся только после полной проверки; повреждённый download не завершит Content-Length.
      if (pending) yield pending;
    } catch (error) {
      if (ioSignal.aborted) ioSignal.throwIfAborted();
      if (error instanceof KpApiError) throw error;
      if (error && typeof error === "object" && "name" in error && ["NoSuchKey", "NotFound"].includes(String(error.name)))
        return apiFailure("KP_ARTIFACT_UNAVAILABLE", 410, "Сохранённый документ недоступен");
      // Сетевой сбой не превращается в терминальное удаление источника: очередь повторит попытку.
      return apiFailure("KP_ARTIFACT_IO_FAILED", 503, "Документ временно недоступен");
    }
    finally { ioSignal.removeEventListener("abort", abort); stream?.destroy?.(); client.destroy?.(); }
  }
  const facts = <T extends ArtifactStorageObject>(artifact: T): { id: T["id"]; storageBinding: T["storageBinding"]; key: string; sha256: string; size: number } => ({ id: artifact.id, storageBinding: artifact.storageBinding, key: artifact.key, sha256: artifact.sha256, size: artifact.size });
  async function verifyArtifact<T extends ArtifactStorageObject>(artifact: T, authorize: Authorize, signal?: AbortSignal) {
    for await (const _chunk of openRead(artifact, authorize, signal)) { void _chunk; }
    return facts(artifact);
  }
  async function read(artifact: ArtifactStorageObject, authorize: Authorize, signal?: AbortSignal) {
    const chunks: Buffer[] = []; for await (const chunk of openRead(artifact, authorize, signal)) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks);
  }
  async function downloadFile(artifact: ArtifactStorageObject, authorize: Authorize, signal?: AbortSignal) {
    const file = await spoolPdf(openRead(artifact, authorize, signal), artifact, signal);
    try { await authorize(); signal?.throwIfAborted(); return file; } catch (error) { await file.dispose(); throw error; }
  }
  return {
    binding: () => bindingFor(configuration()), read, openRead, downloadFile, verify: verifyArtifact,
    async uploadAndVerify<T extends ArtifactStorageObject>(artifact: T, source: Uint8Array | PdfFileSource, authorize: Authorize, signal?: AbortSignal) {
      const binding = validate(artifact, maxBytes);
      if (source instanceof Uint8Array) verify(source, artifact);
      else if (source.size !== artifact.size || source.sha256 !== artifact.sha256) return apiFailure("KP_ARTIFACT_CHECKSUM", 410, "Документ не прошёл проверку целостности");
      await authorize();
      const { client, bucket } = target(binding);
      const ioSignal = boundedSignal(signal);
      let body: Uint8Array | Readable | undefined;
      try {
        body = source instanceof Uint8Array ? source : await source.openRead(ioSignal);
        ioSignal.throwIfAborted();
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: artifact.key, Body: body, ContentLength: artifact.size,
          ContentType: "mimeType" in artifact ? String(artifact.mimeType) : "application/octet-stream", IfNoneMatch: "*",
          ChecksumSHA256: Buffer.from(artifact.sha256, "hex").toString("base64") }),
        { abortSignal: ioSignal });
      } catch { /* Неизвестный ACK допустим только при успешном readback с hash/size. */ }
      finally { if (body && !(body instanceof Uint8Array)) body.destroy(); client.destroy?.(); }
      await authorize(); ioSignal.throwIfAborted(); return verifyArtifact(artifact, authorize, ioSignal);
    },
  };
}
