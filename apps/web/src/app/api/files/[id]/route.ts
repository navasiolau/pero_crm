import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UPLOADS_ROOT } from "@/lib/uploads";

const OFFICE: Role[] = ["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER", "ACCOUNTANT"];

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
  const file = await prisma.file.findFirst({
    where: OFFICE.includes(session.user.role)
      ? { id }
      : { id, project: { tasks: { some: { assigneeId: session.user.id } } } },
  });
  if (!file) {
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  }

  const thumb = new URL(request.url).searchParams.get("thumb") === "1";
  const relative = thumb && file.hasThumb
    ? path.join(file.projectId, "thumbs", `${file.storedName}.jpg`)
    : path.join(file.projectId, file.storedName);
  const fullPath = path.join(UPLOADS_ROOT, relative);
  if (!fullPath.startsWith(UPLOADS_ROOT) || !existsSync(fullPath)) {
    return NextResponse.json({ error: "Файл не найден на диске" }, { status: 404 });
  }

  const stream = createReadStream(fullPath);
  const headers = new Headers({
    "Content-Type": thumb && file.hasThumb ? "image/jpeg" : file.mimeType,
    "Content-Disposition": thumb
      ? "inline"
      : `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    "Cache-Control": "private, max-age=3600",
  });
  return new NextResponse(stream as unknown as ReadableStream, { headers });
}
