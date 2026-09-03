import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import type { FileCategory, FileStage, Role } from "@prisma/client";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UPLOADS_ROOT, s3Enabled, s3Put, fileKey, thumbKey } from "@/lib/s3";
import { hasAnyRole } from "@/lib/roles";
import { writeChangeLog } from "@/server/plugins/changelog";
import { notifyOrg } from "@/server/notifications/notify";
import { getFileStageConfig } from "@/server/files/stage-config";
import {
  FILE_STAGES,
  validateFileForCategory,
  type FileStageKey,
} from "@pero/plugin-file-stages";

const MAX_SIZE = 25 * 1024 * 1024; // 25 МБ
const CATEGORIES: FileCategory[] = [
  "PHOTO",
  "DRAWING",
  "QUOTE",
  "MEASUREMENT",
  "DOCUMENT",
  "OTHER",
];
// Кто может загружать в любой проект (§4); остальным — только свои задачи
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
    where: hasAnyRole(session.user.roles, OFFICE)
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
  let productNumber: string | null = null;
  if (productId) {
    const product = await prisma.product.findFirst({
      where: { id: productId, projectId },
      select: { id: true, number: true },
    });
    if (!product) {
      return NextResponse.json(
        { error: "Изделие не найдено в этом проекте" },
        { status: 400 },
      );
    }
    productNumber = product.number;
  }

  const categoryRaw = form.get("category");
  const category: FileCategory = CATEGORIES.includes(categoryRaw as FileCategory)
    ? (categoryRaw as FileCategory)
    : "OTHER";
  const caption = typeof form.get("caption") === "string" ? (form.get("caption") as string) : null;
  const taskId = typeof form.get("taskId") === "string" && form.get("taskId") ? (form.get("taskId") as string) : null;

  // Проверка расширения по настройкам плагина file-stages (если включён).
  // Возвращаем 422 до записи на диск — плагин меняет базовое поведение загрузки.
  const stageConfig = await getFileStageConfig();
  if (stageConfig.enabled && stageConfig.extensions) {
    const extError = validateFileForCategory(
      category,
      file.name,
      stageConfig.extensions[category],
    );
    if (extError) {
      return NextResponse.json({ error: extError }, { status: 422 });
    }
  }

  // Группа этапа (file-stages). Если не передана — действует дефолт схемы.
  const stageRaw = form.get("stage");
  const stage: FileStage | undefined =
    typeof stageRaw === "string" && FILE_STAGES.includes(stageRaw as FileStageKey)
      ? (stageRaw as FileStage)
      : undefined;

  const storedName = `${randomUUID()}-${sanitizeFileName(file.name)}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  // Превью для изображений
  let hasThumb = false;
  let thumbBuffer: Buffer | null = null;
  if (file.type.startsWith("image/")) {
    try {
      thumbBuffer = await sharp(buffer)
        .resize(480, 480, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      hasThumb = true;
    } catch {
      hasThumb = false; // битая картинка — отдадим оригинал
    }
  }

  if (s3Enabled()) {
    // S3 (MinIO) — основное хранилище (§13)
    await s3Put(fileKey(projectId, storedName), buffer, file.type || "application/octet-stream");
    if (thumbBuffer) {
      await s3Put(thumbKey(projectId, storedName), thumbBuffer, "image/jpeg");
    }
  } else {
    // Локальный фолбэк (dev без S3)
    const projectDir = path.join(UPLOADS_ROOT, projectId);
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, storedName), buffer);
    if (thumbBuffer) {
      const thumbDir = path.join(projectDir, "thumbs");
      await mkdir(thumbDir, { recursive: true });
      await writeFile(path.join(thumbDir, `${storedName}.jpg`), thumbBuffer);
    }
  }

  const row = await prisma.file.create({
    data: {
      projectId,
      productId,
      taskId,
      category,
      stage,
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
    link: productNumber ? `/products/${productNumber}` : `/projects/${projectId}`,
    exceptUserId: session.user.id,
  });

  return NextResponse.json({ ok: true, id: row.id });
}
