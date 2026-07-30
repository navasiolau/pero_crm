"use server";

import { unlink } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UPLOADS_ROOT } from "@/lib/uploads";
import { writeChangeLog } from "@/server/plugins/changelog";

const MANAGER: Role[] = ["ADMIN", "DIRECTOR", "MANAGER"];

// Удаление файла: загрузивший (в т.ч. инженер, §4) или админ/директор/менеджер.
export async function deleteFile(
  fileId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file) return { ok: false, error: "Файл не найден" };

  const canDelete =
    file.uploadedById === session.user.id ||
    MANAGER.includes(session.user.role);
  if (!canDelete) return { ok: false, error: "Недостаточно прав" };

  await prisma.file.delete({ where: { id: fileId } });
  // Файлы на диске удаляем best-effort — метаданные уже убраны
  await unlink(path.join(UPLOADS_ROOT, file.projectId, file.storedName)).catch(() => {});
  if (file.hasThumb) {
    await unlink(
      path.join(UPLOADS_ROOT, file.projectId, "thumbs", `${file.storedName}.jpg`),
    ).catch(() => {});
  }

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "file",
    entityId: fileId,
    action: "delete",
    oldValue: { fileName: file.fileName },
  });
  revalidatePath(`/projects/${file.projectId}`);
  if (file.productId) revalidatePath(`/products/${file.productId}`);
  return { ok: true };
}
