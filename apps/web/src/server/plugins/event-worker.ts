import { dispatchPendingEvents } from "./events";
import { getEventQueueSettings } from "./event-queue-contract";

type WorkerState = { timer: ReturnType<typeof setInterval>; running: boolean; lastTickAt: Date | null; lastCount: number | null };
const registry = globalThis as typeof globalThis & { peroDomainEventWorker?: WorkerState };

export function domainEventWorkerStatus() {
  const settings = getEventQueueSettings(), state = registry.peroDomainEventWorker;
  return { enabled: settings.enabled, started: !!state, running: state?.running ?? false,
    lastTickAt: state?.lastTickAt?.toISOString() ?? null, lastCount: state?.lastCount ?? null };
}

/** Import не запускает таймер; только Node register после явного runtime opt-in. */
export function startDomainEventWorker() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build" ||
      process.env.NEXT_PHASE === "phase-export") return;
  const settings = getEventQueueSettings();
  if (!settings.enabled || registry.peroDomainEventWorker) return;
  const state: WorkerState = { timer: undefined as unknown as ReturnType<typeof setInterval>, running: false,
    lastTickAt: null, lastCount: null };
  const tick = async () => {
    if (state.running) return;
    const current = getEventQueueSettings();
    if (!current.enabled) return;
    state.running = true;
    try {
      state.lastCount = await dispatchPendingEvents(current.batchSize);
      state.lastTickAt = new Date();
    } catch { console.error("[domain-events] worker tick failed; lease or next tick will recover"); }
    finally { state.running = false; }
  };
  state.timer = setInterval(() => { void tick().catch(() => {
    console.error("[domain-events] invalid runtime configuration; tick disabled");
  }); }, settings.intervalMs);
  state.timer.unref?.();
  registry.peroDomainEventWorker = state;
  void tick().catch(() => { console.error("[domain-events] invalid runtime configuration; tick disabled"); });
}