import { prisma } from "@/lib/prisma";
import { executeObsoleteSketchCleanup } from "@/server/products/sketch-cleanup-core";
import { OBSOLETE_SKETCH_EVENT } from "@/server/products/sketch-cleanup-contract";
import { buildPluginContext } from "./context";
import { getManifest } from "./registry";
import { logPluginRun } from "./run-log";
import { EventDeliveryError, getEventQueueSettings, type OwnedDomainEvent } from "./event-queue-contract";
import { createEventQueueProcessor, type EventDeliveryContext } from "./event-queue-core";
import { createPostgresEventQueueStore } from "./event-queue-store";

export async function emitDomainEvent(type: string, payload: unknown, actor = "system"): Promise<void> {
  const event = await prisma.domainEvent.create({ data: { type, payload: JSON.parse(JSON.stringify(payload ?? {})), actor } });
  await dispatchEvent(event.id).catch(() => { console.error("[plugins] delivery unavailable; outbox will retry"); });
}

async function deliverEvent(event: OwnedDomainEvent, ownership: EventDeliveryContext): Promise<void> {
  if (event.type === OBSOLETE_SKETCH_EVENT) {
    await executeObsoleteSketchCleanup(event, prisma, ownership);
    return;
  }
  const enabledPlugins = await prisma.plugin.findMany({ where: { enabled: true } });
  let failed = 0;
  for (const plugin of enabledPlugins) {
    const hook = getManifest(plugin.id)?.hooks?.onDomainEvent;
    if (!hook) continue;
    if (!ownership.isActive() || !await ownership.ensureOwned()) throw new EventDeliveryError("EVENT_CLAIM_LOST");
    const started = Date.now();
    try {
      const base = await buildPluginContext(plugin.id);
      if (!ownership.isActive()) throw new EventDeliveryError("EVENT_CLAIM_LOST");
      const ctx = { ...base, emit: async (type: string, payload: unknown) => {
        if (!ownership.isActive() || !await ownership.ensureOwned()) throw new EventDeliveryError("EVENT_CLAIM_LOST");
        return base.emit(type, payload);
      } };
      await hook({ id: event.id, type: event.type, payload: event.payload, actor: event.actor, createdAt: event.createdAt }, ctx);
      await logPluginRun({ pluginId: plugin.id, kind: "hook", ref: `onDomainEvent:${event.type}`,
        status: "ok", durationMs: Date.now() - started });
    } catch (error) {
      if (error instanceof EventDeliveryError && error.code === "EVENT_CLAIM_LOST") throw error;
      failed++;
      await logPluginRun({ pluginId: plugin.id, kind: "hook", ref: `onDomainEvent:${event.type}`,
        status: "error", message: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started });
    }
  }
  if (failed) throw new EventDeliveryError("EVENT_DELIVERY_FAILED");
}

function dispatcher() {
  const settings = getEventQueueSettings();
  return createEventQueueProcessor({ store: createPostgresEventQueueStore(prisma, settings), settings, deliver: deliverEvent });
}
export async function dispatchEvent(eventId: string): Promise<void> { await dispatcher().dispatchOne(eventId); }
export async function dispatchPendingEvents(limit = 50): Promise<number> { return dispatcher().dispatchPending(limit); }
export async function readEventQueueStats() {
  const settings = getEventQueueSettings();
  return createPostgresEventQueueStore(prisma, settings).stats();
}