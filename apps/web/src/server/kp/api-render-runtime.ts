import { readFile } from "node:fs/promises";
import { getKpTemplateIdentity, assetPath, ContractModel, contractFileName, contractTemplateVersion, KP_RENDER_LIMITS, type SavedProposalRenderInput } from "@pero/kp-template";
import { withMutationTransaction } from "@/server/transactions/coordinator";
import { dispatchEvent } from "@/server/plugins/events";
import { patchProjectStageTransaction } from "@/server/projects/stage-core";
import type { ProjectStage } from "@prisma/client";
import { isKpEnabled } from "./config";
import { lifecycleSecurity } from "./api-auth-db";
import { apiFailure, KpApiError, type KpApiContext } from "./api-contract";
import { assertContractRenderBudget } from "./api-render-budget";
import { storedKpRate } from "./api-rates";
import { projectProposalPricing } from "./pricing";
import { proposalTemporaryClientId } from "./proposal-client";
import { parseMediaBinding, type MediaMime } from "./media-contract";
import { contractArtifact, isProposalMediaMime, lifecycleMediaIds } from "./api-render-adapters";
import { createProposalMediaS3Storage } from "./media-storage";
import { createProposalArtifactStorage } from "./artifact-storage";
import { createPrismaLifecycleStore, assertRenderJobClaimInTransaction, freezeSourcesInTransaction,
  recordPendingPdfArtifactInTransaction, publishSourcePdfInTransaction, registerPendingArtifactCleanupInTransaction } from "./lifecycle-store";
import { parseRenderJobPayload, ProposalLifecycleError, type LifecyclePorts, type LifecycleObject, type FrozenProposalSource, type RenderJobClaim } from "./lifecycle-contract";
import { createPrismaRenderQueue } from "./render-queue";
import { createPdfRenderHandler, createRenderWorker, type RenderContext } from "./render-worker";
import { renderProposalBundle, rasterizeRetainedPdf, renderContractDocx } from "./renderer-client";
import { renderProposalPdfStream } from "./renderer-client";
import type { PdfStreamAsset } from "./pdf-io";
import { createContractWorkflow } from "./contract-workflow";
import { createPostgresContractStore } from "./contract-store";
import { createContractModelPort } from "./contract-model";
import type { ContractScope, ContractClaim, ContractVerifiedArtifact } from "./contract-ports";
import type { ContractObject } from "./contract-types";

const lifecycleJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as LifecycleObject;
export function kpLifecyclePorts(scope: Parameters<typeof lifecycleSecurity>[0]) {
  return {
    enabled: isKpEnabled(), ...lifecycleSecurity(scope),
    templateIdentity() {
      const { templateHash, fontManifestHash, sourceManifestHash, chromium, puppeteer } = getKpTemplateIdentity();
      return { templateHash, fontManifestHash, sourceManifestHash, chromium, puppeteer };
    },
    pricingSnapshot(proposal) {
      const rate = storedKpRate(proposal);
      if (!rate) return apiFailure("KP_RATE_REQUIRED", 409, "Не сохранён фиксированный курс КП");
      return lifecycleJson(projectProposalPricing(proposal.state, rate));
    },
    mediaIds: lifecycleMediaIds,
  } satisfies LifecyclePorts & ReturnType<typeof lifecycleSecurity>;
}

async function frozenAssets(source: Pick<FrozenProposalSource, "media">, authorize: () => Promise<unknown>, signal?: AbortSignal) {
  const total = source.media.reduce((sum, media) => sum + media.size, 0);
  if (!Number.isSafeInteger(total) || total > KP_RENDER_LIMITS.totalAssetBytes) return apiFailure("KP_RENDER_ASSET_LIMIT", 413, "Слишком большой объём изображений КП");
  const storage = createProposalMediaS3Storage(), assets: { mediaId: string; mimeType: MediaMime; bytesBase64: string }[] = [];
  for (const media of source.media) {
    await authorize();
    if (!isProposalMediaMime(media.mimeType)) return apiFailure("KP_RENDER_ASSET_INVALID", 410, "Формат сохранённого изображения недоступен");
    const bytes = await storage.read(parseMediaBinding(media.binding), { key: media.key, sha256: media.sha256, size: media.size, mimeType: media.mimeType }, signal);
    if (!bytes) return apiFailure("KP_MEDIA_UNAVAILABLE", 410, "Изображение версии недоступно");
    await authorize(); assets.push({ mediaId: media.id, mimeType: media.mimeType, bytesBase64: bytes.toString("base64") });
  }
  return assets;
}
function rendererOptions(signal?: AbortSignal) {
  return { signal };
}
function frozenAssetStreams(source: Pick<FrozenProposalSource, "media">, authorize: () => Promise<unknown>): PdfStreamAsset[] {
  const storage = createProposalMediaS3Storage();
  return source.media.map(media => {
    if (!isProposalMediaMime(media.mimeType)) return apiFailure("KP_RENDER_ASSET_INVALID", 410, "Формат сохранённого изображения недоступен");
    const mimeType = media.mimeType;
    return { mediaId: media.id, mimeType, size: media.size, sha256: media.sha256,
      async openRead(signal) {
        await authorize(); signal?.throwIfAborted();
        if (!storage.openRead) return apiFailure("KP_RENDER_ASSET_INVALID", 503, "Поток изображений недоступен");
        const stream = storage.openRead(parseMediaBinding(media.binding), { key: media.key, sha256: media.sha256, size: media.size, mimeType }, signal);
        return (async function* () { try { for await (const chunk of stream) yield chunk; } catch (error) { if (error && typeof error === "object" && "name" in error && ["NoSuchKey", "NotFound"].includes(String(error.name))) return apiFailure("KP_MEDIA_UNAVAILABLE", 410, "Изображение версии недоступно"); throw error; } await authorize(); signal?.throwIfAborted(); })();
      } };
  });
}
const renderInput = async (source: { proposalId: string; revision: number; state: unknown; media: FrozenProposalSource["media"]; template: { templateHash: string } }, authorize: () => Promise<unknown>, signal?: AbortSignal): Promise<SavedProposalRenderInput> => {
  if (!source.state || typeof source.state !== "object" || !("items" in source.state) || !Array.isArray(source.state.items))
    return apiFailure("KP_RENDER_SOURCE_INVALID", 410, "Снимок КП недоступен");
  return { kind: "pdf", proposalId: source.proposalId, revision: source.revision, state: source.state as SavedProposalRenderInput["state"],
    assets: await frozenAssets(source, authorize, signal), templateHash: source.template.templateHash };
};

export async function kpContractWorkflow(scope: ContractScope, context?: KpApiContext, claim?: ContractClaim, ownership?: RenderContext) {
  const storage = createProposalArtifactStorage(), security = lifecycleSecurity("kp:contracts:generate");
  const guard = async () => {
    if (claim) {
      if (ownership && (!ownership.active() || !await ownership.ensureOwned())) return apiFailure("KP_JOB_LEASE_LOST", 409, "Задание больше не принадлежит обработчику");
      await withMutationTransaction(tx => assertRenderJobClaimInTransaction(tx, claim, security));
    } else if (context) await context.authorize(scope);
    else return apiFailure("KP_AUTH_REQUIRED", 401, "Не задан автор операции договора");
  };
  const profilesJson: unknown = JSON.parse(await readFile(assetPath("templates/contracts/contractors.json"), "utf8"));
  const profiles = Array.isArray(profilesJson) ? profilesJson : profilesJson && typeof profilesJson === "object" && "profiles" in profilesJson ? profilesJson.profiles : null;
  if (!Array.isArray(profiles) || profiles.some(value => !value || typeof value !== "object" || Array.isArray(value))) return apiFailure("KP_CONTRACT_PROFILES_INVALID", 503, "Недоступны настройки исполнителя договора");
  const store = createPostgresContractStore(run => withMutationTransaction(async tx => {
    if (context) await context.authorize(scope, tx);
    return run(tx);
  }));
  const ports = kpLifecyclePorts("kp:contracts:generate");
  return createContractWorkflow({ enabled: isKpEnabled(), temporaryClientId: proposalTemporaryClientId(), store,
    model: createContractModelPort(ContractModel), profiles: profiles as ContractObject[],
    templateVersion: String(contractTemplateVersion), templateSnapshot: lifecycleJson({ ...getKpTemplateIdentity(), contractTemplateVersion }),
    storageBinding: lifecycleJson(storage.binding()), fileNameForContract: contractFileName,
    dispatchAfterCommit: async eventIds => { for (const id of eventIds) await dispatchEvent(id).catch(() => undefined); },
    lifecycle: {
      parsePayload: parseRenderJobPayload,
      freezeSources: (tx, actor, refs) => freezeSourcesInTransaction(tx.native, actor, refs, ports),
      assertClaim: async (tx, value) => { await assertRenderJobClaimInTransaction(tx.native, value, security); },
      registerPendingPdf: async (tx, value, source, artifact) => contractArtifact(await recordPendingPdfArtifactInTransaction(tx.native, { claim: value, proposalId: source.proposalId, artifact }, ports)),
      registerPendingDocxCleanup: (tx, value, artifactId, primaryProposalId) => registerPendingArtifactCleanupInTransaction(tx.native, { claim: value, artifactId, proposalId: primaryProposalId }, security),
      async publishSourcePdf(tx, value, proposalId, artifact) {
        const version = await publishSourcePdfInTransaction(tx.native, { claim: value, proposalId, artifactId: artifact.id, verified: artifact }, ports);
        return { versionId: version.id, artifactId: artifact.id };
      },
      async advanceToContract(tx, actor, source, operationId) {
        const mutation = await patchProjectStageTransaction(actor, { projectId: source.projectId, expectedStage: source.projectStage as ProjectStage,
          toStage: "CONTRACT", clientMutationId: operationId }, tx.native);
        if (!mutation.result.ok) return apiFailure("KP_STAGE_CHANGED", 409, "Этап проекта изменился во время генерации договора");
        return mutation.eventIds;
      },
    },
    io: {
      async renderPdf(source) {
        await guard(); const input = await renderInput(source, guard, ownership?.signal);
        const result = await renderProposalBundle(input, rendererOptions(ownership?.signal)); await guard();
        return { bytes: result.bytes, pages: result.pages };
      },
      async retainedPdf(source) {
        await guard();
        const artifact = await withMutationTransaction(async tx => {
          if (claim) await assertRenderJobClaimInTransaction(tx, claim, security);
          const row = source.retainedPdfArtifactId ? await tx.proposalArtifact.findFirst({ where: { id: source.retainedPdfArtifactId, proposalId: source.proposalId, kind: "PDF", state: "READY" } }) : null;
          if (!row) return apiFailure("KP_PDF_UNAVAILABLE", 410, "Принятый PDF КП недоступен"); return row;
        });
        return storage.read(artifact, guard, ownership?.signal);
      },
      async rasterizePdf(bytes) { await guard(); const result = await rasterizeRetainedPdf(Buffer.from(bytes), rendererOptions(ownership?.signal)); await guard(); return result.pages; },
      async generateDocx(settings, summary, profile, rendered) {
        await guard(); assertContractRenderBudget(KP_RENDER_LIMITS, { settings, summary, profile }, rendered);
        const result = await renderContractDocx({ kind: "docx", settings, summary, profile,
          rendered: rendered.map(source => ({ id: source.id, imagesBase64: source.images.map(image => Buffer.from(image).toString("base64")) })),
          templateHash: getKpTemplateIdentity().templateHash }, rendererOptions(ownership?.signal));
        await guard(); return result.bytes;
      },
      async uploadAndVerify(artifact, bytes): Promise<ContractVerifiedArtifact> {
        return { ...await storage.uploadAndVerify(artifact, bytes, guard, ownership?.signal), storageBinding: artifact.storageBinding };
      },
    },
  });
}

function pdfHandler(claim: RenderJobClaim, ownership: RenderContext) {
  const ports = kpLifecyclePorts("kp:export"), security = lifecycleSecurity("kp:export"), storage = createProposalArtifactStorage();
  const transaction = <T>(run: (store: ReturnType<typeof createPrismaLifecycleStore>) => Promise<T>) => withMutationTransaction(tx => run(createPrismaLifecycleStore(tx, security)));
  const guard = async () => {
    if (!ownership.active() || !await ownership.ensureOwned()) return apiFailure("KP_JOB_LEASE_LOST", 409, "Задание больше не принадлежит обработчику");
    await withMutationTransaction(tx => assertRenderJobClaimInTransaction(tx, claim, security));
  };
  return createPdfRenderHandler({ transaction, ports, io: {
    storageBinding: () => lifecycleJson(storage.binding()),
    loadAssets: async source => frozenAssetStreams(source, guard),
    render: (input, signal) => renderProposalPdfStream({ ...input, assets: input.assets.map(asset => "openRead" in asset ? asset : apiFailure("KP_RENDER_ASSET_INVALID", 503, "Поток изображений недоступен")) }, rendererOptions(signal)),
    upload: async (artifact, bytes, signal) => ({ ...await storage.uploadAndVerify(artifact, bytes, guard, signal), id: artifact.id, storageBinding: artifact.storageBinding }),
    verify: async (artifact, signal) => ({ ...await storage.verify(artifact, guard, signal), id: artifact.id, storageBinding: artifact.storageBinding }),
  } })(claim, ownership).catch(error => {
    if (error instanceof KpApiError) throw new ProposalLifecycleError(error.code, error.status, error.message);
    throw error;
  });
}
let worker: ReturnType<typeof createRenderWorker> | undefined;
let stop: (() => void) | undefined;
/** Регистрация вызывается instrumentation; импорт не запускает таймеры или S3. */
export function startKpRenderRuntime() {
  if (!isKpEnabled() || process.env.PERO_KP_WORKER_ENABLED !== "1") return;
  if (stop) return;
  worker ??= createRenderWorker({ queue: createPrismaRenderQueue(withMutationTransaction), handlers: {
    PDF: pdfHandler,
    CONTRACT: async (claim, ownership) => { const workflow = await kpContractWorkflow("kp:contracts:generate", undefined, { ...claim, kind: "CONTRACT" }, ownership); await workflow.runClaim({ ...claim, kind: "CONTRACT" }); },
  } });
  stop = worker.start();
}
export async function wakeKpRenderRuntime() {
  if (!isKpEnabled() || process.env.PERO_KP_WORKER_ENABLED !== "1") return;
  startKpRenderRuntime(); await worker?.runBatch(1);
}
