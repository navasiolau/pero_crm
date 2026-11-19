import { z } from "zod";
import { Prisma } from "@prisma/client";
import { defineJournalReversal, JournalReversalRefusal, type JournalReversalCommand } from "@/server/changelog/reversal-contract";
import { proposalEditFingerprints } from "./edit-checkpoint";
import type { ContractFrozenSource } from "./contract-ports";

const acceptedState = z.object({
  stage: z.enum(["LEAD", "ESTIMATE", "CONTRACT"]),
  acceptedVersionId: z.string().nullable(),
  acceptedAt: z.iso.datetime().nullable(),
});
const transition = z.object({
  proposalId: z.string(), projectId: z.string(),
  prior: acceptedState, issued: acceptedState,
  promoted: z.array(z.string()),
});
const publication = z.object({
  contractId: z.string(), versionId: z.string(), docxArtifactId: z.string(), revision: z.number().int(),
  pdfs: z.array(z.object({ versionId: z.string(), artifactId: z.string(), proposalId: z.string() })),
  transitions: z.array(transition).min(1),
  scope: z.array(z.object({ proposalId: z.string(), projectId: z.string(), clientId: z.string(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })).min(1),
  expectedDeletedAt: z.iso.datetime().nullable(),
  hide: z.boolean(),
}).strict();
type Publication = z.infer<typeof publication>;
export type ReleaseStageBefore = Omit<z.infer<typeof transition>, "issued">;
export type PublicationIdentity = Pick<Publication, "contractId" | "versionId" | "docxArtifactId" | "revision" | "pdfs">;
const refusal = "После выпуска договора изменились этапы, изделия, документы или связанные данные";

export async function captureReleaseStages(tx: Prisma.TransactionClient, sources: readonly ContractFrozenSource[]): Promise<ReleaseStageBefore[]> {
  const pending = sources.filter((source): source is ContractFrozenSource & { projectStage: "LEAD" | "ESTIMATE" } =>
    source.projectStage === "LEAD" || source.projectStage === "ESTIMATE");
  if (!pending.length) return [];
  const projectIds = pending.map(source => source.projectId);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Product" WHERE "projectId" IN (${Prisma.join(projectIds)})
    ORDER BY "projectId",id FOR UPDATE`);
  const proposals = await tx.commercialProposal.findMany({ where: { id: { in: pending.map(source => source.proposalId) } },
    select: { id: true, acceptedVersionId: true, acceptedAt: true } });
  const products = await tx.product.findMany({ where: { projectId: { in: projectIds }, deletedAt: null, status: "DRAFT" },
    orderBy: { id: "asc" }, select: { id: true, projectId: true } });
  return pending.map(source => {
    const proposal = proposals.find(row => row.id === source.proposalId);
    if (!proposal) throw Error("CONTRACT_RELEASE_SOURCE_MISSING");
    return { proposalId: source.proposalId, projectId: source.projectId,
      promoted: products.filter(product => product.projectId === source.projectId).map(product => product.id),
      prior: { stage: source.projectStage, acceptedVersionId: proposal.acceptedVersionId, acceptedAt: proposal.acceptedAt?.toISOString() ?? null } };
  });
}

export async function makePublicationReversal(tx: Prisma.TransactionClient, identity: PublicationIdentity,
  sources: readonly ContractFrozenSource[], before: readonly ReleaseStageBefore[]): Promise<JournalReversalCommand> {
  const proposals = await tx.commercialProposal.findMany({ where: { id: { in: before.map(row => row.proposalId) } },
    select: { id: true, acceptedVersionId: true, acceptedAt: true } });
  const transitions: Publication["transitions"] = before.map(previous => {
    const current = proposals.find(row => row.id === previous.proposalId);
    if (!current) throw Error("CONTRACT_RELEASE_SOURCE_MISSING");
    return { ...previous, issued: { stage: "CONTRACT", acceptedVersionId: current.acceptedVersionId,
      acceptedAt: current.acceptedAt?.toISOString() ?? null } };
  });
  const scope = await proposalEditFingerprints(tx, sources.map(source => {
    if (!source.binding.clientId) throw Error("CONTRACT_RELEASE_CLIENT_MISSING");
    return { proposalId: source.proposalId, projectId: source.projectId, clientId: source.binding.clientId };
  }));
  return contractPublicationReversal.command({ ...identity, transitions, scope, expectedDeletedAt: null, hide: true });
}

async function eligible(tx: Prisma.TransactionClient, data: Publication): Promise<boolean> {
  const deletedAt = data.expectedDeletedAt ? new Date(data.expectedDeletedAt) : null;
  const latest = await tx.proposalContractVersion.findFirst({ where: { contractId: data.contractId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, docxArtifactId: true, docxArtifact: { select: { deletedAt: true, state: true } },
      contract: { select: { revision: true, deletedAt: true } } } });
  if (!latest || latest.id !== data.versionId || latest.docxArtifactId !== data.docxArtifactId || latest.contract.deletedAt ||
      latest.contract.revision !== data.revision || latest.docxArtifact.state !== "READY" ||
      latest.docxArtifact.deletedAt?.getTime() !== deletedAt?.getTime()) return false;
  const fingerprints = await proposalEditFingerprints(tx, data.scope);
  if (fingerprints.some((source, index) => source.fingerprint !== data.scope[index].fingerprint)) return false;
  if (data.pdfs.length) {
    const pdfs = await tx.proposalVersion.findMany({ where: { id: { in: data.pdfs.map(pdf => pdf.versionId) },
      trigger: "CONTRACT", pdfArtifact: { state: "READY", deletedAt } },
      select: { id: true, proposalId: true, pdfArtifactId: true } });
    if (!data.pdfs.every(pdf => pdfs.some(row => row.id === pdf.versionId && row.proposalId === pdf.proposalId &&
        row.pdfArtifactId === pdf.artifactId))) return false;
    if (await tx.proposalContractVersion.count({ where: { id: { not: data.versionId },
      OR: data.pdfs.map(pdf => ({ renderSnapshot: { path: ["releases"], array_contains: [{ versionId: pdf.versionId }] } })) } })) return false;
  }
  return true;
}

export const contractPublicationReversal = defineJournalReversal({
  kind: "proposal.contract.publish",
  version: 1,
  schema: publication,
  async preview({ tx }, data) { return await eligible(tx, data) ? null : refusal; },
  async apply({ tx, actor }, data) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
    const projectIds = [...new Set(data.scope.map(row => row.projectId))];
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Project" WHERE id IN (${Prisma.join(projectIds)}) ORDER BY id FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "CommercialProposal" WHERE id IN (${Prisma.join(data.scope.map(row => row.proposalId))})
      ORDER BY id FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Product" WHERE "projectId" IN (${Prisma.join(projectIds)})
      ORDER BY "projectId",id FOR UPDATE`);
    await tx.$queryRaw`SELECT id FROM "ProposalContract" WHERE id=${data.contractId} FOR UPDATE`;
    if (!await eligible(tx, data)) throw new JournalReversalRefusal(refusal);
    const now = new Date();
    for (const transition of data.transitions) {
      const expected = data.hide ? transition.issued : transition.prior;
      const target = data.hide ? transition.prior : transition.issued;
      const updated = await tx.project.updateMany({ where: { id: transition.projectId, stage: expected.stage, deletedAt: null },
        data: { stage: target.stage, stageChangedAt: now } });
      if (updated.count !== 1) throw new JournalReversalRefusal(refusal);
      await tx.projectStageHistory.create({ data: { projectId: transition.projectId, fromStage: expected.stage,
        toStage: target.stage, changedById: actor.id, comment: "Откат выпуска договора в CRM" } });
      const accepted = await tx.commercialProposal.updateMany({ where: { id: transition.proposalId,
        acceptedVersionId: expected.acceptedVersionId, deletedAt: null }, data: {
        acceptedVersionId: target.acceptedVersionId, acceptedAt: target.acceptedAt ? new Date(target.acceptedAt) : null,
        retentionEpoch: { increment: 1 },
      } });
      if (accepted.count !== 1) throw new JournalReversalRefusal(refusal);
      const from = data.hide ? "PREPARATION" : "DRAFT";
      const to = data.hide ? "DRAFT" : "PREPARATION";
      for (const productId of transition.promoted) {
        const product = await tx.product.updateMany({ where: { id: productId, projectId: transition.projectId, deletedAt: null, status: from },
          data: { status: to, statusChangedAt: now } });
        if (product.count !== 1) throw new JournalReversalRefusal(refusal);
        await tx.productStatusHistory.create({ data: { productId, fromStatus: from, toStatus: to,
          changedById: actor.id, comment: "Откат выпуска договора в CRM", createdAt: now } });
      }
    }
    const ids = [data.docxArtifactId, ...data.pdfs.map(pdf => pdf.artifactId)];
    const deletedAt = data.hide ? now : null;
    const changed = await tx.proposalArtifact.updateMany({ where: { id: { in: ids }, state: "READY",
      deletedAt: data.expectedDeletedAt ? new Date(data.expectedDeletedAt) : null }, data: { deletedAt } });
    if (changed.count !== ids.length) throw new JournalReversalRefusal(refusal);
    return {
      inverse: { ...data, hide: !data.hide, expectedDeletedAt: deletedAt?.toISOString() ?? null,
        scope: await proposalEditFingerprints(tx, data.scope) },
      oldValue: { documentVisible: data.hide },
      newValue: { documentVisible: !data.hide, projects: data.transitions.map(value => value.projectId) },
      cachePaths: ["/kp", "/projects", "/products", ...data.scope.map(value => "/projects/" + encodeURIComponent(value.projectId))],
    };
  },
});
