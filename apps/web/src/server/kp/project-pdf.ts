import type { Prisma } from "@prisma/client";
import type { OrdinaryFileListRow } from "@/server/files/list-view";
import { generalProjectFileVisibilityWhere, resolveVisibilityActor, type VisibilityActor } from "@/server/access/visibility";
import { liveProjectWhere } from "@/server/access/live-entities";
import { createProposalArtifactStorage } from "./artifact-storage";
import { apiFailure } from "./api-contract";
import { proposalPdfFileName } from "./pdf-filename";
import { pdfDownloadStream } from "./pdf-io";

type ProjectPdfDb = Pick<Prisma.TransactionClient, "commercialProposal" | "proposalVersion" | "task" | "productPercentageParticipant">;
type ArtifactReader = Pick<ReturnType<typeof createProposalArtifactStorage>, "read"> & Partial<Pick<ReturnType<typeof createProposalArtifactStorage>, "downloadFile">>;

async function currentProjectPdf(db: ProjectPdfDb, actor: VisibilityActor, projectId: string) {
  const currentActor = await resolveVisibilityActor(db, actor);
  const proposal = await db.commercialProposal.findFirst({
    where: { projectId, deletedAt: null, project: generalProjectFileVisibilityWhere(currentActor) },
    select: { id: true, acceptedVersionId: true, project: { select: { stage: true } } },
  });
  if (!proposal?.project || proposal.project.stage !== "LEAD" && !proposal.acceptedVersionId) return null;
  const version = await db.proposalVersion.findFirst({
    where: { proposalId: proposal.id,
      ...(proposal.project.stage !== "LEAD" ? { id: proposal.acceptedVersionId! } : {}),
      pdfArtifact: { is: { proposalId: proposal.id, contractId: null, kind: "PDF", state: "READY", deletedAt: null, mimeType: "application/pdf" } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, state: true, pdfArtifact: true },
  });
  if (!version?.pdfArtifact) return null;
  return { versionId: version.id, artifact: version.pdfArtifact, fileName: proposalPdfFileName(version.state, version.pdfArtifact.fileName) };
}

/** Одна управляемая строка; ID проекта даёт постоянную ссылку на текущий выпуск. */
export async function projectProposalPdfFile(db: ProjectPdfDb, actor: VisibilityActor, projectId: string): Promise<OrdinaryFileListRow | null> {
  const current = await currentProjectPdf(db, actor, projectId);
  return current ? { id: projectId, fileName: current.fileName, mimeType: "application/pdf", source: "proposal", section: "GENERAL", canDelete: false } : null;
}

/** Проверка приватного storage и повторная live ACL не позволяют выдать прежний или скрытый выпуск. */
export async function readProjectProposalPdf(db: ProjectPdfDb, authorizeActor: () => Promise<VisibilityActor | null>, projectId: string,
  storage: ArtifactReader = createProposalArtifactStorage(), signal?: AbortSignal) {
  const actor = await authorizeActor();
  const current = actor ? await currentProjectPdf(db, actor, projectId) : null;
  if (!current) return null;
  const authorize = async () => {
    const actor = await authorizeActor();
    const fresh = actor ? await currentProjectPdf(db, actor, projectId) : null;
    if (!fresh || fresh.versionId !== current.versionId || fresh.artifact.id !== current.artifact.id ||
      fresh.artifact.key !== current.artifact.key || fresh.artifact.sha256 !== current.artifact.sha256 || fresh.artifact.size !== current.artifact.size ||
      JSON.stringify(fresh.artifact.storageBinding) !== JSON.stringify(current.artifact.storageBinding))
      apiFailure("KP_PROJECT_PDF_NOT_FOUND", 404, "Файл не найден");
  };
  if (storage.downloadFile) {
    const file = await storage.downloadFile(current.artifact, authorize, signal);
    return { body: pdfDownloadStream(async function* (readSignal) { yield* await file.openRead(readSignal); }, signal, file.dispose), size: file.size, fileName: current.fileName, mimeType: "application/pdf" };
  }
  const bytes = await storage.read(current.artifact, authorize, signal);
  return { bytes, fileName: current.fileName, mimeType: "application/pdf" };
}

/** Только request-adapter инвалидирует страницы после подтверждения успешного задания. */
export async function publishedProjectPdfPaths(db: Pick<Prisma.TransactionClient, "commercialProposal">, proposalIds: readonly string[]) {
  if (!proposalIds.length) return [];
  const proposals = await db.commercialProposal.findMany({ where: {
    id: { in: [...new Set(proposalIds)] }, projectId: { not: null }, deletedAt: null, project: liveProjectWhere,
  }, select: { projectId: true } });
  return proposals.length ? ["/projects", ...new Set(proposals.map(proposal => `/projects/${proposal.projectId}`))] : [];
}
