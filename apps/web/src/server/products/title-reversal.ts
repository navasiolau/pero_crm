import { z } from "zod";
import { JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { updateProductValues } from "./core";
import { PRODUCT_TITLE_REVERSAL, productScalarReversal } from "./scalar-reversal";

export const productTitleReversal = productScalarReversal({
  kind: PRODUCT_TITLE_REVERSAL,
  value: z.string(),
  async read(tx, id) {
    const product = await tx.product.findUnique({ where: { id }, select: { title: true, titleRevision: true } });
    return product ? { value: product.title, revision: product.titleRevision } : null;
  },
  async update(ctx, previous, value) {
    const result = await updateProductValues(ctx.actor, ctx.entityId, { title: value }, { title: previous }, ctx.tx);
    if (!result.ok || result.noOp)
      throw new JournalReversalRefusal(result.ok ? "Название не изменилось" : result.error);
    return { value: result.after.title, revision: result.after.titleRevision };
  },
});
