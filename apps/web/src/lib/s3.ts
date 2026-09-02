import path from "node:path";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// Файловое хранилище CRM (§13): S3 (MinIO) по умолчанию.
// Если S3_ENDPOINT/S3_BUCKET не заданы (локальная разработка) —
// используется локальный диск uploads/ (как раньше).
// ВАЖНО: standalone server.js делает chdir(__dirname), поэтому локальный
// фолбэк-путь в контейнере — /app/apps/web/uploads (см. docker-compose).
export const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

export function s3Enabled(): boolean {
  return Boolean(process.env.S3_ENDPOINT && process.env.S3_BUCKET);
}

let client: S3Client | null = null;

function s3(): S3Client {
  client ??= new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? "",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "",
    },
  });
  return client;
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
