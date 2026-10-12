import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEventQueueSettings, type EventQueueStore, type QueuedDomainEvent } from "@/server/plugins/event-queue-contract";
import { createEventQueueProcessor } from "@/server/plugins/event-queue-core";
import { createPostgresEventQueueStore } from "@/server/plugins/event-queue-store";
import { executeObsoleteSketchCleanup, removeObsoleteSketchKey, validateObsoleteSketchEvent } from "./sketch-cleanup-core";

type CleanupDb = Pick<PrismaClient, "$queryRaw" | "file">;

/** Доверенный повтор той же receipt не крадёт active lease и не переоткрывает completed. */
export async function cleanupObsoleteSketch(eventId: string, db: CleanupDb = prisma,
  remove: (key: string) => Promise<void> = removeObsoleteSketchKey, injectedStore?: EventQueueStore, signal?: AbortSignal): Promise<boolean> {
  try {
    const settings = getEventQueueSettings(), store = injectedStore ?? createPostgresEventQueueStore(db, settings);
    const event = await store.read(eventId);
    if (!event) return false;
    const intent = validateObsoleteSketchEvent(event);
    if (event.processedAt) return true;
    const verifyIntent = (current: QueuedDomainEvent) => {
      const currentIntent = validateObsoleteSketchEvent(current);
      return current.id === event.id && current.type === event.type && current.actor === event.actor &&
        current.createdAt.getTime() === event.createdAt.getTime() &&
        (Object.keys(intent) as (keyof typeof intent)[]).every(key => currentIntent[key] === intent[key]);
    };
    const processor = createEventQueueProcessor({ store, settings,
      deliver: async (owned, context) => {
        if (!verifyIntent(owned)) throw Error("SKETCH_CLEANUP_INTENT_CHANGED");
        await executeObsoleteSketchCleanup(owned, db, context, remove);
      } });
    await processor.dispatchOne(eventId, true);
    return await processor.waitForCompletion(eventId, { claimToken: event.claimToken ?? undefined, signal, verifyIntent });
  } catch { return false; }
}