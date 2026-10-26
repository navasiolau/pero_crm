import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { storageConfiguration } from "@/lib/s3";
import { KP_IMAGE_MAX_BYTES, ProposalMediaError, mediaSha256, parseMediaBinding, sameMediaBinding,
  type MediaBinding, type MediaObject } from "./media-contract";

/** Адаптер не выполняет удалений и не имеет локального fallback. */
export interface ProposalMediaStorage {
  currentBinding(): MediaBinding;
  putIfAbsent(binding: MediaBinding, object: MediaObject, bytes: Buffer): Promise<void>;
  read(binding: MediaBinding, object: MediaObject, signal?: AbortSignal): Promise<Buffer | null>;
  openRead?(binding: MediaBinding, object: MediaObject, signal?: AbortSignal): AsyncIterable<Uint8Array>;
}

export function assertMediaStorageBinding(storage: Pick<ProposalMediaStorage, "currentBinding">, binding: MediaBinding): void {
  if (!sameMediaBinding(storage.currentBinding(), binding)) throw new ProposalMediaError("KP_MEDIA_STORAGE_CHANGED");
}
export function verifyMediaBytes(bytes: Buffer, object: MediaObject): void {
  if (!Number.isSafeInteger(object.size) || object.size <= 0 || object.size > KP_IMAGE_MAX_BYTES ||
    bytes.length !== object.size || mediaSha256(bytes) !== object.sha256) throw new ProposalMediaError("KP_MEDIA_CHECKSUM_MISMATCH");
}

/** Неопределённый ACK/PreconditionFailed разрешаются фактическим Get, чужие байты не перезаписываются. */
export async function putVerifiedProposalMedia(storage: ProposalMediaStorage, binding: MediaBinding, object: MediaObject,
  bytes: Buffer, assertActive: () => Promise<void> = async () => {}): Promise<void> {
  verifyMediaBytes(bytes, object);
  await assertActive(); assertMediaStorageBinding(storage, binding);
  try { await storage.putIfAbsent(binding, object, bytes); }
  catch { /* Неизвестный ACK допустим только при успешной сверке readback ниже. */ }
  await assertActive(); assertMediaStorageBinding(storage, binding);
  let actual: Buffer | null;
  try { actual = await storage.read(binding, object); }
  catch (error) {
    if (error instanceof ProposalMediaError) throw error;
    throw new ProposalMediaError("KP_MEDIA_STORAGE_FAILED");
  }
  assertMediaStorageBinding(storage, binding);
  if (actual === null) throw new ProposalMediaError("KP_MEDIA_STORAGE_FAILED");
  verifyMediaBytes(actual, object);
}

type S3Transport = Pick<S3Client, "send">;
type StorageConfig = ReturnType<typeof storageConfiguration>;
export function createProposalMediaS3Storage(options: {
  configuration?: () => StorageConfig; client?: (configuration: Extract<StorageConfig, { mode: "s3" }>) => S3Transport;
} = {}): ProposalMediaStorage {
  const configuration = options.configuration ?? storageConfiguration;
  const config = () => {
    const value = configuration();
    if (value.mode !== "s3") throw new ProposalMediaError("KP_MEDIA_STORAGE_CHANGED");
    return value;
  };
  const bindingFor = (value: Extract<StorageConfig, { mode: "s3" }>) =>
    parseMediaBinding({ endpoint: value.endpoint, bucket: value.bucket, region: value.region });
  const target = (expected: MediaBinding) => {
    const current = config();
    if (!sameMediaBinding(bindingFor(current), expected)) throw new ProposalMediaError("KP_MEDIA_STORAGE_CHANGED");
    const ownedClient = options.client ? undefined : new S3Client({ endpoint: current.endpoint, region: current.region,
      forcePathStyle: true, maxAttempts: 1,
      credentials: { accessKeyId: current.accessKeyId, secretAccessKey: current.secretAccessKey } });
    const client = options.client?.(current) ?? ownedClient!;
    return { client, bucket: current.bucket, release: () => ownedClient?.destroy() };
  };
  async function* openRead(binding: MediaBinding, object: MediaObject, callerSignal?: AbortSignal): AsyncGenerator<Uint8Array> {
    if (!Number.isSafeInteger(object.size) || object.size < 1 || object.size > KP_IMAGE_MAX_BYTES) throw new ProposalMediaError("KP_MEDIA_CHECKSUM_MISMATCH");
    const { client, bucket, release } = target(binding), signal = callerSignal ?? AbortSignal.timeout(45_000);
    let body: (AsyncIterable<Uint8Array> & { destroy?: () => void }) | undefined; const abort = () => body?.destroy?.();
    try {
      signal.throwIfAborted(); const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.key }), { abortSignal: signal });
      if (!result.Body || result.ContentLength !== undefined && result.ContentLength !== object.size) throw new ProposalMediaError("KP_MEDIA_CHECKSUM_MISMATCH");
      body = result.Body as unknown as AsyncIterable<Uint8Array> & { destroy?: () => void };
      if (!(Symbol.asyncIterator in body)) throw new ProposalMediaError("KP_MEDIA_STORAGE_FAILED");
      signal.addEventListener("abort", abort, { once: true }); signal.throwIfAborted();
      const hash = createHash("sha256"); let size = 0;
      for await (const chunk of body) { signal.throwIfAborted(); if (!(chunk instanceof Uint8Array) || (size += chunk.byteLength) > object.size) throw new ProposalMediaError("KP_MEDIA_CHECKSUM_MISMATCH"); hash.update(chunk); yield chunk; }
      signal.throwIfAborted(); assertMediaStorageBinding({ currentBinding: () => bindingFor(config()) }, binding);
      if (size !== object.size || hash.digest("hex") !== object.sha256) throw new ProposalMediaError("KP_MEDIA_CHECKSUM_MISMATCH");
    } catch (error) { if (signal.aborted) signal.throwIfAborted(); throw error; }
    finally { signal.removeEventListener("abort", abort); body?.destroy?.(); release(); }
  }
  return {
    currentBinding: () => bindingFor(config()), openRead,
    async putIfAbsent(binding, object, bytes) {
      verifyMediaBytes(bytes, object);
      const { client, bucket, release } = target(binding);
      try {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: object.key, Body: bytes,
          ContentType: object.mimeType, ContentLength: object.size,
          ChecksumSHA256: Buffer.from(object.sha256, "hex").toString("base64"), IfNoneMatch: "*" }),
          { abortSignal: AbortSignal.timeout(45_000) });
      } catch { throw new ProposalMediaError("KP_MEDIA_STORAGE_FAILED"); }
      finally { release(); }
    },
    async read(binding, object, signal) {
      try {
        const chunks: Buffer[] = []; for await (const chunk of openRead(binding, object, signal)) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks);
      } catch (error) {
        if (error && typeof error === "object" && "name" in error && ["NoSuchKey", "NotFound"].includes(String(error.name))) return null;
        if (error instanceof ProposalMediaError) throw error;
        throw new ProposalMediaError("KP_MEDIA_STORAGE_FAILED");
      }
    },
  };
}
