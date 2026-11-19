import { createHash } from "node:crypto";
import { Prisma, type CommercialProposal, type Project } from "@prisma/client";
import { z } from "zod";
import { canonicalProposalJson, proposalObject } from "./proposal-contract";
import { itemMediaReferences } from "./media-contract";
import { proposalClientSnapshot } from "./proposal-client";
import { fixedProposalRate, proposalCurrency } from "./pricing-contract";
import { projectProposalPricing } from "./pricing";

export const proposalEditReversalKind = "proposal.edit";
export const proposalEditCommandSchema = z.object({
  proposalId: z.string().min(1),
  projectId: z.string().min(1),
  checkpointId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ProposalEditCommand = z.infer<typeof proposalEditCommandSchema>;

export const proposalEditCommand = (data: ProposalEditCommand) => ({
  kind: proposalEditReversalKind, version: 1, data: proposalEditCommandSchema.parse(data),
});

export function checkpointRate(proposal: Pick<CommercialProposal, "currency" | "rate" | "rateDate" | "rateSource">) {
  if (!proposal.rate || !proposal.rateDate || !proposal.rateSource) return null;
  return { currency: proposal.currency, rate: proposal.rate.toString(),
    rateDate: proposal.rateDate.toISOString().slice(0, 10), rateSource: proposal.rateSource };
}
export function checkpointBinding(value: unknown) {
  const binding = proposalObject(value as Prisma.JsonValue);
  const clientId = proposalObject(binding.binding).clientId;
  const { currency, rate, rateDate, rateSource } = binding;
  if (typeof clientId !== "string" || typeof currency !== "string" || typeof rate !== "string" ||
      typeof rateDate !== "string" || typeof rateSource !== "string") return null;
  try {
    const fx = fixedProposalRate({ currency, value: rate, date: rateDate, source: rateSource }, proposalCurrency(currency));
    return { clientId, fx };
  } catch {
    return null;
  }
}

const sameMoney = (a: unknown, b: Prisma.Decimal | null) => a == null ? b === null : b !== null && b.eq(String(a));

/** Производственная проекция должна точно восстанавливаться из неизменяемой редакции. */
export async function eligibleEditBaseline(tx: Prisma.TransactionClient, proposal: CommercialProposal, project: Project) {
  const rate = checkpointRate(proposal);
  if (!rate || !proposal.clientId || proposal.clientId !== project.clientId) return null;
  const state = proposalObject(proposal.state), clientState = proposalObject(proposalObject(state.client).crmSnapshot);
  const client = await tx.client.findUnique({ where: { id: project.clientId } });
  if (!client || canonicalProposalJson(clientState) !== canonicalProposalJson(proposalClientSnapshot(client))) return null;
  const order = proposalObject(state.order);
  if ((String(order.project ?? "").trim() || "Коммерческое предложение") !== project.title || (order.address ?? null) !== project.address) return null;
  let projection: ReturnType<typeof projectProposalPricing>;
  try {
    projection = projectProposalPricing(proposal.state as Parameters<typeof projectProposalPricing>[0],
      fixedProposalRate({ currency: rate.currency, value: rate.rate, date: rate.rateDate, source: rate.rateSource }, proposalCurrency(rate.currency)));
  } catch { return null; }
  if (Object.entries(projection.project).some(([field, value]) => field === "currency"
    ? project.currency !== value : !sameMoney(project[field as keyof Project], value as Prisma.Decimal | null))) return null;
  const items = await tx.proposalItem.findMany({ where: { proposalId: proposal.id, deletedAt: null },
    include: { product: { include: { _count: { select: { works: true, projectMaterials: true } } } } } });
  if (items.length !== projection.items.length) return null;
  const products = new Map(items.map(item => [item.id, item.product]));
  for (const item of projection.items) {
    const product = products.get(item.id);
    const itemRow = items.find(row => row.id === item.id);
    const itemState = proposalObject(itemRow?.state);
    if (!itemRow || !product || product.number !== project.number + "." + itemRow.position ||
      product.title !== (String(itemState.name ?? "").trim() || "Позиция " + itemRow.position) ||
      product.kind !== (String(itemState.kind ?? "").trim() || null) || product.deletedAt || product.projectId !== project.id || product.quantity !== item.quantity ||
      product.initialPriceCaptureEligible || !sameMoney(product.initialPrice, item.initialPrice) || !sameMoney(product.expectedPrice, item.expectedPrice) ||
      Number(proposalObject(product.technicalSpecifications).editRevision ?? 0) > 0) return null;
  }
  let mediaIds: string[];
  try {
    mediaIds = [...new Set(itemMediaReferences((proposal.state as { items: { id: string }[] }).items)
      .flatMap(item => item.mediaIds))].sort();
  } catch { return null; }
  const media = await tx.proposalCurrentMedia.findMany({ where: { proposalId: proposal.id, detachedAt: null }, select: { mediaId: true } });
  if (canonicalProposalJson(media.map(row => row.mediaId).sort()) !== canonicalProposalJson(mediaIds)) return null;
  return { rate, mediaIds, products };
}
export type EditBaseline = NonNullable<Awaited<ReturnType<typeof eligibleEditBaseline>>>;

export async function rememberEditCheckpoint(tx: Prisma.TransactionClient, proposal: Pick<CommercialProposal, "id" | "revision" | "state" | "clientId">, baseline: EditBaseline, actorId: string) {
  const candidates = await tx.proposalVersion.findMany({ where: { proposalId: proposal.id, revision: proposal.revision },
    include: { media: { select: { mediaId: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const existing = candidates.find(version => {
    const binding = checkpointBinding(version.renderSnapshot);
    return binding?.clientId === proposal.clientId && binding.fx.currency === baseline.rate.currency &&
      binding.fx.value.eq(baseline.rate.rate) && binding.fx.date === baseline.rate.rateDate && binding.fx.source === baseline.rate.rateSource &&
      canonicalProposalJson(version.state) === canonicalProposalJson(proposal.state) &&
      canonicalProposalJson(version.media.map(row => row.mediaId).sort()) === canonicalProposalJson(baseline.mediaIds);
  });
  if (existing) return existing.id;
  const created = await tx.proposalVersion.create({ data: {
    proposalId: proposal.id, revision: proposal.revision, trigger: "EDIT",
    state: proposal.state as Prisma.InputJsonValue, pricingSnapshot: {},
    renderSnapshot: { binding: { clientId: proposal.clientId }, ...baseline.rate }, templateVersion: "journal-edit-v1",
    createdById: actorId,
  }, select: { id: true } });
  if (baseline.mediaIds.length) await tx.proposalVersionMedia.createMany({ data:
    baseline.mediaIds.map(mediaId => ({ proposalId: proposal.id, versionId: created.id, mediaId })) });
  return created.id;
}

export async function proposalEditFingerprint(tx: Prisma.TransactionClient, proposalId: string, projectId: string, targetClientId: string) {
  const project = await tx.project.findUnique({ where: { id: projectId }, select: {
    updatedAt: true, deletedAt: true, stage: true, clientId: true,
    _count: { select: { products: true, tasks: true, payments: true, files: true, works: true,
      communications: true, logisticsShares: true, stageHistory: true } },
    tasks: { orderBy: { id: "asc" }, select: { id: true, updatedAt: true, status: true,
      _count: { select: { timeEntries: true, payrollEntries: true } } } },
    works: { orderBy: { id: "asc" }, select: { id: true, quantity: true, quantityPerUnit: true, total: true, paymentKind: true } },
    payments: { orderBy: { id: "asc" }, select: { id: true, amount: true, bynAmount: true, deletionId: true, paidAt: true } },
  } });
  const proposal = await tx.commercialProposal.findUnique({ where: { id: proposalId }, select: {
    updatedAt: true, revision: true, clientId: true, deletedAt: true, acceptedVersionId: true, projectId: true,
    primaryContract: { select: { id: true, revision: true } },
  } });
  const products = await tx.product.findMany({ where: { projectId }, orderBy: { id: "asc" }, select: {
    id: true, updatedAt: true, deletedAt: true, sketchFileId: true,
    _count: { select: { tasks: true, works: true, projectMaterials: true, files: true, stockMovements: true } },
    projectMaterials: { orderBy: { id: "asc" }, select: { id: true, updatedAt: true } },
  } });
  const clients = await tx.client.findMany({ where: { id: { in: [...new Set([targetClientId, project?.clientId ?? targetClientId])] } },
    orderBy: { id: "asc" }, select: { id: true, updatedAt: true } });
  const files = await tx.file.findMany({ where: { projectId }, orderBy: { id: "asc" },
    select: { id: true, deletedAt: true, proposalMediaRetiredAt: true, taskId: true, productId: true } });
  const items = await tx.proposalItem.findMany({ where: { proposalId }, orderBy: { id: "asc" },
    select: { id: true, productId: true, updatedAt: true, deletedAt: true, position: true } });
  const media = await tx.proposalCurrentMedia.findMany({ where: { proposalId }, orderBy: { mediaId: "asc" },
    select: { mediaId: true, detachedAt: true } });
  const versions = await tx.proposalVersion.findMany({ where: { proposalId, trigger: { not: "EDIT" } },
    orderBy: { id: "asc" }, select: { id: true, pdfArtifactId: true, pdfArtifact: { select: { deletedAt: true } } } });
  const renderJobs = await tx.proposalJob.findMany({ where: { kind: { in: ["PDF", "CONTRACT"] },
    OR: [{ proposalId }, { contract: { primaryProposalId: proposalId } }] },
    orderBy: { id: "asc" }, select: { id: true, state: true, attempts: true } });
  const draftPools = await tx.productStagePayPool.findMany({ where: { product: { projectId } }, orderBy: { id: "asc" },
    select: { id: true, state: true, revision: true } });
  return createHash("sha256").update(JSON.stringify({ project, proposal, products, clients, files, items, media, versions, renderJobs, draftPools })).digest("hex");
}

