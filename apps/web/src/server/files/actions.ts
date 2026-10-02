"use server";

import { unlink } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UPLOADS_ROOT, s3Enabled, s3Delete, fileKey, thumbKey } from "@/lib/s3";
import { writeChangeLog } from "@/server/plugins/changelog";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { mayDeleteStoredFile } from "@/server/files/delete-permission";
import { fileVisibilityWhere, resolveVisibilityActor } from "@/server/access/visibility";



// Удаление файла: загрузивший (в т.ч. инженер, §4) или админ/директор/менеджер.
export async function deleteFile(
  fileId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  const actor = await resolveVisibilityActor(prisma, session.user);
  const file = await prisma.file.findFirst({ where: { AND: [{ id: fileId }, fileVisibilityWhere(actor)] } });
  if (!file) return { ok: false, error: "Файл не найден" };

  if (!await mayDeleteStoredFile(prisma, actor, file)) return { ok: false, error: "Недостаточно прав" };

  await prisma.file.delete({ where: { id: fileId } });
  // Файлы в хранилище удаляем best-effort — метаданные уже убраны
  if (s3Enabled()) {
    await s3Delete(fileKey(file.projectId, file.storedName)).catch(() => {});
    if (file.hasThumb) {
      await s3Delete(thumbKey(file.projectId, file.storedName)).catch(() => {});
    }
  } else {
    await unlink(path.join(UPLOADS_ROOT, file.projectId, file.storedName)).catch(() => {});
    if (file.hasThumb) {
      await unlink(
        path.join(UPLOADS_ROOT, file.projectId, "thumbs", `${file.storedName}.jpg`),
      ).catch(() => {});
    }
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
  await revalidateProductPaths(file.productId);
  return { ok: true };
}
