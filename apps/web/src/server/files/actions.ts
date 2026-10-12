"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { fileDeleteRequestSchema, fileDeleteEventId, type FileDeleteResult } from "./delete-contract";
import { deleteOrdinaryFileCore } from "./delete-core";
import { currentFileDeleteStorageIdentity } from "./delete-storage";
import { cleanupDeletedFile } from "./delete-cleanup";



// Удаление файла: загрузивший (в т.ч. инженер, §4) или админ/директор/менеджер.
export async function deleteFile(
  fileId: string,
  clientMutationId: string,
): Promise<FileDeleteResult> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  const actor = session.user;
  const parsed = fileDeleteRequestSchema.safeParse({ fileId, clientMutationId });
  if (!parsed.success) return { ok: false, error: "Обновите подтверждение удаления" };
  const storage = currentFileDeleteStorageIdentity();
  const result = await prisma.$transaction(tx => deleteOrdinaryFileCore(tx, actor, parsed.data, storage));
  if (!result.ok) return result;
  const completed = await cleanupDeletedFile(fileDeleteEventId(clientMutationId));
  revalidatePath(`/projects/${result.projectId}`);
  await revalidateProductPaths(result.productId);
  return { ...result, cleanupPending: !completed };
}
