import path from "node:path";
import type {Readable} from "node:stream";
import { deleteExactS3Object } from "./s3-delete-exact";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// Target is explicit; incomplete server configuration never selects disk.
// ВАЖНО: standalone server.js делает chdir(__dirname), поэтому локальный
// фолбэк-путь в контейнере — /app/apps/web/uploads (см. docker-compose).
export const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

export function s3Enabled(): boolean {
  return storageConfiguration().mode === "s3";
}

export function storageConfiguration() {
  const mode = process.env.CRM_FILE_STORAGE;
  const required = [process.env.S3_ENDPOINT, process.env.S3_BUCKET, process.env.S3_ACCESS_KEY, process.env.S3_SECRET_KEY];
  const invalid = () => { throw new Error("STORAGE_CONFIG_INVALID"); };
  if (mode === "local") {
    if (required.some(value => Boolean(value?.trim()))) invalid();
    return { mode: "local" as const };
  }
  if (mode !== "s3" || required.some(value => !value?.trim())) invalid();
  let endpoint: URL;
  try { endpoint = new URL(process.env.S3_ENDPOINT!); } catch { return invalid(); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(process.env.S3_BUCKET!)) invalid();
  return { mode: "s3" as const, endpoint: endpoint.toString(), bucket: process.env.S3_BUCKET!,
    region: process.env.S3_REGION ?? "us-east-1", accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! };
}

let client: S3Client | null = null;
let streamClient: S3Client | null = null;

function s3(streaming=false): S3Client {
  const config = storageConfiguration();
  if (config.mode !== "s3") throw new Error("STORAGE_CONFIG_INVALID");
  const makeClient = () => new S3Client({
    ...(streaming?{maxAttempts:1}:{}),
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return streaming?(streamClient??=makeClient()):(client??=makeClient());
}

export function fileKey(projectId: string, storedName: string): string {
  return `${projectId}/${storedName}`;
}

export function thumbKey(projectId: string, storedName: string): string {
  return `${projectId}/thumbs/${storedName}.jpg`;
}

export async function s3Put(
  key: string,
  body: Buffer,
  contentType?: string,
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export type S3UploadSource={size:number;contentHash:string;openRead:()=>Promise<Readable>};
/** Один Put для готового spool: неизвестный ACK не повторяем автоматически. */
export async function s3PutStream(key:string,source:S3UploadSource,contentType?:string,signal?:AbortSignal):Promise<void>{
  if(!Number.isSafeInteger(source.size)||source.size<0||!/^[a-f0-9]{64}$/.test(source.contentHash))throw Error("UPLOAD_STREAM_FACTS_INVALID");
  const body=await source.openRead();
  try{
    await s3(true).send(new PutObjectCommand({
      Bucket:process.env.S3_BUCKET,Key:key,Body:body,ContentLength:source.size,ContentType:contentType,
      ChecksumSHA256:Buffer.from(source.contentHash,"hex").toString("base64"),
    }),{abortSignal:signal});
  }finally{body.destroy();}
}
/** Стрим объекта или null, если ключа нет. */
export async function s3Get(key: string): Promise<ReadableStream | null> {
  try {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
    return (res.Body as ReadableStream) ?? null;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }
}

export async function s3Delete(key: string): Promise<void> {
  await s3().send(
    new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
  );
}

/** Физическая точечная очистка original/thumbnail; обычный s3Delete сохраняет прежний контракт. */
export async function s3DeleteExact(key: string): Promise<void> {
  const config = storageConfiguration();
  if (config.mode !== "s3") throw Error("STORAGE_CONFIG_INVALID");
  await deleteExactS3Object(s3(), config.bucket, key);
}
