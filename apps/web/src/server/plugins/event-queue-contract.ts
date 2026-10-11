export type QueuedDomainEvent = {
  id: string;
  type: string;
  payload: unknown;
  actor: string;
  createdAt: Date;
  processedAt: Date | null;
  attempts: number;
  queueAttempts: number;
  claimToken: string | null;
  leaseUntil: Date | null;
  nextAttemptAt: Date;
  exhaustedAt: Date | null;
  lastError: string | null;
};
export type OwnedDomainEvent = QueuedDomainEvent & { claimToken: string; leaseUntil: Date };
export type QueueClaim = { kind: "claimed"; event: OwnedDomainEvent } |
  { kind: "exhausted"; event: QueuedDomainEvent };
export type ClaimRequest = { eventId?: string; internalRetry?: boolean };
export type QueueStats = { ready: number; active: number; exhausted: number; oldestPendingAgeMs: number | null };
export type EventQueueStore = {
  claim(request?: ClaimRequest): Promise<QueueClaim | null>;
  renew(event: OwnedDomainEvent): Promise<boolean>;
  complete(event: OwnedDomainEvent): Promise<boolean>;
  fail(event: OwnedDomainEvent, code: string): Promise<boolean>;
  read(eventId: string): Promise<QueuedDomainEvent | null>;
  observe(eventId: string): Promise<{ event: QueuedDomainEvent; leaseActive: boolean } | null>;
  stats(): Promise<QueueStats>;
};
export type EventQueueSettings = {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  leaseMs: number;
  heartbeatMs: number;
  deliveryTimeoutMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  maxAttempts: number;
};
export const DEFAULT_EVENT_QUEUE_SETTINGS: Readonly<EventQueueSettings> = Object.freeze({
  enabled: false, intervalMs: 15_000, batchSize: 50, leaseMs: 120_000, heartbeatMs: 30_000,
  deliveryTimeoutMs: 90_000, backoffBaseMs: 30_000, backoffMaxMs: 900_000, maxAttempts: 12,
});
export class EventDeliveryError extends Error {
  constructor(readonly code: "EVENT_DELIVERY_FAILED" | "EVENT_DELIVERY_TIMEOUT" | "EVENT_CLAIM_LOST" | "SKETCH_CLEANUP_PENDING") {
    super(code);
    this.name = "EventDeliveryError";
  }
}

/** Настройки публичны, но ошибочные env значения не попадают в сообщения. */
export function getEventQueueSettings(env: Readonly<Record<string, string | undefined>> = process.env): EventQueueSettings {
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw Error("EVENT_QUEUE_CONFIG_INVALID");
    return value;
  };
  const enabled = env.DOMAIN_EVENT_WORKER_ENABLED?.trim().toLowerCase() ?? "false";
  if (!["true", "false", "1", "0", ""].includes(enabled)) throw Error("EVENT_QUEUE_CONFIG_INVALID");
  const defaults = DEFAULT_EVENT_QUEUE_SETTINGS;
  const settings: EventQueueSettings = {
    enabled: enabled === "true" || enabled === "1",
    intervalMs: integer("DOMAIN_EVENT_WORKER_INTERVAL_MS", defaults.intervalMs, 1000, 300_000),
    batchSize: integer("DOMAIN_EVENT_WORKER_BATCH_SIZE", defaults.batchSize, 1, 100),
    leaseMs: integer("DOMAIN_EVENT_LEASE_MS", defaults.leaseMs, 10_000, 600_000),
    heartbeatMs: integer("DOMAIN_EVENT_HEARTBEAT_MS", defaults.heartbeatMs, 1000, 120_000),
    deliveryTimeoutMs: integer("DOMAIN_EVENT_DELIVERY_TIMEOUT_MS", defaults.deliveryTimeoutMs, 1000, 300_000),
    backoffBaseMs: integer("DOMAIN_EVENT_BACKOFF_BASE_MS", defaults.backoffBaseMs, 1000, 3_600_000),
    backoffMaxMs: integer("DOMAIN_EVENT_BACKOFF_MAX_MS", defaults.backoffMaxMs, 1000, 86_400_000),
    maxAttempts: integer("DOMAIN_EVENT_MAX_ATTEMPTS", defaults.maxAttempts, 1, 100),
  };
  if (settings.heartbeatMs * 3 > settings.leaseMs || settings.deliveryTimeoutMs >= settings.leaseMs ||
      settings.heartbeatMs >= settings.deliveryTimeoutMs || settings.backoffBaseMs > settings.backoffMaxMs)
    throw Error("EVENT_QUEUE_CONFIG_INVALID");
  return settings;
}

export function eventRetryDelay(attempt: number, settings: Pick<EventQueueSettings, "backoffBaseMs" | "backoffMaxMs">): number {
  return Math.min(settings.backoffMaxMs, settings.backoffBaseMs * 2 ** Math.min(30, Math.max(0, attempt - 1)));
}