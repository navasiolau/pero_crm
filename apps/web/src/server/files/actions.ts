"use server";

import { unlink } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { UPLOADS_ROOT, s3Enabled, s3Delete, fileKey, thumbKey } from "@/lib/s3";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { MANAGER_ROLES, hasAnyRole, hasRole } from "@/lib/roles";
import { fileVisibilityWhere, resolveVisibilityActor } from "@/server/access/visibility";
import { resolveUploadContext } from "@/server/files/upload-context";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { deleteFileMetadataCore } from "./delete-core";


// Удаление файла: загрузивший (в т.ч. инженер, §4) или админ/директор/менеджер.
export async function deleteFile(
  fileId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  let outcome: { ok: true; file: { id: string; projectId: string; productId: string | null; storedName: string;
    hasThumb: boolean; fileName: string } } | { ok: false; error: string };
  try {
    outcome = await withTaskTransaction(async (tx) => {
      const actor = await resolveVisibilityActor(tx, session.user);
      const file = await tx.file.findFirst({ where: { AND: [{ id: fileId }, fileVisibilityWhere(actor)] } });
      if (!file) return { ok: false as const, error: "Файл не найден" };
      const canDelete = file.uploadedById === session.user.id || hasAnyRole(session.user.roles, MANAGER_ROLES);
      if (!canDelete) return { ok: false as const, error: "Недостаточно прав" };
      if ((hasRole(session.user.roles, "ENGINEER") || actor.engineeringParticipantProductIds?.includes(file.productId ?? "")) &&
        !hasAnyRole(session.user.roles, MANAGER_ROLES) && !await resolveUploadContext(tx, actor, file))
        return { ok: false as const, error: "Недостаточно прав" };
      const deleted = await deleteFileMetadataCore(tx, fileId);
      await tx.changeLog.create({ data: { actorType: "user", actorId: session.user.id,
        actorName: session.user.name ?? undefined, entity: "file", entityId: fileId, action: "delete",
        oldValue: { fileName: file.fileName } } });
      return { ok: true as const, file: deleted };
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "FILE_SAMPLE_IN_USE" || (typeof error === "object" && error !== null && "code" in error && error.code === "P2003"))
      return { ok: false, error: "Файл используется как образец покрытия. Ссылки можно снять только в черновиках; образцы подтверждённых ревизий сохраняются." };
    return { ok: false, error: "Не удалось удалить файл. Обновите карточку и повторите действие." };
  }
  if (!outcome.ok) return outcome;
  const file = outcome.file;
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

  try { revalidatePath(`/projects/${file.projectId}`); await revalidateProductPaths(file.productId); }
  catch { /* metadata was already deleted; do not report a failed deletion */ }
  return { ok: true };
}
