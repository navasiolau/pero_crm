import { prisma } from "@/lib/prisma";
import { withMutationTransaction } from "@/server/transactions/coordinator";
import { documentDto, loadApiDocument } from "./api-documents";
import { apiFailure, type KpApiContext } from "./api-contract";
import { readApiReceipt } from "./api-operation";
import { authorizeKpResource } from "./api-resource-policy";
import { lifecycleSecurity } from "./api-auth-db";
import { readProposalVersionInTransaction, readProposalVersionsInTransaction, readRenderJobInTransaction } from "./lifecycle-store";
import { storedKpRate, rateDto, proposalSourceDate } from "./api-rates";
import { proposalObject } from "./proposal-contract";
import { createProposalArtifactStorage } from "./artifact-storage";
import type { Prisma } from "@prisma/client";
import { proposalArtifactFileName } from "./pdf-filename";
import { revalidatePublishedProjectPdfs } from "./project-pdf-cache";
import { pdfDownloadStream } from "./pdf-io";

export async function getApiOperation(context: KpApiContext, operationId: string) {
  const own = await readApiReceipt(prisma, context, operationId); if (own) return own;
  const row = await prisma.changeLog.findUnique({ where: { id: `kp-contract-operation:${operationId}` } });
  const value = row ? proposalObject(row.newValue ?? undefined) : null;
  if (!row || !value || row.actorType !== "user" || row.entity !== "proposalContract" || row.actorId !== context.actor.id || row.source !== context.binding.source || value.actorId !== context.actor.id || value.tokenId !== (context.binding.tokenId ?? null))
    return apiFailure("KP_OPERATION_NOT_FOUND", 404, "Подтверждённый результат операции не найден");
  const kind = row.action === "contract.draft.save" ? "contract.save" : row.action === "contract.export.request" ? "contract.generate" : null;
  if (!kind || !value.result || typeof value.result !== "object") return apiFailure("KP_OPERATION_NOT_FOUND", 404, "Результат операции недоступен");
  await context.authorize(kind === "contract.save" ? "kp:contracts:write" : "kp:contracts:generate");
  await loadApiDocument(prisma, row.entityId);
  return { operationId, kind, result: value.result };
}

export async function listApiVersions(context: KpApiContext, proposalId: string) {
  return withMutationTransaction(async tx => {
    await context.authorize("kp:read", tx);
    const proposal = await loadApiDocument(tx, proposalId);
    const headers = await readProposalVersionsInTransaction(tx, context.binding, proposalId, lifecycleSecurity("kp:read"));
    const rows = await tx.proposalVersion.findMany({ where: { proposalId, id: { in: headers.map(version => version.id) } },
      select: { id: true, revision: true, createdAt: true, trigger: true, pdfArtifactId: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    return { versions: rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString(), isAccepted: proposal.acceptedVersionId === row.id })) };
  });
}
export async function getApiVersion(context: KpApiContext, proposalId: string, versionId: string) {
  return withMutationTransaction(async tx => {
    await context.authorize("kp:read", tx);
    const current = await loadApiDocument(tx, proposalId);
    const snapshot = await readProposalVersionInTransaction(tx, context.binding, proposalId, versionId, lifecycleSecurity("kp:read"));
    const header = await tx.proposalVersion.findUniqueOrThrow({ where: { id: snapshot.id }, select: { id: true, trigger: true, revision: true, createdAt: true, pdfArtifactId: true } });
    const render = snapshot.renderSnapshot;
    const rate = storedKpRate({ currency: typeof render.currency === "string" ? render.currency : "",
      rate: typeof render.rate === "string" ? render.rate : null, rateDate: typeof render.rateDate === "string" ? render.rateDate : null,
      rateSource: typeof render.rateSource === "string" ? render.rateSource : null });
    const historicalClient = proposalObject(proposalObject(render.binding).clientSnapshot);
    const clientId = proposalObject(render.binding).clientId;
    const label = [historicalClient.lastName, historicalClient.name, historicalClient.middleName].filter(value => typeof value === "string" && value).join(" ");
    const document = { ...documentDto(current), revision: snapshot.revision, state: snapshot.state, updatedAt: header.createdAt.toISOString(),
      canEdit: false, canChangeClient: false, fx: rate ? rateDto(rate) : null, sourceDate: proposalSourceDate(snapshot.state),
      ...(typeof clientId === "string" ? { client: { id: clientId, label } } : {}) };
    return { version: { ...header, createdAt: header.createdAt.toISOString(), isAccepted: current.acceptedVersionId === header.id }, document };
  });
}

async function authorizeArtifact(context: KpApiContext, artifactId: string, tx?: Prisma.TransactionClient) {
  const db = tx ?? prisma;
  const artifact = await db.proposalArtifact.findFirst({ where: { id: artifactId, state: "READY", deletedAt: null } });
  if (!artifact) return apiFailure("KP_ARTIFACT_NOT_FOUND", 404, "Сохранённый документ недоступен");
  await authorizeKpResource(context, artifact.kind, tx);
  if (artifact.kind === "PDF" && artifact.proposalId && !artifact.contractId) await loadApiDocument(db, artifact.proposalId);
  else if (artifact.kind === "DOCX" && artifact.contractId && !artifact.proposalId) {
    const contract = await db.proposalContract.findUnique({ where: { id: artifact.contractId }, select: { primaryProposalId: true } });
    if (!contract) return apiFailure("KP_ARTIFACT_NOT_FOUND", 404, "История договора недоступна");
    await loadApiDocument(db, contract.primaryProposalId);
  } else return apiFailure("KP_ARTIFACT_NOT_FOUND", 404, "Не совпал источник документа");
  return { ...artifact, fileName: await proposalArtifactFileName(db, artifact) };
}
export async function readApiArtifact(context: KpApiContext & { signal?: AbortSignal }, artifactId: string) {
  const artifact = await authorizeArtifact(context, artifactId), storage = createProposalArtifactStorage();
  const authorize = async () => {
    const current = await authorizeArtifact(context, artifactId);
    if (current.key !== artifact.key || current.sha256 !== artifact.sha256 || current.size !== artifact.size || JSON.stringify(current.storageBinding) !== JSON.stringify(artifact.storageBinding)) return apiFailure("KP_ARTIFACT_CHANGED", 410, "Документ изменился");
  };
  if (artifact.kind === "PDF") {
    const file = await storage.downloadFile(artifact, authorize, context.signal);
    return { body: pdfDownloadStream(async function* (signal) { yield* await file.openRead(signal); }, context.signal, file.dispose), size: file.size,
      fileName: artifact.fileName, mimeType: "application/pdf", disposition: "attachment" as const };
  }
  const bytes = await storage.read(artifact, authorize, context.signal);
  return { bytes, fileName: artifact.fileName, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", disposition: "attachment" as const };
}

export async function getApiJob(context: KpApiContext, jobId: string) {
  if (jobId.startsWith("retained_")) {
    const versionId = jobId.slice("retained_".length);
    const version = await prisma.proposalVersion.findUnique({ where: { id: versionId }, select: { id: true, pdfArtifactId: true, proposalId: true } });
    if (!version?.pdfArtifactId) return apiFailure("KP_JOB_NOT_FOUND", 404, "Выпуск недоступен");
    const artifact = await authorizeArtifact(context, version.pdfArtifactId);
    if (artifact.proposalId !== version.proposalId || artifact.kind !== "PDF") return apiFailure("KP_JOB_NOT_FOUND", 404, "Не совпал источник выпуска");
    await revalidatePublishedProjectPdfs(prisma, [version.proposalId]);
    return { id: jobId, state: "SUCCEEDED", error: null, result: { artifactId: artifact.id, versionId, fileName: artifact.fileName, mimeType: artifact.mimeType } };
  }
  let publishedProposalIds: string[] = [];
  const response = await withMutationTransaction(async tx => {
    const metadata = await tx.proposalJob.findUnique({ where: { id: jobId }, select: { kind: true, proposalId: true, contractId: true } });
    if (!metadata) return apiFailure("KP_JOB_NOT_FOUND", 404, "Задание недоступно");
    const scope = await authorizeKpResource(context, metadata.kind, tx);
    const job = await readRenderJobInTransaction(tx, context.binding, jobId, lifecycleSecurity(scope));
    const output = { id: job.id, state: job.state, error: job.state === "FAILED" || job.state === "CANCELLED" ? "Документ не выпущен. Проверьте актуальность данных и доступ" : null };
    if (job.state !== "SUCCEEDED") return { ...output, result: null };
    const result = proposalObject(job.result);
    const artifactId = typeof result.artifactId === "string" ? result.artifactId : typeof result.pdfArtifactId === "string" ? result.pdfArtifactId : null;
    const artifact = artifactId ? await tx.proposalArtifact.findUnique({ where: { id: artifactId } }) : null;
    if (!artifact || metadata.kind === "PDF" && (artifact.kind !== "PDF" || artifact.proposalId !== metadata.proposalId) ||
      metadata.kind === "CONTRACT" && (artifact.kind !== "DOCX" || artifact.contractId !== metadata.contractId))
      return apiFailure("KP_JOB_RESULT_UNAVAILABLE", 410, "Результат задания недоступен");
    publishedProposalIds = metadata.kind === "PDF" && metadata.proposalId ? [metadata.proposalId] :
      metadata.kind === "CONTRACT" && Array.isArray(result.releases) ? result.releases.flatMap(release => {
        const proposalId = proposalObject(release).proposalId;
        return typeof proposalId === "string" ? [proposalId] : [];
      }) : [];
    return { ...output, result: { artifactId: artifact.id, ...(typeof result.versionId === "string" ? { versionId: result.versionId } : {}), fileName: await proposalArtifactFileName(tx, artifact), mimeType: artifact.mimeType } };
  });
  await revalidatePublishedProjectPdfs(prisma, publishedProposalIds);
  return response;
}
