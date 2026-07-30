import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import type { FileCategory, Role } from "@prisma/client";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UPLOADS_ROOT } from "@/lib/uploads";
import { writeChangeLog } from "@/server/plugins/changelog";
import { notifyOrg } from "@/server/notifications/notify";

const MAX_SIZE = 25 * 1024 * 1024; // 25 МБ
const CATEGORIES: FileCategory[] = [
  "PHOTO",
  "DRAWING",
  "QUOTE",
  "MEASUREMENT",
  "DOCUMENT",
  "OTHER",
];
const OFFICE: Role[] = ["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER"];

function sanitizeFileName(name: string): string {
  return name.replace(/[^\wа-яА-ЯёЁ.-]+/g, "_").slice(-80);
}

// POST /api/files/upload — multipart/form-data:
// file, projectId, productId?, category?, caption?, taskId?
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const role = session.user.role;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const projectId = form?.get("projectId");
  if (!form || !(file instanceof File) || typeof projectId !== "string") {
    return NextResponse.json({ error: "Нужны file и projectId" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Файл больше 25 МБ" }, { status: 413 });
  }

  // Проверка видимости проекта (§4)
  const project = await prisma.project.findFirst({
    where: OFFICE.includes(role)
      ? { id: projectId }
      : { id: projectId, tasks: { some: { assigneeId: session.user.id } } },
    select: { id: true, number: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }

  const productIdRaw = form.get("productId");
  const productId =
    typeof productIdRaw === "string" && productIdRaw ? productIdRaw : null;
  // Изделие должно принадлежать проекту
  if (productId) {
    const product = await prisma.product.findFirst({
      where: { id: productId, projectId },
      select: { id: true },
    });
    if (!product) {
      return NextResponse.json(
        { error: "Изделие не найдено в этом проекте" },
        { status: 400 },
      );
    }
  }

  const categoryRaw = form.get("category");
  const category: FileCategory = CATEGORIES.includes(categoryRaw as FileCategory)
    ? (categoryRaw as FileCategory)
    : "OTHER";
  const caption = typeof form.get("caption") === "string" ? (form.get("caption") as string) : null;
  const taskId = typeof form.get("taskId") === "string" && form.get("taskId") ? (form.get("taskId") as string) : null;

  const storedName = `${randomUUID()}-${sanitizeFileName(file.name)}`;
  const projectDir = path.join(UPLOADS_ROOT, projectId);
  await mkdir(projectDir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(projectDir, storedName), buffer);

  // Превью для изображений
  let hasThumb = false;
  if (file.type.startsWith("image/")) {
    try {
      const thumbDir = path.join(projectDir, "thumbs");
      await mkdir(thumbDir, { recursive: true });
      await sharp(buffer)
        .resize(480, 480, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(path.join(thumbDir, `${storedName}.jpg`));
      hasThumb = true;
    } catch {
      hasThumb = false; // битая картинка — отдадим оригинал
    }
  }

  const row = await prisma.file.create({
    data: {
      projectId,
      productId,
      taskId,
      category,
      caption,
      fileName: file.name,
      storedName,
      mimeType: file.type,
      size: file.size,
      hasThumb,
      uploadedById: session.user.id,
    },
  });

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "file",
    entityId: row.id,
    action: "create",
    newValue: { project: project.number, fileName: file.name, category },
  });
  await notifyOrg({
    type: "file.added",
    title: `Файл к проекту ${project.number}`,
    body: file.name,
    link: productId ? `/products/${productId}` : `/projects/${projectId}`,
    exceptUserId: session.user.id,
  });

  return NextResponse.json({ ok: true, id: row.id });
}
