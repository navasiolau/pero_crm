import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { reallocationReversalKind, reallocationReversalSchema, reallocationFields, normalizeShipmentLine, type ReallocationReversal } from "./reallocation-contract";
import { loadReallocation, prepareReallocation, redistributeTripInTransaction } from "./reallocation-core";

const recordedManifest = z.object({ shares: reallocationFields.shares, lines: z.array(z.object({
  projectId: z.string(), kind: z.enum(["PRODUCT", "MATERIAL"]), productId: z.string().nullable(),
  materialId: z.string().nullable(), quantity: z.number(),
})) });

async function restoreInput(tx: Prisma.TransactionClient, data: ReallocationReversal, requestId: string) {
  const { posting } = await loadReallocation(tx, data);
  const previous = await tx.logisticsPosting.findUnique({ where: { id: data.restorePostingId } });
  if (!previous || previous.tripId !== posting.tripId || previous.status !== "SUPERSEDED" ||
      !(posting.reallocatedFromId === previous.id || previous.tripRevision < posting.tripRevision))
    throw new JournalReversalRefusal("Предыдущее распределение не найдено");
  const saved = recordedManifest.parse(previous.manifestSnapshot);
  return { tripId: data.tripId, postingId: data.postingId, revision: data.revision, requestId,
    shares: saved.shares, lines: saved.lines.map(normalizeShipmentLine) };
}

export const logisticsReallocationReversal = defineJournalReversal({
  kind: reallocationReversalKind,
  version: 1,
  schema: reallocationReversalSchema,
  async preview(ctx, data) {
    try {
      await prepareReallocation(ctx.tx, ctx.actor.id, await restoreInput(ctx.tx, data, "00000000-0000-4000-8000-000000000000"));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Распределение изменилось";
    }
  },
  async apply(ctx, data) {
    try {
      const requestId = ctx.reversalId!.slice("journal-reversal:".length);
      const result = await redistributeTripInTransaction(ctx.tx, ctx.actor.id, await restoreInput(ctx.tx, data, requestId), true);
      if (!result.hints) throw new JournalReversalRefusal("Распределение изменилось");
      return { inverse: { tripId: data.tripId, postingId: result.postingId, revision: result.revision, restorePostingId: data.postingId },
        cachePaths: result.cachePaths, eventIds: result.eventIds, hints: result.hints, oldValue: result.before, newValue: result.after };
    } catch (error) {
      throw new JournalReversalRefusal(error instanceof Error ? error.message : "Распределение изменилось");
    }
  },
});
