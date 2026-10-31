import { createHash } from "node:crypto";
import { proposalPdfFileName } from "../../src/server/kp/pdf-filename";
import type { Prisma } from "@prisma/client";
import type { ContractObject, ContractSettings, ContractClient, ContractSource, ContractRecord } from "../../src/server/kp/contract-types";
import { ContractWorkflowError } from "../../src/server/kp/contract-types";
import type { ContractArtifact, ContractJob, ContractPayload, ContractReceipt, ContractTransaction, ContractWorkflowPorts, ContractClaim } from "../../src/server/kp/contract-ports";

export const contractActor = { id: "manager", source: "web" as const, sessionVersion: 0 };
export function contractSettings(): ContractSettings {
  return { number: "231", date: "2026-10-18", city: "Москва", contractorProfileId: "pero-by", subject: "Изготовление мебели", deliveryAddress: "",
    customer: { type: "individual", name: "Из старого КП", signature: "", phone: "", email: "", registrationAddress: "", passport: "",
      taxId: "", registrationId: "", bankDetails: "", representative: "", position: "", authority: "" },
    proposalIds: ["cp_a"], proposalOverrides: {}, sameCustomerConfirmed: false, productionDays: 55, productionUnit: "working",
    installationDays: 20, installationUnit: "calendar", warrantyMonths: 12,
    payments: [{ mode: "percent", value: 70, condition: "Аванс" }, { mode: "percent", value: 30, condition: "После монтажа" }] };
}
export function contractClient(): ContractClient {
  return { id: "client_a", name: "Иван", lastName: "Иванов", middleName: "Иванович", phone: "+70000000000", email: "fixture@example.invalid",
    address: "Адрес регистрации", passportNumber: "TEST-123", passportIssuedBy: "Тестовый орган", updatedAt: "2026-10-18T10:00:00Z" };
}
export function source(id: string, stage = "LEAD"): ContractSource {
  return { proposalId: id, revision: 1, state: { items: [{ id: "item_" + id, price: 100, qty: 1 }], currency: "BYN", client: { name: "Исходный заказчик" }, order: { number: "231" } },
    clientId: "client_a", currency: "BYN", deletedAt: null, updatedAt: "2026-10-18T10:00:00Z",
    acceptedVersionId: stage === "LEAD" ? null : "version_" + id, acceptedPdfArtifactId: stage === "LEAD" ? null : "pdf_" + id,
    project: { id: "project_" + id, stage, clientId: "client_a", address: "Адрес объекта", deletedAt: null } };
}
const toJson = (value: unknown): ContractObject => JSON.parse(JSON.stringify(value)) as ContractObject;
const pdfBytes = () => new Uint8Array(Buffer.from("%PDF-1.7 fixture"));
export function contractWorkflowFixture(initialSources = [source("cp_a")]) {
  const state = { sources: structuredClone(initialSources), clients: [contractClient()], contract: null as ContractRecord | null,
    receipts: new Map<string, ContractReceipt>(), jobs: new Map<string, ContractJob>(), artifacts: new Map<string, ContractArtifact>(),
    versions: [] as ContractObject[], sourceVersions: [] as ContractObject[], events: [] as string[], stages: [] as string[], financialFacts: [{ amount: "77.00", frozen: true }] };
  const calls: string[] = [], modelCalls: ContractObject[] = [];
  let inTransaction = false, authorized = true, failStage = false;
  const tx: ContractTransaction = {
    native: null as unknown as Prisma.TransactionClient,
    now: async () => new Date("2026-10-18T12:00:00Z"), globalLock: async () => { calls.push("global-lock"); },
    authorize: async (actor, scope) => { calls.push(scope); if (!authorized) throw new ContractWorkflowError("CONTRACT_FORBIDDEN", 403, "Доступ отозван"); return { id: actor.id, name: "Менеджер", source: actor.source, roles: ["MANAGER"] }; },
    sources: async ids => structuredClone(state.sources.filter(row => ids.includes(row.proposalId))),
    lockProjects: async ids => { calls.push("projects:" + ids.join(",")); }, lockContract: async () => { calls.push("contract-lock"); },
    clients: async ids => structuredClone(state.clients.filter(row => ids.includes(row.id))), contract: async () => structuredClone(state.contract),
    history: async contractId => state.versions.filter(version => version.contractId === contractId).map(version => ({ id: String(version.id), createdAt: "2026-10-18T12:00:00Z",
      docxArtifactId: String(version.docxArtifactId), fileName: state.artifacts.get(String(version.docxArtifactId))?.fileName ?? "Договор.docx" })),
    receipt: async id => structuredClone(state.receipts.get(id) ?? null), writeReceipt: async (id, _primary, _action, _actor, receipt) => { state.receipts.set(id, structuredClone(receipt)); },
    saveDraft: async input => {
      if ((state.contract?.revision ?? 0) !== input.expectedRevision || input.create !== !state.contract) throw new ContractWorkflowError("CONTRACT_REVISION_CHANGED", 409, "Конфликт");
      state.contract = { id: input.id, primaryProposalId: input.primaryId, revision: input.expectedRevision + 1, settings: structuredClone(input.settings) };
      return structuredClone(state.contract);
    },
    createJob: async input => { state.jobs.set(input.id, { id: input.id, kind: "CONTRACT", contractId: input.contractId, state: "PENDING", dedupeKey: input.dedupeKey,
      payload: toJson(input.payload), result: null, attempts: 0, maxAttempts: 5, leaseOwner: null, leaseUntil: null }); },
    job: async id => structuredClone(state.jobs.get(id) ?? null), artifact: async id => structuredClone(state.artifacts.get(id) ?? null),
    createPendingArtifact: async artifact => { state.artifacts.set(artifact.id, structuredClone(artifact)); },
    makeArtifactReady: async id => { const row = state.artifacts.get(id); if (!row || row.state !== "PENDING") throw Error("Not pending"); row.state = "READY"; },
    createContractVersion: async input => { state.versions.push(toJson(input)); },
    completeJob: async (claim, result) => { const job = state.jobs.get(claim.id)!; job.state = "SUCCEEDED"; job.result = structuredClone(result); job.leaseOwner = null; job.leaseUntil = null; },
    failJob: async (claim, _code, terminal) => { const job = state.jobs.get(claim.id); if (job?.state === "PROCESSING" && job.leaseOwner === claim.owner) { job.state = terminal ? "FAILED" : "PENDING"; job.leaseOwner = null; job.leaseUntil = null; } },
    event: async (_actor, type) => { state.events.push(type); return "event_" + state.events.length; },
  };
  const ports: ContractWorkflowPorts = {
    enabled: true, temporaryClientId: "temporary", storageBinding: { endpoint: "https://fixture.invalid", bucket: "fixture" },
    profiles: [{ id: "pero-by", name: "Исполнитель" }], templateVersion: "1", templateSnapshot: { hash: "template" }, fileNameForContract: number => `contract_${number}_Pero.docx`,
    store: { transaction: async run => {
      if (inTransaction) throw Error("Nested transaction");
      const before = structuredClone(state); inTransaction = true;
      try { return await run(tx); } catch (error) { Object.assign(state, before); throw error; } finally { inTransaction = false; }
    } },
    model: {
      normalizeSettings: value => {
        const initial = contractSettings(), input = value && typeof value === "object" && !Array.isArray(value) ? value as ContractObject : {};
        return { ...initial, ...structuredClone(input), customer: { ...initial.customer, ...(input.customer && typeof input.customer === "object" && !Array.isArray(input.customer) ? input.customer : {}) } } as ContractSettings;
      },
      validate: (settings, proposals) => { modelCalls.push(toJson({ settings, proposals })); return { totalMinor: 10000, currency: "BYN", sources: [] }; },
    },
    lifecycle: {
      parsePayload: value => structuredClone(value) as ContractPayload,
      freezeSources: async (_tx, _actor, refs) => refs.map(ref => {
        const row = state.sources.find(source => source.proposalId === ref.proposalId)!;
        return { proposalId: row.proposalId, projectId: row.project!.id, projectStage: row.project!.stage, revision: row.revision, state: structuredClone(row.state),
          pricingSnapshot: {}, binding: { clientId: row.clientId, clientSnapshot: {}, projectId: row.project!.id }, currency: row.currency,
          rate: "1", rateDate: "2026-10-18", rateSource: "NBRB", media: [], template: { templateHash: "0".repeat(64), fontManifestHash: "0".repeat(64), sourceManifestHash: "0".repeat(64), chromium: "141.0.0", puppeteer: "24.43.1" },
          mode: row.project!.stage === "LEAD" ? "render" : "retained", ...(row.project!.stage === "LEAD" ? {} : { retainedVersionId: row.acceptedVersionId!, retainedPdfArtifactId: row.acceptedPdfArtifactId! }) };
      }),
      assertClaim: async (_tx, claim) => {
        const job = state.jobs.get(claim.id);
        if (!job || job.state !== "PROCESSING" || job.leaseOwner !== claim.owner || job.attempts !== claim.attempt || !job.leaseUntil || job.leaseUntil <= "2026-10-18T12:00:00Z") throw new ContractWorkflowError("CONTRACT_LEASE_LOST", 409, "Аренда потеряна");
      },
      registerPendingPdf: async (_tx, claim, source, descriptor) => {
        const id = "new_pdf_" + source.proposalId;
        const artifact: ContractArtifact = { ...descriptor, id, proposalId: source.proposalId, contractId: null, kind: "PDF", state: "PENDING",
          key: `kp/proposals/${source.proposalId}/exports/${claim.id}-${claim.attempt}-${id}.pdf`, fileName: proposalPdfFileName(source.state), mimeType: "application/pdf" };
        await tx.createPendingArtifact(artifact); return artifact;
      },
      registerPendingDocxCleanup: async (_tx, _claim, artifactId) => { calls.push("docx-cleanup:" + artifactId); },
      publishSourcePdf: async (_tx, _claim, proposalId, artifact) => { await tx.makeArtifactReady(artifact.id); const versionId = "new_version_" + proposalId;
        state.sourceVersions.push({ proposalId, versionId }); const row = state.sources.find(source => source.proposalId === proposalId)!;
        row.acceptedVersionId = versionId; row.acceptedPdfArtifactId = artifact.id; return { versionId, artifactId: artifact.id }; },
      advanceToContract: async (_tx, _actor, source) => { if (failStage) throw Error("Stage failure"); state.sources.find(row => row.proposalId === source.proposalId)!.project!.stage = "CONTRACT"; state.stages.push(source.proposalId); return []; },
    },
    io: {
      renderPdf: async source => { if (inTransaction) throw Error("Network in transaction"); calls.push("render:" + source.proposalId); return { bytes: pdfBytes(), pages: [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])] }; },
      retainedPdf: async source => { if (inTransaction) throw Error("Network in transaction"); calls.push("retained:" + source.proposalId); return pdfBytes(); },
      rasterizePdf: async () => { if (inTransaction) throw Error("Network in transaction"); return [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]; },
      generateDocx: async () => { if (inTransaction) throw Error("Network in transaction"); return new Uint8Array([80, 75, 3, 4]); },
      uploadAndVerify: async artifact => { if (inTransaction) throw Error("Network in transaction"); calls.push("upload:" + artifact.kind); return { id: artifact.id, storageBinding: artifact.storageBinding, key: artifact.key, sha256: artifact.sha256, size: artifact.size }; },
    }, dispatchAfterCommit: async () => { if (inTransaction) throw Error("Dispatch in transaction"); calls.push("dispatch"); },
  };
  for (const row of state.sources.filter(row => row.project?.stage !== "LEAD")) {
    const bytes = pdfBytes();
    state.artifacts.set(row.acceptedPdfArtifactId!, { id: row.acceptedPdfArtifactId!, proposalId: row.proposalId, contractId: null, kind: "PDF", state: "READY",
      storageBinding: ports.storageBinding, key: `kp/proposals/${row.proposalId}/exports/accepted.pdf`, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, fileName: "КП.pdf", mimeType: "application/pdf" });
  }
  return { state, calls, modelCalls, ports, tx,
    revoke: () => { authorized = false; }, failStage: () => { failStage = true; },
    claim: (id: string): ContractClaim => { const job = state.jobs.get(id)!; job.state = "PROCESSING"; job.attempts = 1; job.leaseOwner = "worker"; job.leaseUntil = "2026-10-18T13:00:00Z"; return { id, owner: "worker", attempt: 1, kind: "CONTRACT" }; },
  };
}
