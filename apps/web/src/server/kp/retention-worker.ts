import { randomUUID } from "node:crypto";
import { RetentionError } from "./retention-contract";
import { executeProposalRetention, type RetentionDependencies } from "./retention-executor";

export function retentionWorkerEnabled(environment: Readonly<Record<string,string|undefined>>): boolean {
  return environment.PERO_KP_ENABLED === "1" && environment.PERO_KP_RETENTION_WORKER_ENABLED === "1";
}
export type RetentionTimers = { interval(callback: () => void, milliseconds: number): () => void };
const timers: RetentionTimers = { interval(callback, milliseconds) { const timer = setInterval(callback, milliseconds); timer.unref?.(); return () => clearInterval(timer); } };

/** Один job за tick; импорт не ставит таймеры, disabled не обращается к DB/S3. */
export function createRetentionWorker(dependencies: Omit<RetentionDependencies, "enabled">, options: {
  environment?: () => Readonly<Record<string,string|undefined>>; timers?: RetentionTimers; intervalMs?: number; scheduleLimit?: number;
} = {}) {
  const environment = options.environment ?? (() => process.env), clock = dependencies.now ?? (() => new Date());
  const intervalMs = options.intervalMs ?? 15_000, limit = options.scheduleLimit ?? 25;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000 || intervalMs > 60_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new RetentionError("KP_RETENTION_WORKER_SETTINGS_INVALID");
  let busy = false, stopped = false, haltReason: string | null = null, cancel: (() => void) | null = null, lastAnnualHour: number | null = null;
  let lastResult: string | null = null;
  const enabled = () => !stopped && retentionWorkerEnabled(environment());
  async function runOne(): Promise<"disabled" | "idle" | "succeeded" | "failed" | "cancelled" | "halted"> {
    if (!enabled()) return "disabled";
    if (haltReason) return "halted";
    if (busy) return "idle";
    busy = true; let claim: Awaited<ReturnType<typeof dependencies.repository.claim>> = null;
    try {
      dependencies.storage.currentBinding(); // Сначала конфигурация; ошибочная цель не меняет даже DB jobs.
      const hour = Math.floor(clock().getTime() / 3_600_000), annual = lastAnnualHour !== hour;
      await dependencies.repository.scheduleDue(limit, annual);
      if (annual) lastAnnualHour = hour;
      claim = await dependencies.repository.claim(randomUUID(), 120_000);
      if (!claim) return "idle";
      await executeProposalRetention({ ...dependencies, enabled }, claim);
      return "succeeded";
    } catch (error) {
      const safe = error instanceof RetentionError ? error : new RetentionError("KP_RETENTION_FAILED", true);
      if (claim) await dependencies.repository.fail(claim, safe).catch(() => {});
      if (["KP_RETENTION_CANCELLED", "KP_RETENTION_LEASE_LOST"].includes(safe.code)) return "cancelled";
      if (!safe.retryable) haltReason = safe.code;
      return "failed";
    } finally { busy = false; }
  }
  function start() {
    if (!retentionWorkerEnabled(environment()) || cancel) return false;
    stopped = false;
    const tick = () => { void runOne().then(result => { lastResult = result; }).catch(() => { lastResult = "failed"; }); };
    cancel = (options.timers ?? timers).interval(tick, intervalMs); tick(); return true;
  }
  return { runOne, start, stop: () => { stopped = true; cancel?.(); cancel = null; },
    status: () => ({ started: cancel !== null, busy, haltReason, lastResult, enabled: enabled() }) };
}

const registry = globalThis as typeof globalThis & { peroKpRetentionStarting?: Promise<void>; peroKpRetentionWorker?: ReturnType<typeof createRetentionWorker> };
export async function startKpRetentionWorker(): Promise<void> {
  if (!retentionWorkerEnabled(process.env) || process.env.NEXT_RUNTIME !== "nodejs" ||
    ["phase-production-build", "phase-export"].includes(process.env.NEXT_PHASE ?? "") || registry.peroKpRetentionWorker) return;
  if (registry.peroKpRetentionStarting) return registry.peroKpRetentionStarting;
  registry.peroKpRetentionStarting = (async () => {
    const [{ prisma }, { createPrismaRetentionRepository }, { createRetentionS3Storage }] = await Promise.all([
      import("@/lib/prisma"), import("./retention-repository"), import("./retention-storage"),
    ]);
    const storage = createRetentionS3Storage(); storage.currentBinding();
    const worker = createRetentionWorker({ repository: createPrismaRetentionRepository(prisma), storage });
    registry.peroKpRetentionWorker = worker; worker.start();
  })();
  try { await registry.peroKpRetentionStarting; }
  finally { registry.peroKpRetentionStarting = undefined; }
}
