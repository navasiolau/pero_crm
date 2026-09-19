import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type FailureReason =
  | "telegram-poll-failed"
  | "telegram-conflict"
  | "crm-health-failed";

interface SignalState {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureReason: FailureReason | null;
}

export interface BotHealthEvidence {
  schemaVersion: 1;
  service: "telegram-bot";
  generatedAt: string;
  status: "starting" | "healthy" | "degraded";
  polling: SignalState & { freshnessSeconds: number };
  crm: SignalState & { freshnessSeconds: number };
}

function isCurrent(signal: SignalState, nowMs: number, freshnessMs: number): boolean {
  if (!signal.lastSuccessAt) return false;
  const successMs = Date.parse(signal.lastSuccessAt);
  return signal.failureReason === null && nowMs - successMs <= freshnessMs;
}

/**
 * Writes monitor evidence without tokens, Telegram identities, chat contents,
 * URLs or raw exception strings. A monitor must validate both timestamps; the
 * existence of this file alone is deliberately not a health signal.
 */
export class BotHealthReporter {
  private readonly polling: SignalState = {
    lastSuccessAt: null,
    lastFailureAt: null,
    failureReason: null,
  };
  private readonly crm: SignalState = {
    lastSuccessAt: null,
    lastFailureAt: null,
    failureReason: null,
  };

  constructor(
    private readonly file: string,
    private readonly pollingFreshnessMs = 90_000,
    private readonly crmFreshnessMs = 90_000,
  ) {
    this.persist();
  }

  pollingSuccess(now = new Date()): void {
    this.success(this.polling, now);
  }

  pollingFailure(reason: "telegram-poll-failed" | "telegram-conflict", now = new Date()): void {
    this.failure(this.polling, reason, now);
  }

  crmSuccess(now = new Date()): void {
    this.success(this.crm, now);
  }

  crmFailure(now = new Date()): void {
    this.failure(this.crm, "crm-health-failed", now);
  }

  snapshot(now = new Date()): BotHealthEvidence {
    const nowMs = now.getTime();
    const pollingHealthy = isCurrent(this.polling, nowMs, this.pollingFreshnessMs);
    const crmHealthy = isCurrent(this.crm, nowMs, this.crmFreshnessMs);
    const hasAnyOutcome = !!(
      this.polling.lastSuccessAt ||
      this.polling.lastFailureAt ||
      this.crm.lastSuccessAt ||
      this.crm.lastFailureAt
    );
    return {
      schemaVersion: 1,
      service: "telegram-bot",
      generatedAt: now.toISOString(),
      status: pollingHealthy && crmHealthy ? "healthy" : hasAnyOutcome ? "degraded" : "starting",
      polling: {
        ...this.polling,
        freshnessSeconds: this.pollingFreshnessMs / 1000,
      },
      crm: {
        ...this.crm,
        freshnessSeconds: this.crmFreshnessMs / 1000,
      },
    };
  }

  private success(signal: SignalState, now: Date): void {
    signal.lastSuccessAt = now.toISOString();
    signal.failureReason = null;
    this.persist(now);
  }

  private failure(signal: SignalState, reason: FailureReason, now: Date): void {
    signal.lastFailureAt = now.toISOString();
    signal.failureReason = reason;
    this.persist(now);
  }

  private persist(now = new Date()): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(this.snapshot(now))}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporary, this.file);
    } catch {
      // The missing/stale evidence will make monitoring fail closed. Keep bot
      // service available and avoid logging paths or exception text.
      console.error("[health] не удалось обновить файл состояния");
    }
  }
}
