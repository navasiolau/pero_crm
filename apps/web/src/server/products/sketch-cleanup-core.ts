import { lstat, unlink } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { UPLOADS_ROOT, fileKey, thumbKey, s3DeleteExact, s3Enabled } from "@/lib/s3";
import { EventDeliveryError, type QueuedDomainEvent } from "@/server/plugins/event-queue-contract";
import type { EventDeliveryContext } from "@/server/plugins/event-queue-core";
import { OBSOLETE_SKETCH_EVENT, obsoleteSketchEventId, obsoleteSketchIntentSchema } from "./sketch-cleanup-contract";

async function absentOrRegular(target: string) {
  try { if ((await lstat(target)).isSymbolicLink()) throw Error("SKETCH_STORAGE_PATH_INVALID"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function removeExactLocal(key: string) {
  const root = path.resolve(UPLOADS_ROOT), target = path.resolve(root, key);
  if (!target.startsWith(root + path.sep)) throw Error("SKETCH_STORAGE_PATH_INVALID");
  for (const relative of [path.dirname(key), key]) {
    let current = root;
    await absentOrRegular(current);
    for (const component of relative.split(/[\/\\]/)) {
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
export async function removeObsoleteSketchKey(key: string) {
  if (s3Enabled()) await s3DeleteExact(key); else await removeExactLocal(key);
}

export function validateObsoleteSketchEvent(event: Pick<QueuedDomainEvent, "id" | "type" | "payload">) {
  if (event.type !== OBSOLETE_SKETCH_EVENT) throw Error("SKETCH_CLEANUP_EVENT_INVALID");
  const intent = obsoleteSketchIntentSchema.parse(event.payload);
  if (event.id !== obsoleteSketchEventId(intent.clientMutationId) || intent.fileId === intent.newFileId)
    throw Error("SKETCH_CLEANUP_EVENT_INVALID");
  return intent;
}

/** Только точный физический outcome; ACK принадлежит общему queue protocol. */
export async function executeObsoleteSketchCleanup(event: QueuedDomainEvent,
  db: Pick<PrismaClient, "file">, context: EventDeliveryContext,
  remove: (key: string) => Promise<void> = removeObsoleteSketchKey): Promise<void> {
  try {
    const intent = validateObsoleteSketchEvent(event);
    const referenced = await db.file.findFirst({ where: { OR: [
      { id: intent.fileId }, { projectId: intent.projectId, storedName: intent.storedName },
    ] }, select: { id: true } });
    if (referenced) throw Error("SKETCH_STORAGE_REFERENCED");
    for (const key of [fileKey(intent.projectId, intent.storedName), thumbKey(intent.projectId, intent.storedName)]) {
      if (!context.isActive() || !await context.ensureOwned()) throw new EventDeliveryError("EVENT_CLAIM_LOST");
      await remove(key);
    }
  } catch (error) {
    if (error instanceof EventDeliveryError) throw error;
    throw new EventDeliveryError("SKETCH_CLEANUP_PENDING");
  }
}