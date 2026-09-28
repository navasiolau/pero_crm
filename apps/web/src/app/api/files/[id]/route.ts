import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UPLOADS_ROOT, s3Enabled, s3Get, fileKey, thumbKey } from "@/lib/s3";
import { fileVisibilityWhere, resolveVisibilityActor } from "@/server/access/visibility";

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
  const file = await prisma.file.findFirst({
    where: { AND: [{ id }, fileVisibilityWhere(actor)] },
  });
  if (!file) {
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  }

  const thumb = new URL(request.url).searchParams.get("thumb") === "1";
  const headers = new Headers({
    "Content-Type": thumb && file.hasThumb ? "image/jpeg" : file.mimeType,
    "Content-Disposition": thumb
      ? "inline"
      : `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    "Cache-Control": "private, no-store",
  });

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
