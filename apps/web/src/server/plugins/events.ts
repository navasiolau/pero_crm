import { prisma } from "@/lib/prisma";

import { buildPluginContext } from "./context";
import { getManifest } from "./registry";
import { logPluginRun } from "./run-log";

// Шина доменных событий — outbox в PostgreSQL (§14). Запись события и
// изменение данных выполняются в одной транзакции на стороне вызывающего
// кода; доставка подписчикам — сразу после коммита (MVP), недоставленные
// добирает dispatchPendingEvents() (cron / REST).

export async function emitDomainEvent(
  type: string,
  payload: unknown,
  actor = "system",
): Promise<void> {
  const event = await prisma.domainEvent.create({
    data: { type, payload: JSON.parse(JSON.stringify(payload ?? {})), actor },
  });
  // Синхронная доставка; ошибки подписчиков не роняют основной сценарий
  await dispatchEvent(event.id).catch((error) => {
    console.error(`[plugins] Доставка события ${type} не удалась:`, error);
  });
}

export async function dispatchEvent(eventId: string): Promise<void> {
  const event = await prisma.domainEvent.findUnique({ where: { id: eventId } });
  if (!event || event.processedAt) return;

  const enabledPlugins = await prisma.plugin.findMany({
    where: { enabled: true },
  });

  let failed = 0;
  for (const plugin of enabledPlugins) {
    const hook = getManifest(plugin.id)?.hooks?.onDomainEvent;
    if (!hook) continue;
    const started = Date.now();
    try {
      const ctx = await buildPluginContext(plugin.id);
      await hook(
        {
          id: event.id,
          type: event.type,
          payload: event.payload,
          actor: event.actor,
          createdAt: event.createdAt,
        },
        ctx,
      );
      await logPluginRun({
        pluginId: plugin.id,
        kind: "hook",
        ref: `onDomainEvent:${event.type}`,
        status: "ok",
        durationMs: Date.now() - started,
      });
    } catch (error) {
      failed += 1;
      await logPluginRun({
        pluginId: plugin.id,
        kind: "hook",
        ref: `onDomainEvent:${event.type}`,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });
    }
  }

  await prisma.domainEvent.update({
    where: { id: event.id },
    data: {
      processedAt: failed === 0 ? new Date() : null,
      attempts: { increment: 1 },
      lastError: failed > 0 ? `${failed} подписчик(ов) завершились ошибкой` : null,
    },
  });
}

/** Повторная доставка недоставленных событий (для cron/REST). */
export async function dispatchPendingEvents(limit = 50): Promise<number> {
  const pending = await prisma.domainEvent.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  for (const event of pending) {
    await dispatchEvent(event.id);
  }
  return pending.length;
}
