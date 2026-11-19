import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";

export const proposalExportRequestReversal = defineJournalReversal({
  kind: "proposal.export.request",
  version: 1,
  schema: z.object({
    jobId: z.string().min(1),
    ownerId: z.string().min(1),
    kind: z.enum(["PDF", "CONTRACT"]),
    cancel: z.boolean(),
  }).strict(),
  async preview({ tx }, data) {
    const job = await tx.proposalJob.findFirst({
      where: { id: data.jobId, kind: data.kind, attempts: 0, leaseOwner: null,
        ...(data.kind === "PDF" ? { proposalId: data.ownerId } : { contractId: data.ownerId }),
        ...(data.cancel ? { state: "PENDING", lastErrorCode: null } :
          { state: "CANCELLED", lastErrorCode: "KP_CANCELLED_FROM_JOURNAL" }) },
      select: { id: true },
    });
    return job ? null : "Выпуск уже начат, завершён или изменён";
  },
  async apply({ tx }, data) {
    await tx.$queryRaw`SELECT id FROM "ProposalJob" WHERE id=${data.jobId} FOR UPDATE`;
    const active = data.cancel ? "PENDING" : "CANCELLED";
    const next = data.cancel ? "CANCELLED" : "PENDING";
    const changed = await tx.proposalJob.updateMany({
      where: { id: data.jobId, kind: data.kind, attempts: 0, leaseOwner: null,
        ...(data.kind === "PDF" ? { proposalId: data.ownerId } : { contractId: data.ownerId }),
        state: active, lastErrorCode: data.cancel ? null : "KP_CANCELLED_FROM_JOURNAL" },
      data: { state: next, lastErrorCode: data.cancel ? "KP_CANCELLED_FROM_JOURNAL" : null },
    });
    if (changed.count !== 1) throw new JournalReversalRefusal("Выпуск уже начат, завершён или изменён");
    return { inverse: { ...data, cancel: !data.cancel }, oldValue: { state: active }, newValue: { state: next },
      cachePaths: ["/kp"] };
  },
});

