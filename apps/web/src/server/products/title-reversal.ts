import { z } from "zod";
import { defineFieldReversal } from "@/server/changelog/field-reversal";
import { JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { liveProductWhere } from "@/server/access/live-entities";
import { updateProductValues, type ProductValues } from "./core";
import { lockProductRow } from "./quantity-core";
import { warehouseMetadataGate } from "@/server/warehouse/gate";
import { PRODUCT_CARD_FIELDS, productFieldKind, productFieldState, type ProductCardField } from "./scalar-reversal";

const fieldValue: Record<ProductCardField, z.ZodType<string | number | null>> = {
  title: z.string(),
  kind: z.string().nullable(),
  description: z.string().nullable(),
  engineerId: z.string().nullable(),
  quantity: z.number().int().positive(),
  expectedPrice: z.string().nullable(),
};

export const productFieldReversals = PRODUCT_CARD_FIELDS.map(field => defineFieldReversal({
  kind: productFieldKind(field), entity: "product", field, value: fieldValue[field],
  version: field === "title" ? 1 : 2,
  async read(tx, id) {
    const product = await tx.product.findFirst({ where: { id, ...liveProductWhere } });
    return product ? productFieldState(field, product) : null;
  },
  async lock(tx, id) {
    if (field === "quantity") await warehouseMetadataGate(tx);
    await lockProductRow(tx, id);
  },
  async update(ctx, previous, value) {
    const href = `/products/${encodeURIComponent(ctx.entityId)}`;
    try {
      const result = await updateProductValues(ctx.actor, ctx.entityId, { [field]: value } as ProductValues,
        { [field]: previous }, ctx.tx, { operationRootId: ctx.reversalId, restoreRecordedValue: true });
      if (!result.ok || result.noOp)
        throw new JournalReversalRefusal(result.ok ? "Поле не изменилось" : result.error, href);
      const { number, projectId } = result.after;
      return { ...productFieldState(field, result.after),
        cachePaths: ["/products", `/products/${encodeURIComponent(number)}`, "/projects", `/projects/${encodeURIComponent(projectId)}`,
          ...(field === "quantity" ? ["/", "/finance", "/warehouse", "/warehouse/stock", "/warehouse/items"] : [])] };
    } catch (error) {
      if (error instanceof JournalReversalRefusal) throw error;
      if (error instanceof Error && /^(Работа|Материал) «/.test(error.message))
        throw new JournalReversalRefusal(error.message, href);
      throw error;
    }
  },
}));
