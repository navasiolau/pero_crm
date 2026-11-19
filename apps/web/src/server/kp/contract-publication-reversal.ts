import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { defineJournalReversal, JournalReversalRefusal, type JournalReversalCommand } from "@/server/changelog/reversal-contract";
import { lockProjectRow } from "@/server/projects/lock";
import { proposalEditFingerprint } from "./edit-checkpoint";
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
  const snapshots: ReleaseStageBefore[] = [];
  for (const source of sources) {
    if (source.projectStage !== "LEAD" && source.projectStage !== "ESTIMATE") continue;
    await tx.$queryRaw`SELECT id FROM "Product" WHERE "projectId"=${source.projectId} ORDER BY id FOR UPDATE`;
    const proposal = await tx.commercialProposal.findUniqueOrThrow({ where: { id: source.proposalId }, select: { acceptedVersionId: true, acceptedAt: true } });
    const products = await tx.product.findMany({ where: { projectId: source.projectId, deletedAt: null, status: "DRAFT" },
      orderBy: { id: "asc" }, select: { id: true } });
    snapshots.push({ proposalId: source.proposalId, projectId: source.projectId, promoted: products.map(product => product.id),
      prior: { stage: source.projectStage, acceptedVersionId: proposal.acceptedVersionId, acceptedAt: proposal.acceptedAt?.toISOString() ?? null } });
  }
  return snapshots;
}

async function fingerprintScope(tx: Prisma.TransactionClient, scope: readonly Omit<Publication["scope"][number], "fingerprint">[]) {
  const rows: Publication["scope"] = [];
  for (const source of scope) rows.push({ ...source,
    fingerprint: await proposalEditFingerprint(tx, source.proposalId, source.projectId, source.clientId) });
  return rows;
}

export async function makePublicationReversal(tx: Prisma.TransactionClient, identity: PublicationIdentity,
  sources: readonly ContractFrozenSource[], before: readonly ReleaseStageBefore[]): Promise<JournalReversalCommand> {
  const transitions: Publication["transitions"] = [];
  for (const previous of before) {
    const current = await tx.commercialProposal.findUniqueOrThrow({ where: { id: previous.proposalId },
      select: { acceptedVersionId: true, acceptedAt: true } });
    transitions.push({ ...previous, issued: { stage: "CONTRACT", acceptedVersionId: current.acceptedVersionId,
      acceptedAt: current.acceptedAt?.toISOString() ?? null } });
  }
  const scope = await fingerprintScope(tx, sources.map(source => {
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
  for (const source of data.scope) if (await proposalEditFingerprint(tx, source.proposalId, source.projectId, source.clientId) !== source.fingerprint) return false;
  for (const pdf of data.pdfs) {
    const row = await tx.proposalVersion.findFirst({ where: { id: pdf.versionId, proposalId: pdf.proposalId, trigger: "CONTRACT",
      pdfArtifactId: pdf.artifactId, pdfArtifact: { state: "READY", deletedAt } }, select: { id: true } });
    if (!row || await tx.proposalContractVersion.count({ where: { id: { not: data.versionId },
      renderSnapshot: { path: ["releases"], array_contains: [{ versionId: pdf.versionId }] } } })) return false;
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
    for (const source of [...data.scope].sort((a, b) => a.projectId.localeCompare(b.projectId))) {
      await lockProjectRow(tx, source.projectId);
      await tx.$queryRaw`SELECT id FROM "CommercialProposal" WHERE id=${source.proposalId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Product" WHERE "projectId"=${source.projectId} ORDER BY id FOR UPDATE`;
    }
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
        scope: await fingerprintScope(tx, data.scope) },
      oldValue: { documentVisible: data.hide },
      newValue: { documentVisible: !data.hide, projects: data.transitions.map(value => value.projectId) },
      cachePaths: ["/kp", "/projects", "/products", ...data.scope.map(value => "/projects/" + encodeURIComponent(value.projectId))],
    };
  },
});

