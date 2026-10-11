import { DEFAULT_EVENT_QUEUE_SETTINGS, eventRetryDelay, type EventQueueSettings, type EventQueueStore,
  type OwnedDomainEvent, type QueuedDomainEvent } from "../../src/server/plugins/event-queue-contract";
import type { EventQueueTimers } from "../../src/server/plugins/event-queue-core";
import { OBSOLETE_SKETCH_EVENT } from "../../src/server/products/sketch-cleanup-contract";

type Timer = { at: number; repeat: number; callback: () => void; canceled: boolean };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
export const memoryEvent = (index: number): QueuedDomainEvent => ({
  id: `qa135-event-${index}`, type: "qa135.fixture", payload: { index }, actor: "qa135", createdAt: new Date(index),
  processedAt: null, attempts: 0, queueAttempts: 0, claimToken: null, leaseUntil: null, nextAttemptAt: new Date(0),
  exhaustedAt: null, lastError: null,
});

/** Чистая factory: import не создаёт таймер, соединение, файл или запись БД. */
export function createMemoryEventQueueFixture(options: { settings?: Partial<EventQueueSettings>; rows?: QueuedDomainEvent[] } = {}) {
  const settings = { ...DEFAULT_EVENT_QUEUE_SETTINGS, ...options.settings };
  const rows = options.rows ?? [];
  let now = 10_000, nonce = 0;
  const scheduled = new Set<Timer>();
  const owned = (event: OwnedDomainEvent) => {
    const row = rows.find(candidate => candidate.id === event.id);
    return row && !row.processedAt && row.claimToken === event.claimToken && row.leaseUntil && row.leaseUntil.getTime() > now ? row : null;
  };
  const store: EventQueueStore = {
    async claim(request = {}) {
      const due = rows.filter(row => {
        if (row.processedAt || (request.eventId !== undefined && request.eventId !== row.id) ||
            (row.leaseUntil && row.leaseUntil.getTime() > now)) return false;
        const retry = request.internalRetry && request.eventId !== undefined && row.type === OBSOLETE_SKETCH_EVENT;
        return retry || (!row.exhaustedAt && row.nextAttemptAt.getTime() <= now);
      }).sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
      const row = due[0];
      if (!row) return null;
      const retry = request.internalRetry && request.eventId !== undefined && row.type === OBSOLETE_SKETCH_EVENT;
      if (retry && row.queueAttempts >= settings.maxAttempts) row.queueAttempts = 0;
      if (row.queueAttempts >= settings.maxAttempts) {
        row.claimToken = null; row.leaseUntil = null; row.exhaustedAt = new Date(now); row.lastError = "EVENT_RETRY_EXHAUSTED";
        return { kind: "exhausted", event: structuredClone(row) };
      }
      if (retry) row.nextAttemptAt = new Date(now);
      row.attempts++; row.queueAttempts++; row.claimToken = `fixture-token-${++nonce}`;
      row.leaseUntil = new Date(now + settings.leaseMs); row.exhaustedAt = null;
      return { kind: "claimed", event: structuredClone(row) as OwnedDomainEvent };
    },
    async renew(event) {
      const row = owned(event); if (!row) return false;
      row.leaseUntil = new Date(now + settings.leaseMs); return true;
    },
    async complete(event) {
      const row = owned(event); if (!row) return false;
      row.processedAt = new Date(now); row.claimToken = null; row.leaseUntil = null;
      row.exhaustedAt = null; row.lastError = null; return true;
    },
    async fail(event, code) {
      const row = owned(event); if (!row) return false;
      row.claimToken = null; row.leaseUntil = null; row.lastError = code;
      row.nextAttemptAt = new Date(now + eventRetryDelay(row.queueAttempts, settings));
      row.exhaustedAt = row.queueAttempts >= settings.maxAttempts ? new Date(now) : null;
      return true;
    },
    async read(id) { const row = rows.find(candidate => candidate.id === id); return row ? structuredClone(row) : null; },
    async observe(id) {
      const row = rows.find(candidate => candidate.id === id);
      return row ? { event: structuredClone(row), leaseActive: !row.processedAt && !!row.claimToken && !!row.leaseUntil && row.leaseUntil.getTime() > now } : null;
    },
    async stats() {
      const pending = rows.filter(row => !row.processedAt);
      const active = (row: QueuedDomainEvent) => !!row.claimToken && !!row.leaseUntil && row.leaseUntil.getTime() > now;
      const exhausted = (row: QueuedDomainEvent) => !!row.exhaustedAt || (row.queueAttempts >= settings.maxAttempts && !active(row));
      const waiting = pending.filter(row => !exhausted(row));
      return { ready: waiting.filter(row => !active(row) && row.nextAttemptAt.getTime() <= now).length,
        active: pending.filter(active).length, exhausted: pending.filter(exhausted).length,
        oldestPendingAgeMs: waiting.length ? Math.max(0, ...waiting.map(row => now - row.createdAt.getTime())) : null };
    },
  };
  const schedule = (callback: () => void, milliseconds: number, repeat: number) => {
    const timer = { callback, at: now + milliseconds, repeat, canceled: false }; scheduled.add(timer);
    return () => { timer.canceled = true; scheduled.delete(timer); };
  };
  const timers: EventQueueTimers = { now: () => now,
    timeout: (callback, milliseconds) => schedule(callback, milliseconds, 0),
    interval: (callback, milliseconds) => schedule(callback, milliseconds, milliseconds) };
  const jump = async (milliseconds: number) => { now += milliseconds; await flush(); };
  const advance = async (milliseconds: number) => {
    const target = now + milliseconds;
    while (true) {
      const timer = [...scheduled].filter(item => !item.canceled && item.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!timer) break;
      now = Math.max(now, timer.at);
      if (timer.repeat) timer.at = now + timer.repeat; else scheduled.delete(timer);
      timer.callback(); await flush();
    }
    now = target; await flush();
  };
  return { rows, store, timers, settings, advance, jump, now: () => now, flush, pendingTimers: () => scheduled.size };
}