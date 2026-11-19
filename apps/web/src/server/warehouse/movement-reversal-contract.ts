import { z } from "zod";

const id = z.string().min(1).max(160);
const revision = z.number().int().nonnegative();
const amount = z.string().regex(/^\d+(?:\.\d+)?$/);
const position = z.object({ quantity: amount, value: amount }).strict();
const counter = position.extend({ money: amount }).strict();
export const warehouseMovementReversalKind = "warehouse.movement";
export const warehouseMovementReversalSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("hide"), movementId: id, revision, movementIds: z.array(id).min(1).max(10_000) }).strict(),
  z.object({ mode: z.literal("restore"), deletionId: id }).strict(),
]);
export type WarehouseMovementReversal = z.infer<typeof warehouseMovementReversalSchema>;
export function warehouseMovementCommand(data: WarehouseMovementReversal) {
  return { kind: warehouseMovementReversalKind, version: 1, data };
}
export const warehouseRestorationSnapshot = z.object({
  materialId: id, runId: id, balanceRevision: revision,
  before: position, after: position,
  movementIds: z.array(id).min(1).max(10_000), paymentIds: z.array(id).max(10_000),
  productIds: z.array(id).max(10_000),
  lines: z.array(z.object({ id, revision, before: amount, after: amount })),
  counters: z.array(z.object({ id, before: counter, after: counter })),
}).strict();
export type WarehouseRestorationSnapshot = z.infer<typeof warehouseRestorationSnapshot>;
