import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectVersionsCommand, S3Client } from "@aws-sdk/client-s3";
import { storageConfiguration } from "@/lib/s3";
import { RetentionError, normalizeRetentionBinding, sameRetentionBinding, type RetentionBinding } from "./retention-contract";
import type { RetentionStorage } from "./retention-executor";

const missing = (error: unknown) => !!error && typeof error === "object" && "name" in error && ["NoSuchKey", "NoSuchVersion", "NotFound"].includes(String(error.name));
export function createRetentionS3Storage(options: { configuration?: typeof storageConfiguration; client?: (configuration: Extract<ReturnType<typeof storageConfiguration>, { mode: "s3" }>) => Pick<S3Client, "send"> } = {}): RetentionStorage {
  const configuration = options.configuration ?? storageConfiguration;
  const config = () => { const value = configuration(); if (value.mode !== "s3") throw new RetentionError("KP_RETENTION_STORAGE_CHANGED"); return value; };
  const bindingFor = (value: ReturnType<typeof config>) => normalizeRetentionBinding({ endpoint: value.endpoint, bucket: value.bucket, region: value.region });
  const target = (binding: RetentionBinding) => {
    const current = config(); if (!sameRetentionBinding(bindingFor(current), binding)) throw new RetentionError("KP_RETENTION_STORAGE_CHANGED");
    const owned = options.client ? undefined : new S3Client({ endpoint: current.endpoint, region: current.region, forcePathStyle: true,
      maxAttempts: 1, credentials: { accessKeyId: current.accessKeyId, secretAccessKey: current.secretAccessKey } });
    return { client: options.client?.(current) ?? owned!, bucket: current.bucket, close: () => owned?.destroy() };
  };
  return {
    currentBinding: () => bindingFor(config()),
    async list(binding, key, cursor) {
      const remote = target(binding);
      try {
        const value = await remote.client.send(new ListObjectVersionsCommand({ Bucket: remote.bucket, Prefix: key,
          KeyMarker: cursor?.key, VersionIdMarker: cursor?.version }), { abortSignal: AbortSignal.timeout(45_000) });
        const entries = [...(value.Versions ?? []).map(row => ({ key: row.Key ?? "", id: row.VersionId ?? "", marker: false })),
          ...(value.DeleteMarkers ?? []).map(row => ({ key: row.Key ?? "", id: row.VersionId ?? "", marker: true }))];
        if (value.IsTruncated && !value.NextKeyMarker) throw new RetentionError("KP_RETENTION_CURSOR_INVALID");
        return { entries, ...(value.IsTruncated ? { next: { key: value.NextKeyMarker!, ...(value.NextVersionIdMarker ? { version: value.NextVersionIdMarker } : {}) } } : {}) };
      } catch (error) { if (error instanceof RetentionError) throw error; throw new RetentionError("KP_RETENTION_STORAGE_FAILED", true); }
      finally { remote.close(); }
    },
    async head(binding, key) {
      const remote = target(binding);
      try { const value = await remote.client.send(new HeadObjectCommand({ Bucket: remote.bucket, Key: key }), { abortSignal: AbortSignal.timeout(45_000) }); return { size: value.ContentLength ?? -1 }; }
      catch (error) { if (missing(error)) return null; throw new RetentionError("KP_RETENTION_STORAGE_FAILED", true); }
      finally { remote.close(); }
    },
    async digest(binding, key, versionId, maxBytes) {
      const remote = target(binding), signal = AbortSignal.timeout(45_000);
      try {
        const result = await remote.client.send(new GetObjectCommand({ Bucket: remote.bucket, Key: key, ...(versionId === null ? {} : { VersionId: versionId }) }), { abortSignal: signal });
        if (!result.Body || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 512 * 1024 * 1024 || result.ContentLength !== undefined && result.ContentLength !== maxBytes)
          throw new RetentionError("KP_RETENTION_CHECKSUM_CHANGED");
        const body = result.Body as unknown as AsyncIterable<Uint8Array> & { destroy?: () => void }, abort = () => body.destroy?.();
        const hash = createHash("sha256"); let size = 0; signal.addEventListener("abort", abort, { once: true });
        try {
          if (signal.aborted || !(Symbol.asyncIterator in body)) throw new RetentionError("KP_RETENTION_STORAGE_FAILED", true);
          for await (const chunk of body) {
            if (!(chunk instanceof Uint8Array) || (size += chunk.byteLength) > maxBytes) throw new RetentionError("KP_RETENTION_CHECKSUM_CHANGED");
            hash.update(chunk);
          }
          if (signal.aborted) throw new RetentionError("KP_RETENTION_STORAGE_FAILED", true);
          return { size, sha256: hash.digest("hex") };
        } finally { signal.removeEventListener("abort", abort); body.destroy?.(); }
      } catch (error) { if (missing(error)) return null; if (error instanceof RetentionError) throw error; throw new RetentionError("KP_RETENTION_STORAGE_FAILED", true); }
      finally { remote.close(); }
    },
    async deleteVersion(binding, key, versionId) {
      const remote = target(binding);
      try { await remote.client.send(new DeleteObjectCommand({ Bucket: remote.bucket, Key: key, ...(versionId === null ? {} : { VersionId: versionId }) }), { abortSignal: AbortSignal.timeout(45_000) }); }
      catch (error) { if (!missing(error)) throw new RetentionError("KP_RETENTION_STORAGE_FAILED", true); }
      finally { remote.close(); }
    },
  };
}
