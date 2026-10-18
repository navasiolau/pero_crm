import type { Prisma } from "@prisma/client";
import type { DomainActor } from "../actor";
import type { ContractActor, ContractClient, ContractJson, ContractModelPort, ContractObject, ContractRecord, ContractSettings, ContractSource, ContractSourceRef } from "./contract-types";

export type ContractScope = "kp:contracts:read" | "kp:contracts:write" | "kp:contracts:generate";
export type ContractClaim = { id: string; owner: string; attempt: number; kind: "CONTRACT" };
export type ContractFrozenSource = {
  proposalId: string; projectId: string; projectStage: string; revision: number; state: ContractObject;
  pricingSnapshot: ContractObject; binding: { clientId: string | null; clientSnapshot: ContractObject; projectId: string };
  currency: string; rate: string | null; rateDate: string | null; rateSource: string | null;
  media: { id: string; binding: ContractObject; key: string; sha256: string; size: number; mimeType: string; fileName: string }[];
  template: { templateHash: string; fontManifestHash: string; sourceManifestHash: string; chromium: string; puppeteer: string };
  mode: "render" | "retained"; retainedVersionId?: string; retainedPdfArtifactId?: string;
};
export type ContractPayload = { schema: 1; actor: ContractActor; requestFingerprint: string; frozenSources: ContractFrozenSource[]; extra: ContractObject };
export type ContractJob = { id: string; contractId: string | null; kind: string; state: string; dedupeKey: string;
  payload: ContractJson; result: ContractJson; attempts: number; maxAttempts: number; leaseOwner: string | null; leaseUntil: string | null };
export type ContractArtifact = { id: string; proposalId: string | null; contractId: string | null; kind: "PDF" | "DOCX"; state: string;
  storageBinding: ContractObject; key: string; sha256: string; size: number; fileName: string; mimeType: string };
export type ContractVerifiedArtifact = Pick<ContractArtifact, "id" | "storageBinding" | "key" | "sha256" | "size">;
export type ContractReceipt = { fingerprint: string; actorId: string; tokenId: string | null; result: ContractObject };
export type ContractHistoryEntry = { id: string; createdAt: string; docxArtifactId: string; fileName: string };

export interface ContractTransaction {
  readonly native: Prisma.TransactionClient;
  now(): Promise<Date>;
  globalLock(): Promise<void>;
  authorize(actor: ContractActor, scope: ContractScope): Promise<DomainActor>;
  sources(ids: readonly string[]): Promise<ContractSource[]>;
  lockProjects(ids: readonly string[]): Promise<void>;
  lockContract(primaryId: string): Promise<void>;
  clients(ids: readonly string[]): Promise<ContractClient[]>;
  contract(primaryId: string): Promise<ContractRecord | null>;
  history(contractId: string): Promise<ContractHistoryEntry[]>;
  receipt(operationId: string): Promise<ContractReceipt | null>;
  writeReceipt(operationId: string, primaryId: string, action: string, actor: ContractActor, receipt: ContractReceipt): Promise<void>;
  saveDraft(input: { id: string; primaryId: string; expectedRevision: number; create: boolean; settings: ContractObject; sourceIds: string[]; actorId: string }): Promise<ContractRecord>;
  createJob(input: { id: string; contractId: string; dedupeKey: string; payload: ContractPayload; actorId: string }): Promise<void>;
  job(id: string): Promise<ContractJob | null>;
  artifact(id: string): Promise<ContractArtifact | null>;
  createPendingArtifact(artifact: ContractArtifact): Promise<void>;
  makeArtifactReady(id: string): Promise<void>;
  createContractVersion(input: { id: string; contractId: string; settingsSnapshot: ContractObject; clientSnapshot: ContractObject;
    sourcesSnapshot: ContractObject[]; renderSnapshot: ContractObject; templateVersion: string; docxArtifactId: string; actorId: string }): Promise<void>;
  completeJob(claim: ContractClaim, result: ContractObject): Promise<void>;
  failJob(claim: ContractClaim, code: string, terminal: boolean): Promise<void>;
  event(actorId: string, type: string, payload: ContractObject): Promise<string>;
}
export type ContractStore = { transaction<T>(run: (tx: ContractTransaction) => Promise<T>): Promise<T> };
export type ContractLifecyclePort = {
  parsePayload(value: unknown): ContractPayload;
  freezeSources(tx: ContractTransaction, actor: ContractActor, refs: readonly ContractSourceRef[]): Promise<ContractFrozenSource[]>;
  assertClaim(tx: ContractTransaction, claim: ContractClaim): Promise<void>;
  registerPendingPdf(tx: ContractTransaction, claim: ContractClaim, source: ContractFrozenSource,
    artifact: Pick<ContractArtifact, "storageBinding" | "sha256" | "size">): Promise<ContractArtifact>;
  registerPendingDocxCleanup(tx: ContractTransaction, claim: ContractClaim, artifactId: string, primaryProposalId: string): Promise<void>;
  publishSourcePdf(tx: ContractTransaction, claim: ContractClaim, proposalId: string, artifact: ContractVerifiedArtifact): Promise<{ versionId: string; artifactId: string }>;
  advanceToContract(tx: ContractTransaction, actor: DomainActor, source: ContractFrozenSource, operationId: string): Promise<string[]>;
};
export type ContractRenderIO = {
  renderPdf(source: ContractFrozenSource): Promise<{ bytes: Uint8Array; pages: Uint8Array[] }>;
  retainedPdf(source: ContractFrozenSource): Promise<Uint8Array>;
  rasterizePdf(bytes: Uint8Array): Promise<Uint8Array[]>;
  generateDocx(settings: ContractSettings, summary: ContractObject, profile: ContractObject, sources: { id: string; images: Uint8Array[] }[]): Promise<Uint8Array>;
  uploadAndVerify(artifact: ContractArtifact, bytes: Uint8Array): Promise<ContractVerifiedArtifact>;
};
export type ContractWorkflowPorts = {
  enabled: boolean; temporaryClientId: string; store: ContractStore; model: ContractModelPort;
  profiles: ContractObject[]; templateVersion: string; templateSnapshot: ContractObject; storageBinding: ContractObject;
  fileNameForContract(number: string): string;
  lifecycle: ContractLifecyclePort; io: ContractRenderIO; dispatchAfterCommit(eventIds: string[]): Promise<void>;
};
