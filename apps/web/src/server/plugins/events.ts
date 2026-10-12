import { prisma } from "@/lib/prisma";
import { executeObsoleteSketchCleanup } from "@/server/products/sketch-cleanup-core";
import { OBSOLETE_SKETCH_EVENT } from "@/server/products/sketch-cleanup-contract";
import { FILE_STORAGE_DELETE_EVENT } from "@/server/files/delete-contract";
import { executeFileDeleteCleanup } from "@/server/files/delete-storage";
import { buildPluginContext } from "./context";
import { getManifest } from "./registry";
import { createPostgresSubscriberStore } from "./event-subscriber-store";
import { logPluginRun } from "./run-log";
import { EventDeliveryError, getEventQueueSettings, type OwnedDomainEvent } from "./event-queue-contract";
import { createEventQueueProcessor, type EventDeliveryContext } from "./event-queue-core";
import { createPostgresEventQueueStore } from "./event-queue-store";

export async function emitDomainEvent(type: string, payload: unknown, actor = "system"): Promise<void> {
  const event = await prisma.domainEvent.create({ data: { type, payload: JSON.parse(JSON.stringify(payload ?? {})), actor } });
  await dispatchEvent(event.id).catch(() => { console.error("[plugins] delivery unavailable; outbox will retry"); });
}

async function deliverEvent(event: OwnedDomainEvent, ownership: EventDeliveryContext): Promise<void> {
  if (event.type === FILE_STORAGE_DELETE_EVENT) {
    await executeFileDeleteCleanup(event, prisma, ownership);
    return;
  }
  if (event.type === OBSOLETE_SKETCH_EVENT) {
    await executeObsoleteSketchCleanup(event, prisma, ownership);
    return;
  }
  const enabledPlugins = await prisma.plugin.findMany({ where: { enabled: true } });
  if (!ownership.isActive() || !await ownership.ensureOwned()) throw new EventDeliveryError("EVENT_CLAIM_LOST");
  const store = createPostgresSubscriberStore(prisma, getEventQueueSettings());
  const deliveries = await store.initialize(event, enabledPlugins.filter(plugin => getManifest(plugin.id)?.hooks?.onDomainEvent).map(plugin => plugin.id));
  let failed = 0;
  for (const delivery of deliveries) {
    if (delivery.deliveredAt || delivery.skippedAt) continue;
    if (!ownership.isActive() || !await ownership.ensureOwned()) throw new EventDeliveryError("EVENT_CLAIM_LOST");
    const plugin = enabledPlugins.find(plugin => plugin.id === delivery.subscriberId);
    const hook = getManifest(delivery.subscriberId)?.hooks?.onDomainEvent;
    if (!plugin || !hook) {
      await store.skip(event, delivery.subscriberId, !hook ? "SUBSCRIBER_UNAVAILABLE" : "SUBSCRIBER_DISABLED");
      continue;
    }
    const state = await store.begin(event, plugin.id);
    if (state === "terminal") continue;
    if (state === "deferred") { failed++; continue; }
    if (!ownership.isActive() || !await ownership.ensureOwned()) throw new EventDeliveryError("EVENT_CLAIM_LOST");
    const started = Date.now();
    try {
      const base = await buildPluginContext(plugin.id, emitDomainEvent);
      if (!ownership.isActive() || !await ownership.ensureOwned()) throw new EventDeliveryError("EVENT_CLAIM_LOST");
      const ctx = { ...base, emit: async (type: string, payload: unknown) => {
        if (!ownership.isActive() || !await ownership.ensureOwned()) throw new EventDeliveryError("EVENT_CLAIM_LOST");
        return base.emit(type, payload);
      } };
      await hook({ id: event.id, type: event.type, payload: event.payload, actor: event.actor, createdAt: event.createdAt }, ctx);
      if (!ownership.isActive() || !await ownership.ensureOwned()) throw new EventDeliveryError("EVENT_CLAIM_LOST");
      await store.complete(event, plugin.id);
      await logPluginRun({ pluginId: plugin.id, kind: "hook", ref: `onDomainEvent:${event.type}`,
        status: "ok", durationMs: Date.now() - started });
    } catch (error) {
      if (error instanceof EventDeliveryError && error.code === "EVENT_CLAIM_LOST") throw error;
      if (!ownership.isActive() || !await ownership.ensureOwned()) throw new EventDeliveryError("EVENT_CLAIM_LOST");
      await store.fail(event, plugin.id);
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
