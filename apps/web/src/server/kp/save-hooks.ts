import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PreparedProductMedia } from "./media-contract";
import { createProposalMediaHooks } from "./media-product-sync";
import { createProposalMediaS3Storage } from "./media-storage";
import { projectProposalPricing } from "./pricing";
import { rateDto, storedKpRate, type ProposalFixedRate } from "./pricing-contract";
import { applyProjectionInTransaction } from "./pricing-persistence";
import type { ProposalSaveHooks } from "./proposal-core";
import { canonicalProposalJson, ProposalWriteError } from "./proposal-contract";

const rateFingerprint = (rate: ProposalFixedRate) => createHash("sha256").update(canonicalProposalJson(rateDto(rate))).digest("hex");
const moneyEqual = (left: unknown, right: unknown) => left == null || right == null ? left == null && right == null : new Prisma.Decimal(String(left)).eq(String(right));
export function createProposalSaveHooks(fx: ProposalFixedRate, preparedCopies?: PreparedProductMedia,
  fail: (kind: "validation" | "conflict", message: string) => never = (kind, message) => { throw new ProposalWriteError(kind, message); },
): ProposalSaveHooks {
  const media = createProposalMediaHooks({ storage: createProposalMediaS3Storage(), preparedCopies });
  return {
    pricingFingerprint: rateFingerprint(fx), journalCheckpoints: true, applyMedia: media.applyMedia,
    async applyPricing(tx, context) {
      let projection;
      try { projection = projectProposalPricing(context.state, fx); }
      catch (error) { return fail("validation", error instanceof Error ? error.message : "Проверьте цены и курс КП"); }
      const currentProject = await tx.project.findUniqueOrThrow({ where: { id: context.project.id } });
      const products = await tx.product.findMany({ where: { projectId: context.project.id, deletedAt: null } });
      const links = new Map(context.items.map(item => [item.id, item]));
      if (products.length !== projection.items.length || context.items.length !== projection.items.length) return fail("conflict", "Изменился состав КП");
      const changedPools: string[] = [];
      let productsChanged = false;
      for (const item of projection.items) {
        const link = links.get(item.id), actual = products.find(product => product.id === link?.productId);
        if (!actual || actual.quantity !== item.quantity) return fail("conflict", "Изменился состав КП");
        if (!moneyEqual(actual.expectedPrice, item.expectedPrice) || link?.previousQuantity != null && link.previousQuantity !== item.quantity) changedPools.push(actual.id);
        if (!moneyEqual(actual.initialPrice, item.initialPrice) || !moneyEqual(actual.expectedPrice, item.expectedPrice) || actual.initialPriceCaptureEligible) productsChanged = true;
      }
      const projectChanged = Object.entries(projection.project).some(([field, value]) => field === "currency"
        ? currentProject.currency !== value : !moneyEqual(currentProject[field as keyof typeof currentProject], value));
      const oldRate = storedKpRate(context.proposal), rateChanged = !oldRate || rateFingerprint(oldRate) !== rateFingerprint(fx);
      if (productsChanged || projectChanged) {
        await applyProjectionInTransaction(tx, context, projection);
      }
      if (changedPools.length) await tx.productStagePayPool.updateMany({ where: { productId: { in: changedPools }, kind: "ENGINEERING", state: "DRAFT" }, data: { revision: { increment: 1 } } });
      if (rateChanged) await tx.commercialProposal.update({ where: { id: context.proposalId }, data: {
        currency: fx.currency, rate: fx.value, rateDate: new Date(`${fx.date}T00:00:00Z`), rateSource: fx.source } });
      return { changed: productsChanged || projectChanged || rateChanged };
    },
  };
}
