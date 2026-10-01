import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import type { FileCategory, FileStage } from "@prisma/client";

import { auth } from "@/auth";
import { isCoverImageMime } from "@/lib/product-cover";
import { prisma } from "@/lib/prisma";
import { UPLOADS_ROOT, s3Enabled, s3Put, fileKey, thumbKey } from "@/lib/s3";
import { authorizeProductCoverUpload, persistUploadedProductCover } from "@/server/products/cover-core";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { resolveUploadContext } from "@/server/files/upload-context";
import { writeChangeLog } from "@/server/plugins/changelog";
import { notifyOrg } from "@/server/notifications/notify";
import { getFileStageConfig } from "@/server/files/stage-config";
import { withTaskTransaction } from "@/server/tasks/transaction";
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

  const productIdRaw = form.get("productId");
  const requestedProductId =
    typeof productIdRaw === "string" && productIdRaw ? productIdRaw : null;
  const taskId = typeof form.get("taskId") === "string" && form.get("taskId") ? (form.get("taskId") as string) : null;
  const coverRaw = form.get("assignCover");
  const assignCover = coverRaw === "1";
  if (coverRaw !== null && !assignCover) {
    return NextResponse.json({ error: "Неверный режим загрузки обложки" }, { status: 400 });
  }
  if (assignCover) {
    if (!requestedProductId || taskId || form.get("category") !== "PHOTO") {
      return NextResponse.json({ error: "Для обложки нужны изделие и категория Фото без задачи" }, { status: 400 });
    }
    if (!isCoverImageMime(file.type)) {
      return NextResponse.json({ error: "Нужно изображение поддерживаемого формата" }, { status: 415 });
    }
    // The generic task/project upload grant is broader than cover-edit rights.
    // Resolve exact product and role before file.arrayBuffer or storage writes.
    const permission = await authorizeProductCoverUpload(prisma, session.user,
      { projectId, productId: requestedProductId });
    if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: 404 });
  }
  const context = await resolveUploadContext(prisma, session.user, { projectId, productId: requestedProductId, taskId });
  if (!context) return NextResponse.json({ error: "Проект, изделие или задача не найдены" }, { status: 404 });
  const { project, productId, productNumber } = context;

  const categoryRaw = form.get("category");
  const category: FileCategory = CATEGORIES.includes(categoryRaw as FileCategory)
    ? (categoryRaw as FileCategory)
    : "OTHER";
  const caption = typeof form.get("caption") === "string" ? (form.get("caption") as string) : null;

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
  if (buffer.length > MAX_SIZE) return NextResponse.json({ error: "Файл больше 25 МБ" }, { status: 413 });

  // Превью для изображений
  let hasThumb = false;
  let thumbBuffer: Buffer | null = null;
  if (file.type.startsWith("image/")) {
    try {
      const image = sharp(buffer);
      thumbBuffer = await (assignCover ? image.rotate() : image)
        .resize(480, 480, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      hasThumb = true;
    } catch {
      if (assignCover) {
        return NextResponse.json({ error: "Не удалось прочитать изображение обложки" }, { status: 422 });
      }
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

  if (assignCover && requestedProductId) {
    let result: Awaited<ReturnType<typeof persistUploadedProductCover>>;
    try {
      result = await withTaskTransaction((tx) => persistUploadedProductCover(tx, session.user,
        { projectId, productId: requestedProductId }, {
          fileName: file.name, storedName, mimeType: file.type, size: file.size,
          hasThumb, uploadedById: session.user.id, caption, stage,
        }));
    } catch {
      // The old cover remains untouched. A failed DB transaction may leave a
      // new, unreferenced storage object; never remove existing media here.
      return NextResponse.json({ error: "Не удалось сохранить обложку" }, { status: 500 });
    }
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
    await revalidateProductPaths(requestedProductId).catch(() => {});
    await notifyOrg({
      type: "file.added", title: `Файл к проекту ${project.number}`,
      body: file.name, link: productNumber ? `/products/${productNumber}` : `/projects/${projectId}`,
      exceptUserId: session.user.id,
    }).catch(() => {});
    return NextResponse.json({ ok: true, id: result.id });
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
