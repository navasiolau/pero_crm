import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { storageConfiguration } from "@/lib/s3";
import { apiFailure, KpApiError } from "./api-contract";

export const KP_ARTIFACT_MAX_BYTES = 128 * 1024 * 1024;
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
  if (![64 * 1024 * 1024, 128 * 1024 * 1024].includes(maxBytes)) apiFailure("KP_ARTIFACT_LIMIT_INVALID", 500, "Некорректный лимит документов");
  const timeoutMs = options.timeoutMs ?? 45_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) apiFailure("KP_ARTIFACT_LIMIT_INVALID", 500, "Некорректный таймаут документов");
  const boundedSignal = (signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
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
  async function read(artifact: ArtifactStorageObject, authorize: Authorize, signal?: AbortSignal) {
    const binding = validate(artifact, maxBytes); await authorize();
    const { client, bucket } = target(binding);
    const ioSignal = boundedSignal(signal);
    let stream: (AsyncIterable<Uint8Array> & { destroy?: (error?: Error) => void }) | undefined;
    // Abort может произойти до for-await, когда обработчик error ещё не прикреплён.
    const abort = () => stream?.destroy?.();
    let bytes: Buffer;
    try {
      ioSignal.throwIfAborted();
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: artifact.key }), { abortSignal: ioSignal });
      if (!response.Body || response.ContentLength !== undefined && response.ContentLength !== artifact.size)
        return apiFailure("KP_ARTIFACT_CHECKSUM", 410, "Документ не прошёл проверку целостности");
      stream = response.Body as unknown as AsyncIterable<Uint8Array> & { destroy?: (error?: Error) => void };
      if (!(Symbol.asyncIterator in stream)) throw Error("body");
      ioSignal.addEventListener("abort", abort, { once: true });
      if (ioSignal.aborted) { abort(); ioSignal.throwIfAborted(); }
      let size = 0; const chunks: Buffer[] = [];
      try {
        for await (const chunk of stream) {
          ioSignal.throwIfAborted(); if (!(chunk instanceof Uint8Array)) throw Error("chunk");
          size += chunk.byteLength;
          if (size > artifact.size || size > maxBytes) return apiFailure("KP_ARTIFACT_CHECKSUM", 410, "Документ не прошёл проверку целостности");
          chunks.push(Buffer.from(chunk));
        }
      } finally { stream.destroy?.(); }
      ioSignal.throwIfAborted();
      bytes = Buffer.concat(chunks); verify(bytes, artifact);
    } catch (error) {
      if (error instanceof KpApiError) throw error;
      if (error && typeof error === "object" && "name" in error && ["NoSuchKey", "NotFound"].includes(String(error.name)))
        return apiFailure("KP_ARTIFACT_UNAVAILABLE", 410, "Сохранённый документ недоступен");
      // Сетевой сбой не превращается в терминальное удаление источника: очередь повторит попытку.
      return apiFailure("KP_ARTIFACT_IO_FAILED", 503, "Документ временно недоступен");
    }
    finally { ioSignal.removeEventListener("abort", abort); stream?.destroy?.(); client.destroy?.(); }
    await authorize(); ioSignal.throwIfAborted(); assertCurrentBinding(binding); return bytes;
  }
  return {
    binding: () => bindingFor(configuration()), read,
    async uploadAndVerify<T extends ArtifactStorageObject>(artifact: T, bytes: Uint8Array, authorize: Authorize, signal?: AbortSignal): Promise<{
      id: T["id"]; storageBinding: T["storageBinding"]; key: string; sha256: string; size: number;
    }> {
      const binding = validate(artifact, maxBytes); verify(bytes, artifact); await authorize();
      const { client, bucket } = target(binding);
      const ioSignal = boundedSignal(signal);
      try {
        ioSignal.throwIfAborted();
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: artifact.key, Body: bytes, ContentLength: bytes.byteLength,
          ContentType: "mimeType" in artifact ? String(artifact.mimeType) : "application/octet-stream", IfNoneMatch: "*",
          ChecksumSHA256: Buffer.from(artifact.sha256, "hex").toString("base64") }),
        { abortSignal: ioSignal });
      } catch { /* Неизвестный ACK допустим только при успешном readback с hash/size. */ }
      finally { client.destroy?.(); }
      await authorize(); ioSignal.throwIfAborted(); await read(artifact, authorize, ioSignal);
      return { id: artifact.id, storageBinding: artifact.storageBinding, key: artifact.key, sha256: artifact.sha256, size: artifact.size };
    },
  };
}
