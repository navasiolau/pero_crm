import { DEFAULT_EVENT_QUEUE_SETTINGS, EventDeliveryError, type EventQueueSettings,
  type EventQueueStore, type OwnedDomainEvent, type QueuedDomainEvent } from "./event-queue-contract";

export type EventQueueTimers = {
  now(): number;
  interval(callback: () => void, milliseconds: number): () => void;
  timeout(callback: () => void, milliseconds: number, keepAlive?: boolean): () => void;
};
const runtimeTimers: EventQueueTimers = {
  now: () => performance.now(),
  interval(callback, milliseconds) {
    const timer = setInterval(callback, milliseconds); timer.unref?.();
    return () => clearInterval(timer);
  },
  timeout(callback, milliseconds, keepAlive = false) {
    const timer = setTimeout(callback, milliseconds); if (!keepAlive) timer.unref?.();
    return () => clearTimeout(timer);
  },
};
export type EventDeliveryContext = {
  isActive(): boolean;
  ensureOwned(): Promise<boolean>;
};

/** Store владеет временем БД; core управляет только ожиданием и не обещает отмену чужого эффекта. */
export function createEventQueueProcessor({ store, deliver, settings = DEFAULT_EVENT_QUEUE_SETTINGS,
  timers = runtimeTimers }: {
  store: EventQueueStore;
  deliver: (event: OwnedDomainEvent, context: EventDeliveryContext) => Promise<void>;
  settings?: Readonly<EventQueueSettings>;
  timers?: EventQueueTimers;
}) {
  async function process(event: OwnedDomainEvent): Promise<boolean> {
    let settled = false, lost = false, renewing = false;
    const started = timers.now();
    let rejectInterrupted: (error: EventDeliveryError) => void = () => {};
    const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
    const active = () => !settled && !lost;
    const renew = async () => {
      if (!active()) return false;
      try {
        const owned = await store.renew(event);
        if (!owned) { lost = true; rejectInterrupted(new EventDeliveryError("EVENT_CLAIM_LOST")); }
        return owned && active();
      } catch {
        lost = true; rejectInterrupted(new EventDeliveryError("EVENT_CLAIM_LOST")); return false;
      }
    };
    const cancelHeartbeat = timers.interval(() => {
      if (!active() || renewing) return;
      renewing = true;
      void renew().finally(() => { renewing = false; });
    }, settings.heartbeatMs);
    const cancelTimeout = timers.timeout(() => {
      rejectInterrupted(new EventDeliveryError("EVENT_DELIVERY_TIMEOUT"));
    }, settings.deliveryTimeoutMs);
    try {
      await Promise.race([Promise.resolve().then(() => deliver(event, { isActive: active, ensureOwned: renew })), interrupted]);
      if (!active()) return false;
      if (timers.now() - started >= settings.deliveryTimeoutMs) throw new EventDeliveryError("EVENT_DELIVERY_TIMEOUT");
      settled = true;
      return await store.complete(event);
    } catch (error) {
      settled = true;
      if (lost) return false;
      const code = error instanceof EventDeliveryError ? error.code : "EVENT_DELIVERY_FAILED";
      // Даже при неизвестном ACK исход остаётся в БД; чужое владение fail не меняет.
      await store.fail(event, code).catch(() => false);
      return false;
    } finally {
      settled = true; cancelHeartbeat(); cancelTimeout();
    }
  }

  async function dispatchOne(eventId: string, internalRetry = false): Promise<boolean> {
    const previous = await store.read(eventId);
    if (!previous) return false;
    if (previous.processedAt) return true;
    const claim = await store.claim({ eventId, internalRetry });
    return claim?.kind === "claimed" ? process(claim.event) : false;
  }

  /** Только trusted manual cleanup: наблюдение не владеет событием и не выполняет его повторно. */
  async function waitForCompletion(eventId: string, options: {
    verifyIntent(event: QueuedDomainEvent): boolean; claimToken?: string; signal?: AbortSignal;
  }): Promise<boolean> {
    if (options.signal?.aborted) return false;
    const deadline = timers.now() + settings.deliveryTimeoutMs;
    let stopped = false, token = options.claimToken;
    let cancelDeadline = () => {}, cancelPause = () => {}, stop = () => {};
    const interrupted = new Promise<boolean>(resolve => {
      stop = () => { stopped = true; resolve(false); };
      cancelDeadline = timers.timeout(stop, settings.deliveryTimeoutMs, true);
    });
    options.signal?.addEventListener("abort", stop, { once: true });
    const observe = async () => {
      while (!stopped) {
        const snapshot = await store.observe(eventId);
        if (stopped || options.signal?.aborted || timers.now() >= deadline) return false;
        if (!snapshot || !options.verifyIntent(snapshot.event)) return false;
        const { event, leaseActive } = snapshot;
        if (event.processedAt) return true;
        if (!leaseActive || !event.claimToken || event.exhaustedAt || (token !== undefined && event.claimToken !== token)) return false;
        token = event.claimToken;
        await new Promise<void>(resolve => {
          const cancel = timers.timeout(() => { cancelPause = () => {}; resolve(); }, Math.min(100, deadline - timers.now()), true);
          cancelPause = () => { cancel(); resolve(); };
        });
      }
      return false;
    };
    try { return await Promise.race([observe().catch(() => false), interrupted]); }
    finally { stopped = true; cancelDeadline(); cancelPause(); options.signal?.removeEventListener("abort", stop); }
  }
  async function dispatchPending(limit = settings.batchSize): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Error("EVENT_QUEUE_LIMIT_INVALID");
    let claimed = 0;
    for (let index = 0; index < limit; index++) {
      const claim = await store.claim();
      if (!claim) break;
      claimed++;
      if (claim.kind === "claimed") await process(claim.event);
    }
    return claimed;
  }
  return { dispatchOne, dispatchPending, waitForCompletion };
}