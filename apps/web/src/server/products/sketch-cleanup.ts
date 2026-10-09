import { lstat, unlink } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UPLOADS_ROOT, fileKey, thumbKey, s3DeleteExact, s3Enabled } from "@/lib/s3";
import { OBSOLETE_SKETCH_EVENT, obsoleteSketchEventId, obsoleteSketchIntentSchema } from "./sketch-cleanup-contract";

type CleanupDb = Pick<PrismaClient, "domainEvent" | "file">;

async function absentOrRegular(target: string) {
  try {
    if ((await lstat(target)).isSymbolicLink()) throw Error("SKETCH_STORAGE_PATH_INVALID");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
async function removeExactLocal(key: string) {
  const root = path.resolve(UPLOADS_ROOT), target = path.resolve(root, key);
  if (!target.startsWith(root + path.sep)) throw Error("SKETCH_STORAGE_PATH_INVALID");
  // Ни файл, ни родительские каталоги не могут увести точное удаление по ссылке.
  for (const relative of [path.dirname(key), key]) {
    let current = root;
    await absentOrRegular(current);
    for (const component of relative.split(/[\\/\\\\]/)) {
      current = path.join(current, component); await absentOrRegular(current);
    }
  }
  try { await unlink(target); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try { await lstat(target); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw Error("SKETCH_STORAGE_FILE_REMAINS");
}
async function erase(key: string) {
  if (s3Enabled()) await s3DeleteExact(key);
  else await removeExactLocal(key);
}

/** Вызывается после COMMIT или диспетчером существующего outbox; failed intent остаётся pending. */
export async function cleanupObsoleteSketch(
  eventId: string,
  db: CleanupDb = prisma,
  remove: (key: string) => Promise<void> = erase,
): Promise<boolean> {
  try {
    const event = await db.domainEvent.findUnique({ where: { id: eventId } });
    if (!event || event.type !== OBSOLETE_SKETCH_EVENT) throw Error("SKETCH_CLEANUP_EVENT_INVALID");
    const intent = obsoleteSketchIntentSchema.parse(event.payload);
    if (event.id !== obsoleteSketchEventId(intent.clientMutationId) || intent.fileId === intent.newFileId)
      throw Error("SKETCH_CLEANUP_EVENT_INVALID");
    if (event.processedAt) return true;
    // Любой живой File с этим id/key блокирует повтор: winning/new file удалять нельзя.
    const referenced = await db.file.findFirst({ where: { OR: [
      { id: intent.fileId }, { projectId: intent.projectId, storedName: intent.storedName },
    ] }, select: { id: true } });
    if (referenced) throw Error("SKETCH_STORAGE_REFERENCED");
    await remove(fileKey(intent.projectId, intent.storedName));
    // Известный exact thumbnail удаляем даже при историческом hasThumb=false.
    await remove(thumbKey(intent.projectId, intent.storedName));
    await db.domainEvent.update({ where: { id: event.id }, data: {
      processedAt: new Date(), attempts: { increment: 1 }, lastError: null,
    } });
    return true;
  } catch {
    await db.domainEvent.updateMany({ where: { id: eventId, type: OBSOLETE_SKETCH_EVENT, processedAt: null },
      data: { attempts: { increment: 1 }, lastError: "SKETCH_CLEANUP_PENDING" } }).catch(() => {});
    return false;
  }
}
