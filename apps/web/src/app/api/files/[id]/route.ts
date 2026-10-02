import { createReadStream, existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UPLOADS_ROOT, s3Enabled, s3Get, fileKey, thumbKey } from "@/lib/s3";
import { fileVisibilityWhere, resolveVisibilityActor, type VisibilityActor } from "@/server/access/visibility";
import { createImagePreviewService, type PreviewFile, type ImagePreviewVariant } from "@/server/files/image-preview";

function safeImageKey(file: PreviewFile): boolean {
  return !!file.projectId && !!file.storedName &&
    !/[/\\]/.test(file.projectId) && !/[/\\]/.test(file.storedName) &&
    file.projectId !== "." && file.projectId !== ".." &&
    file.storedName !== "." && file.storedName !== "..";
}

async function boundedBytes(stream: ReadableStream, maxBytes: number): Promise<Buffer> {
  const parts: Buffer[] = [];
  let length = 0;
  // The S3 SDK uses an async iterable Node stream; Web streams also implement
  // async iteration in the deployed Node runtime.
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > maxBytes) {
      await (stream as unknown as { cancel?: () => Promise<void>; destroy?: () => void }).cancel?.().catch(() => {});
      (stream as unknown as { destroy?: () => void }).destroy?.();
      throw new Error("PREVIEW_INPUT_TOO_LARGE");
    }
    parts.push(bytes);
  }
  return Buffer.concat(parts, length);
}

const previews = createImagePreviewService<VisibilityActor>({
  lookup: (actor, id) => prisma.file.findFirst({
    where: { AND: [{ id }, fileVisibilityWhere(actor)] },
    select: { id: true, projectId: true, productId: true, storedName: true,
      mimeType: true, size: true, createdAt: true },
  }),
  loadOriginal: async (file, maxBytes) => {
    if (!safeImageKey(file)) return null;
    if (s3Enabled()) {
      const stream = await s3Get(fileKey(file.projectId, file.storedName));
      return stream ? boundedBytes(stream, maxBytes) : null;
    }
    const root = path.resolve(UPLOADS_ROOT);
    const fullPath = path.resolve(root, file.projectId, file.storedName);
    const relative = path.relative(root, fullPath);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    const [rootReal, fileReal] = await Promise.all([realpath(root), realpath(fullPath)]).catch(() => []);
    if (!rootReal || !fileReal) return null;
    const actualRelative = path.relative(rootReal, fileReal);
    if (!actualRelative || actualRelative === ".." || actualRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(actualRelative)) return null;
    const info = await stat(fullPath).catch(() => null);
    if (!info?.isFile() || info.size > maxBytes) return null;
    const bytes = await readFile(fullPath).catch(() => null);
    return bytes && bytes.length <= maxBytes ? bytes : null;
  },
});

// GET /api/files/:id — отдача файла с проверкой прав (§4, §13).
// ?thumb=1 — превью (для изображений), иначе оригинал.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await params;
  const actor = await resolveVisibilityActor(prisma, session.user);
  const query = new URL(request.url).searchParams;
  const variant = query.get("preview");
  if (variant !== null) {
    if (variant !== "card" && variant !== "cover" && variant !== "thumbnail") {
      return NextResponse.json({ error: "Неизвестный размер превью" }, { status: 400,
        headers: { "Cache-Control": "private, no-store", "Vary": "Cookie",
          "X-Content-Type-Options": "nosniff" } });
    }
    return previews.respond({ actor, fileId: id, variant: variant as ImagePreviewVariant,
      ifNoneMatch: request.headers.get("If-None-Match") });
  }
  const file = await prisma.file.findFirst({
    where: { AND: [{ id }, fileVisibilityWhere(actor)] },
  });
  if (!file) {
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  }

  const thumb = query.get("thumb") === "1";
  // Просмотр PDF явно запрашивается после проверки доступа; прочие MIME
  // и исходный URI сохраняют режим скачивания и прежние storage keys.
  const pdfView = !thumb && query.get("view") === "1" && file.mimeType === "application/pdf";
  const headers = new Headers({
    "Content-Type": thumb && file.hasThumb ? "image/jpeg" : file.mimeType,
    "Content-Disposition": thumb
      ? "inline"
      : `${pdfView ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    "Cache-Control": "private, no-store",
  });

  if (pdfView) headers.set("X-Content-Type-Options", "nosniff");

  if (s3Enabled()) {
    const key = thumb && file.hasThumb
      ? thumbKey(file.projectId, file.storedName)
      : fileKey(file.projectId, file.storedName);
    const stream = await s3Get(key);
    if (!stream) {
      return NextResponse.json({ error: "Файл не найден в хранилище" }, { status: 404 });
    }
    return new NextResponse(stream, { headers });
  }

  const relative = thumb && file.hasThumb
    ? path.join(file.projectId, "thumbs", `${file.storedName}.jpg`)
    : path.join(file.projectId, file.storedName);
  const fullPath = path.join(UPLOADS_ROOT, relative);
  if (!fullPath.startsWith(UPLOADS_ROOT) || !existsSync(fullPath)) {
    return NextResponse.json({ error: "Файл не найден на диске" }, { status: 404 });
  }

  const stream = createReadStream(fullPath);
  return new NextResponse(stream as unknown as ReadableStream, { headers });
}
