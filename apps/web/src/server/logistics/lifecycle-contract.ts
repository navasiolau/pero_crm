import { z } from "zod";
import type { JournalReversalCommand } from "@/server/changelog/reversal-contract";
import type { LogisticsManifestRecord } from "./core";

const manifestSchema = z.object({
  date: z.iso.date(), comment: z.string(), ttnNotRequired: z.boolean(),
  shares: z.array(z.object({ projectId: z.string(), percentBps: z.number().int() })),
  lines: z.array(z.object({
    projectId: z.string(), kind: z.enum(["PRODUCT", "MATERIAL"]), productId: z.string().nullable(),
    materialId: z.string().nullable(), nameSnapshot: z.string(), numberSnapshot: z.string().nullable(),
    unitSnapshot: z.string(), quantity: z.number(),
  })),
});

export const tripUndoSchema = z.object({
  tripId: z.string(), expectedRevision: z.number().int().positive(), expectedHidden: z.boolean(),
  expectedPostingId: z.string().nullable(), restoreHidden: z.boolean(), restorePostingId: z.string().nullable(),
  manifest: manifestSchema.nullable(), requireNoDocuments: z.boolean(),
});
export const documentUndoSchema = z.object({
  tripId: z.string(), documentId: z.string(), expectedRevision: z.number().int().nonnegative(), hide: z.boolean(),
});
export const tripUndoKind = "logistics.trip-lifecycle";
export const documentUndoKind = "logistics.document-visibility";
export type TripUndo = z.infer<typeof tripUndoSchema>;
export function logisticsTripUndoCommand(data: TripUndo): JournalReversalCommand {
  return { kind: tripUndoKind, version: 1, data };
}
export function logisticsDocumentUndoCommand(data: z.infer<typeof documentUndoSchema>): JournalReversalCommand {
  return { kind: documentUndoKind, version: 1, data };
}

export function manifestSnapshot(row: LogisticsManifestRecord): z.infer<typeof manifestSchema> {
  return { date: row.date.toISOString().slice(0, 10), comment: row.comment, ttnNotRequired: row.ttnNotRequired,
    shares: row.shares.map(({ projectId, percentBps }) => ({ projectId, percentBps })),
    lines: row.lines.map(({ projectId, kind, productId, materialId, nameSnapshot, numberSnapshot, unitSnapshot, quantity }) =>
      ({ projectId, kind, productId, materialId, nameSnapshot, numberSnapshot, unitSnapshot, quantity: quantity.toNumber() })) };
}