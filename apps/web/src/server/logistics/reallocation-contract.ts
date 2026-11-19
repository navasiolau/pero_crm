import { z } from "zod";
import { logisticsShipmentLineSchema, type LogisticsShipmentLineInput } from "./contracts";

const id = z.string().trim().min(1).max(128);
export const reallocationVersionSchema = z.object({
  tripId: z.uuid(), postingId: z.uuid(), revision: z.number().int().min(1).max(2_147_483_646),
});
export const reallocationFields = {
  shares: z.array(z.object({ projectId: id, percentBps: z.number().int().min(1).max(10000) }).strict()).min(1).max(100),
  lines: z.array(logisticsShipmentLineSchema).min(1).max(500),
};
export const reallocationInputSchema = reallocationVersionSchema.extend(reallocationFields).extend({
  requestId: z.uuid(),
}).strict();
export const reallocationReversalKind = "logistics.posting.redistribute";
export const reallocationReversalSchema = reallocationVersionSchema.extend({ restorePostingId: z.uuid() }).strict();
export type ReallocationVersion = z.infer<typeof reallocationVersionSchema>;
export type ReallocationInput = z.infer<typeof reallocationInputSchema>;
export type ReallocationReversal = z.infer<typeof reallocationReversalSchema>;

export function normalizeShipmentLine(line: {
  projectId: string; kind: "PRODUCT" | "MATERIAL"; productId?: string | null; materialId?: string | null; quantity: number;
}): LogisticsShipmentLineInput {
  return line.kind === "PRODUCT"
    ? { projectId: line.projectId, kind: line.kind, productId: line.productId!, quantity: line.quantity }
    : { projectId: line.projectId, kind: line.kind, materialId: line.materialId!, quantity: line.quantity };
}
