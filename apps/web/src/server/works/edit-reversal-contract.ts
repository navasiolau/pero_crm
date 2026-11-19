import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { trackedRevision } from "@/server/tasks/edit-reversal-contract";

const workPlanValue = z.object({
  quantity: z.string(), quantityPerUnit: z.string().nullable(), total: z.string().nullable(),
  price: z.object({ priceItemId: z.string().nullable(), title: z.string(), unitSnapshot: z.string().nullable(), priceSnapshot: z.string() }).optional(),
}).strict();
export const workEditReversalKind = "work.edit";
export const workEditReversalSchema = z.object({
  expected: workPlanValue, restore: workPlanValue,
  revisions: z.record(z.string(), z.number().int().nonnegative()),
}).strict();
export type WorkEditReversal = z.infer<typeof workEditReversalSchema>;

export type WorkEditRow = {
  quantity: Prisma.Decimal; quantityPerUnit: Prisma.Decimal | null; total: Prisma.Decimal | null;
  priceItemId: string | null; title: string; unitSnapshot: string | null; priceSnapshot: Prisma.Decimal | null;
  journalFieldRevisions: Prisma.JsonValue;
};
export function workEditSnapshot(row: WorkEditRow, includePrice: boolean) {
  return { quantity: row.quantity.toString(), quantityPerUnit: row.quantityPerUnit?.toString() ?? null,
    total: row.total?.toString() ?? null, ...(includePrice && row.priceSnapshot !== null && {
      price: { priceItemId: row.priceItemId, title: row.title, unitSnapshot: row.unitSnapshot, priceSnapshot: row.priceSnapshot.toString() },
    }) };
}
export function createWorkEditReversal(before: WorkEditRow, after: WorkEditRow): WorkEditReversal | null {
  if (!before.priceSnapshot || !after.priceSnapshot) return null;
  const includesPrice = JSON.stringify(workEditSnapshot(before, true).price) !== JSON.stringify(workEditSnapshot(after, true).price);
  const expected = workEditSnapshot(after, includesPrice), restore = workEditSnapshot(before, includesPrice);
  if (JSON.stringify(expected) === JSON.stringify(restore)) return null;
  const fields = ["quantity", "quantityPerUnit", "total", "priceSnapshot", ...(includesPrice ? ["priceItemId", "title", "unitSnapshot"] : [])];
  return { expected, restore, revisions: Object.fromEntries(fields.map(field => [field, trackedRevision(after.journalFieldRevisions, field)])) };
}
