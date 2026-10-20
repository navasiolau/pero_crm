import { GetObjectCommand, ListObjectsV2Command, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { ArchiveImportError, archiveAssert, jsonClone, parseSourceProfile, valueHash, type ArchiveSource, type Binding, type SourceArea, type SourceProfile } from "./contract";

type Credentials = { accessKeyId: string; secretAccessKey: string };
export type SourceConfiguration = { profile: SourceProfile; credentials: { public: Credentials; contracts: Credentials } };

/** Только точный object-not-found. Отсутствующий bucket, отказ прав и произвольный HTTP 404 не разрешают recovery. */
export function isArchiveObjectNotFound(error: unknown): boolean {
  return error instanceof Error && ["NoSuchKey", "NotFound"].includes(error.name) && "$metadata" in error &&
    typeof error.$metadata === "object" && error.$metadata !== null && "httpStatusCode" in error.$metadata && error.$metadata.httpStatusCode === 404;
}
export function normalizeArchiveSourceReadError(error: unknown): unknown {
  return isArchiveObjectNotFound(error) ? new ArchiveImportError("ARCHIVE_SOURCE_MISSING") : error;
}

/** Только List/Get. Legacy handler/env.js не импортируются и write/delete команды отсутствуют. */
export function createReadonlyArchiveSource(expected: SourceProfile, configuration: () => SourceConfiguration,
  makeClient: (configuration: S3ClientConfig) => S3Client = configuration => new S3Client(configuration)): ArchiveSource & { close(): Promise<void> } {
  const pinned = parseSourceProfile(expected);
  type Connection = { s3: S3Client; identity: string; area: SourceArea; active: number; retired: boolean; done: Promise<void>; finish(): void };
  const clients = new Map<SourceArea, Connection>(), connections = new Set<Connection>(); let closed = false;
  const destroy = (connection: Connection) => {
    if (!connection.retired || connection.active || !connections.delete(connection)) return;
    if (clients.get(connection.area) === connection) clients.delete(connection.area);
    try { connection.s3.destroy(); } finally { connection.finish(); }
  };
  const retire = (connection: Connection) => { connection.retired = true; destroy(connection); };
  const client = (area: SourceArea) => {
    archiveAssert(!closed, "ARCHIVE_SOURCE_CLOSED");
    const current = configuration();
    archiveAssert(valueHash(parseSourceProfile(current.profile)) === valueHash(pinned), "ARCHIVE_SOURCE_BINDING_CHANGED");
    const binding: Binding = current.profile[area], credentials = current.credentials[area];
    archiveAssert(credentials.accessKeyId && credentials.secretAccessKey, "ARCHIVE_SOURCE_CREDENTIALS_REQUIRED");
    const identity = valueHash({ binding, credentials }); let connection = clients.get(area);
    if (!connection || connection.identity !== identity) {
      if (connection) retire(connection);
      let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
      connection = { s3: makeClient({ endpoint: binding.endpoint, region: binding.region ?? "auto", credentials: { ...credentials }, maxAttempts: 1,
        requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" }), identity, area, active: 0, retired: false, done, finish };
      clients.set(area, connection); connections.add(connection);
    }
    connection.active++; const held = connection;
    return { s3: connection.s3, bucket: binding.bucket, release: () => { held.active--; destroy(held); } };
  };
  const allowed = (area: SourceArea, key: string, list: boolean) => {
    const prefixes = area === "public" ? ["documents/", "kp/"] : ["contracts/", "exports/"];
    archiveAssert(prefixes.some(prefix => key.startsWith(prefix)) && !key.includes("\\") && !key.split("/").some((part, index, parts) => part === "." || part === ".." || !part && index !== parts.length - 1) && (list || !key.endsWith("/")), "ARCHIVE_SOURCE_KEY_INVALID");
  };
  return {
    profile: () => jsonClone(pinned),
    async close() { closed = true; const pending = [...connections]; for (const connection of pending) retire(connection); await Promise.all(pending.map(connection => connection.done)); },
    async list(area, prefix) {
      allowed(area, prefix, true);
      const { s3, bucket, release } = client(area), entries: Awaited<ReturnType<ArchiveSource["list"]>> = [];
      let continuation: string | undefined;
      const seen = new Set<string>();
      try {
        do {
          const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuation }), { abortSignal: AbortSignal.timeout(45_000) });
          for (const object of page.Contents ?? []) {
            archiveAssert(object.Key && Number.isSafeInteger(object.Size) && object.Size! >= 0, "ARCHIVE_SOURCE_LIST_INVALID");
            allowed(area, object.Key, false);
            entries.push({ area, key: object.Key, size: object.Size!, modifiedAt: object.LastModified?.toISOString() ?? null });
            archiveAssert(entries.length <= 50000, "ARCHIVE_SOURCE_LIST_TOO_LARGE");
          }
          continuation = page.IsTruncated ? page.NextContinuationToken : undefined;
          archiveAssert(!page.IsTruncated || continuation && !seen.has(continuation), "ARCHIVE_SOURCE_PAGINATION_INVALID");
          if (continuation) seen.add(continuation);
        } while (continuation);
        return entries;
      } finally { release(); }
    },
    async read(area, key, maxBytes) {
      allowed(area, key, false);
      archiveAssert(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 128 * 1024 * 1024, "ARCHIVE_SOURCE_LIMIT_INVALID");
      const { s3, bucket, release } = client(area);
      try {
        const signal = AbortSignal.timeout(45_000), result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
        const body = result.Body as unknown as AsyncIterable<Uint8Array> & { destroy?: () => void };
        try {
          archiveAssert(body && (result.ContentLength === undefined || result.ContentLength > 0 && result.ContentLength <= maxBytes), "ARCHIVE_SOURCE_SIZE_INVALID");
          archiveAssert(Symbol.asyncIterator in body, "ARCHIVE_SOURCE_BODY_INVALID");
          const chunks: Buffer[] = []; let size = 0;
          const stop = () => body.destroy?.(); signal.addEventListener("abort", stop, { once: true });
          try {
            for await (const chunk of body) { archiveAssert(chunk instanceof Uint8Array, "ARCHIVE_SOURCE_BODY_INVALID"); size += chunk.length; archiveAssert(size <= maxBytes && !signal.aborted, "ARCHIVE_SOURCE_SIZE_INVALID"); chunks.push(Buffer.from(chunk)); }
            archiveAssert(!signal.aborted && size > 0 && (result.ContentLength === undefined || size === result.ContentLength), "ARCHIVE_SOURCE_SIZE_INVALID");
          } finally { signal.removeEventListener("abort", stop); }
          return { bytes: Buffer.concat(chunks), mimeType: result.ContentType ?? "application/octet-stream", modifiedAt: result.LastModified?.toISOString() ?? null };
        } finally { body?.destroy?.(); }
      } catch (error) {
        throw normalizeArchiveSourceReadError(error);
      } finally { release(); }
    },
  };
}

/** Секреты читаются только из уже предоставленного окружения; функция ничего не печатает и не читает env-файлы. */
export function sourceConfigurationFromEnvironment(environment: Readonly<Record<string, string | undefined>>): SourceConfiguration {
  archiveAssert(Boolean(environment.CONTRACTS_R2_ACCESS_KEY_ID) === Boolean(environment.CONTRACTS_R2_SECRET_ACCESS_KEY), "ARCHIVE_SOURCE_CREDENTIALS_INCOMPLETE");
  const required = (key: string) => { const value = environment[key]; archiveAssert(value, "ARCHIVE_SOURCE_CONFIGURATION_REQUIRED"); return value; };
  const endpoint = environment.R2_ENDPOINT || `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  const contractEndpoint = environment.CONTRACTS_R2_ENDPOINT || (environment.CONTRACTS_R2_ACCOUNT_ID ? `https://${environment.CONTRACTS_R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : endpoint);
  return { profile: parseSourceProfile({ public: { endpoint, bucket: required("R2_BUCKET_NAME"), region: "auto" }, contracts: { endpoint: contractEndpoint, bucket: required("CONTRACTS_R2_BUCKET_NAME"), region: "auto" }, publicBaseUrl: required("R2_PUBLIC_URL") }),
    credentials: { public: { accessKeyId: required("R2_ACCESS_KEY_ID"), secretAccessKey: required("R2_SECRET_ACCESS_KEY") }, contracts: { accessKeyId: environment.CONTRACTS_R2_ACCESS_KEY_ID || required("R2_ACCESS_KEY_ID"), secretAccessKey: environment.CONTRACTS_R2_SECRET_ACCESS_KEY || required("R2_SECRET_ACCESS_KEY") } } };
}
