import { createHash, randomUUID } from "node:crypto";
import { ProposalLifecycleError, lifecycleFailure, type ActorBinding, type ArtifactRecord, type FrozenProposalSource, type LifecycleObject, type LifecyclePorts,
  type ProposalLifecycleStore, type RenderJobClaim, type RenderKind, type VerifiedArtifact } from "./lifecycle-contract";
import { assertRenderJobClaim, completeRenderJob, publishSourcePdf, recordPendingPdfArtifact } from "./lifecycle";
import type { RenderQueue } from "./render-queue";

export type LifecycleTransaction = <T>(run: (store: ProposalLifecycleStore) => Promise<T>) => Promise<T>;
export type RenderContext = { signal: AbortSignal; active(): boolean; ensureOwned(): Promise<boolean> };
export type RenderHandler = (claim: RenderJobClaim, context: RenderContext) => Promise<void>;
export type PdfAsset = { mediaId: string; mimeType: string; bytesBase64: string };
export type PdfRenderInput = { kind: "pdf"; proposalId: string; revision: number; state: FrozenProposalSource["state"]; assets: PdfAsset[]; templateHash: string };
export type PdfWorkerIO = {
  storageBinding(): LifecycleObject;
  loadAssets(source: FrozenProposalSource, binding: ActorBinding, signal: AbortSignal): Promise<PdfAsset[]>;
  render(input: PdfRenderInput, signal: AbortSignal): Promise<{ bytes: Uint8Array; templateHash: string }>;
  upload(artifact: ArtifactRecord, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  verify(artifact: ArtifactRecord, signal: AbortSignal): Promise<VerifiedArtifact>;
};

/** Полный PDF flow; все длительные I/O обрамлены новой проверкой ключа/пользователя и lease. */
export function createPdfRenderHandler({ transaction, ports, io, maxBytes = 64 * 1024 * 1024 }: { transaction: LifecycleTransaction; ports: LifecyclePorts; io: PdfWorkerIO; maxBytes?: number }): RenderHandler {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024 * 1024) lifecycleFailure("KP_RENDER_LIMIT_INVALID", 400);
  return async (claim, context) => {
    const guard = async () => {
      if (!context.active() || !await context.ensureOwned()) lifecycleFailure("KP_JOB_LEASE_LOST");
      return transaction(store => assertRenderJobClaim(store, claim));
    };
    const { payload } = await guard();
    if (claim.kind !== "PDF" || payload.frozenSources.length !== 1 || payload.frozenSources[0].mode !== "render") lifecycleFailure("KP_JOB_SOURCE_MISMATCH");
    const source = payload.frozenSources[0];
    const assets = await io.loadAssets(source, payload.actor, context.signal);
    await guard();
    if (assets.length !== source.media.length || new Set(assets.map(asset => asset.mediaId)).size !== assets.length) lifecycleFailure("KP_RENDER_ASSET_SNAPSHOT_CHANGED");
    let assetBytes = 0;
    for (const asset of assets) {
      const frozen = source.media.find(media => media.id === asset.mediaId), bytes = Buffer.from(asset.bytesBase64, "base64");
      assetBytes += bytes.length;
      if (!frozen || assetBytes > maxBytes || bytes.length !== frozen.size || asset.mimeType !== frozen.mimeType || createHash("sha256").update(bytes).digest("hex") !== frozen.sha256) lifecycleFailure("KP_RENDER_ASSET_SNAPSHOT_CHANGED");
    }
    const rendered = await io.render({ kind: "pdf", proposalId: source.proposalId, revision: source.revision, state: source.state, assets, templateHash: source.template.templateHash }, context.signal);
    await guard();
    const bytes = Buffer.from(rendered.bytes);
    if (rendered.templateHash !== source.template.templateHash || bytes.length > maxBytes || bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") lifecycleFailure("KP_RENDER_RESULT_INVALID", 502, "Генератор вернул некорректный PDF");
    const artifact = await transaction(store => recordPendingPdfArtifact(store, claim, source.proposalId, { storageBinding: io.storageBinding(), sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length }, ports));
    await guard();
    await io.upload(artifact, bytes, context.signal);
    await guard();
    const verified = await io.verify(artifact, context.signal);
    await guard();
    await transaction(async store => {
      const version = await publishSourcePdf(store, { claim, proposalId: source.proposalId, artifactId: artifact.id, verified }, ports);
      await completeRenderJob(store, claim, { proposalId: source.proposalId, revision: source.revision, versionId: version.id, pdfArtifactId: artifact.id });
    });
  };
}

export type RenderWorkerTimers = { interval(callback: () => void, milliseconds: number): () => void; timeout(callback: () => void, milliseconds: number): () => void };
const runtimeTimers: RenderWorkerTimers = {
  interval(callback, milliseconds) { const timer = setInterval(callback, milliseconds); timer.unref?.(); return () => clearInterval(timer); },
  timeout(callback, milliseconds) { const timer = setTimeout(callback, milliseconds); timer.unref?.(); return () => clearTimeout(timer); },
};
type RenderWorkerEnvironment = Readonly<Record<string, string | undefined>>;
export function renderWorkerEnabled(environment: RenderWorkerEnvironment) { return environment.PERO_KP_ENABLED === "1" && environment.PERO_KP_WORKER_ENABLED === "1"; }

/** Не создаёт таймеров до runOne/start; поддержанные handlers задаются явно при composition. */
export function createRenderWorker({ queue, handlers, environment = () => process.env, timers = runtimeTimers, leaseMs = 60000, timeoutMs = 120000 }: {
  queue: RenderQueue; handlers: Partial<Record<RenderKind, RenderHandler>>; environment?: () => RenderWorkerEnvironment; timers?: RenderWorkerTimers; leaseMs?: number; timeoutMs?: number;
}) {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) lifecycleFailure("KP_WORKER_SETTINGS_INVALID", 400);
  let busy = false;
  const kinds = (["PDF", "CONTRACT"] as const).filter(kind => typeof handlers[kind] === "function");
  async function runOne(): Promise<"disabled" | "idle" | "succeeded" | "failed"> {
    if (!renderWorkerEnabled(environment())) return "disabled";
    if (busy || !kinds.length) return "idle";
    busy = true;
    let claim: RenderJobClaim | null = null, active = true, lost = false, renewing = false;
    let cancelHeartbeat = () => {}, cancelDeadline = () => {};
    const controller = new AbortController();
    try {
      claim = await queue.claim(kinds, randomUUID(), leaseMs);
      if (!claim) return "idle";
      const owned = claim;
      let rejectInterrupted: (error: Error) => void = () => {};
      const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
      const ensureOwned = async () => {
        if (!active || lost) return false;
        if (!renderWorkerEnabled(environment())) {
          active = false; controller.abort(); rejectInterrupted(new ProposalLifecycleError("KP_WORKER_DISABLED", 503, "Обработка КП выключена")); return false;
        }
        try {
          const renewed = await queue.renew(owned, leaseMs);
          if (!renewed) { lost = true; controller.abort(); rejectInterrupted(new ProposalLifecycleError("KP_JOB_LEASE_LOST", 409, "Аренда задания потеряна")); }
          return renewed && active && !lost;
        } catch { lost = true; controller.abort(); rejectInterrupted(new ProposalLifecycleError("KP_JOB_LEASE_LOST", 409, "Аренда задания потеряна")); return false; }
      };
      cancelHeartbeat = timers.interval(() => {
        if (!active || renewing) return;
        renewing = true; void ensureOwned().finally(() => { renewing = false; });
      }, Math.max(250, Math.floor(leaseMs / 3)));
      cancelDeadline = timers.timeout(() => {
        active = false; controller.abort(); rejectInterrupted(new ProposalLifecycleError("KP_RENDER_TIMEOUT", 504, "Превышено время генерации"));
      }, timeoutMs);
      const handler = handlers[owned.kind];
      if (!handler) lifecycleFailure("KP_JOB_HANDLER_MISSING");
      await Promise.race([Promise.resolve().then(() => handler(owned, { signal: controller.signal, active: () => active && !lost, ensureOwned })), interrupted]);
      active = false;
      if (lost || !await queue.completed(owned.id)) lifecycleFailure("KP_JOB_NOT_COMPLETED", 502);
      return "succeeded";
    } catch (error) {
      active = false; controller.abort();
      if (claim && !lost) {
        const known = error instanceof ProposalLifecycleError;
        await queue.fail(claim, { code: known ? error.code : "KP_RENDER_FAILED", terminal: known && error.status < 500, retryMs: Math.min(60000, 1000 * 2 ** Math.min(claim.attempt, 6)) }).catch(() => false);
      }
      return "failed";
    } finally { active = false; cancelHeartbeat(); cancelDeadline(); busy = false; }
  }
  async function runBatch(limit = 5) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) lifecycleFailure("KP_WORKER_BATCH_INVALID", 400);
    let succeeded = 0, failed = 0;
    for (let index = 0; index < limit; index++) {
      const result = await runOne();
      if (result === "disabled" || result === "idle") break;
      if (result === "succeeded") succeeded++; else failed++;
    }
    return { succeeded, failed };
  }
  function start(pollMs = 1000) {
    if (!renderWorkerEnabled(environment())) return () => {};
    if (!Number.isSafeInteger(pollMs) || pollMs < 250 || pollMs > 60000) lifecycleFailure("KP_WORKER_POLL_INVALID", 400);
    return timers.interval(() => { void runBatch().catch(() => {}); }, pollMs);
  }
  return { runOne, runBatch, start };
}
