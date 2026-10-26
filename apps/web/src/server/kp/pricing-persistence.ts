import { Prisma } from "@prisma/client";
import { hasAnyRole, MANAGER_ROLES } from "../../lib/roles";
import type { DomainActor } from "../actor";
import type { ProposalPricingProjection } from "./pricing-contract";

type PricingTransaction = Pick<Prisma.TransactionClient, "$queryRaw" | "product" | "project" | "changeLog">;
export type ProposalPricingContext = { proposalId: string; project: { id: string; stage: string; currency: string };
  items: readonly { id: string; productId: string }[]; actor: DomainActor };

/** Вызывается pricing hook общего сохранения №181, в той же транзакции после синхронизации состава. */
export async function applyProjectionInTransaction(tx: PricingTransaction, context: ProposalPricingContext, projection: ProposalPricingProjection): Promise<void> {
  if (!hasAnyRole(context.actor.roles, MANAGER_ROLES)) throw Error("Недостаточно прав для сохранения цен КП");
  const rows = await tx.$queryRaw<{ id: string; stage: string; currency: string; initialPrice: Prisma.Decimal | null;
    servicesTotal: Prisma.Decimal | null; delivery: Prisma.Decimal | null; unloading: Prisma.Decimal | null;
    installation: Prisma.Decimal | null; proposalRoundingAdjustment: Prisma.Decimal }[]>`
    SELECT p.id, p.stage, p.currency, p."initialPrice", p."servicesTotal", p.delivery, p.unloading,
      p.installation, p."proposalRoundingAdjustment"
    FROM "Project" p JOIN "CommercialProposal" cp ON cp."projectId" = p.id
    WHERE p.id = ${context.project.id} AND cp.id = ${context.proposalId}
      AND p."deletedAt" IS NULL AND cp."deletedAt" IS NULL
    FOR UPDATE OF p`;
  const project = rows[0];
  if (rows.length !== 1 || !project || project.stage !== "LEAD" || context.project.stage !== "LEAD") throw Error("Цены КП можно сохранить только в связанном проекте «Лид»");
  if (project.currency !== "BYN" || projection.project.currency !== "BYN") throw Error("Коммерческие цены CRM должны быть в BYN");
  const products = await tx.product.findMany({ where: { projectId: project.id, deletedAt: null },
    select: { id: true, quantity: true, initialPrice: true, expectedPrice: true, initialPriceCaptureEligible: true } });
  const links = new Map(context.items.map(item => [item.id, item.productId]));
  if (links.size !== context.items.length || projection.items.length !== links.size || products.length !== links.size ||
    new Set(context.items.map(item => item.productId)).size !== links.size || new Set(projection.items.map(item => item.id)).size !== links.size) throw Error("Состав КП изменился — повторите сохранение");
  const byId = new Map(products.map(product => [product.id, product]));
  for (const item of projection.items) {
    const productId = links.get(item.id);
    if (!productId || byId.get(productId)?.quantity !== item.quantity) throw Error("Состав КП изменился — повторите сохранение");
  }
  for (const item of projection.items) {
    const productId = links.get(item.id)!;
    const updated = await tx.product.updateMany({ where: { id: productId, projectId: project.id, deletedAt: null, quantity: item.quantity },
      data: { initialPrice: item.initialPrice, expectedPrice: item.expectedPrice, initialPriceCaptureEligible: false } });
    if (updated.count !== 1) throw Error("Изделие изменилось во время сохранения КП");
  }
  const updated = await tx.project.updateMany({ where: { id: project.id, stage: "LEAD", deletedAt: null }, data: projection.project });
  if (updated.count !== 1) throw Error("Этап проекта изменился во время сохранения КП");
  const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
  await tx.changeLog.create({ data: { actorType: "user", actorId: context.actor.id, actorName: context.actor.name,
    source: context.actor.source, entity: "project", entityId: project.id, action: "proposal.pricing.sync",
    oldValue: json({ project, products }), newValue: json({ proposalId: context.proposalId, project: projection.project, items: projection.items,
      rate: { ...projection.rate, value: projection.rate.value.toString() } }) } });
}
