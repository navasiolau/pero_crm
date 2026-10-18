import type { Prisma } from "@prisma/client";
import { applyProposalStageGate } from "./lifecycle";
import { createPrismaLifecycleStore } from "./lifecycle-store";

/** Caller уже держит общий KP mutex и Project FOR UPDATE; флаг UI не отменяет принятие документа. */
export function applyProposalStageGateInTransaction(tx: Prisma.TransactionClient, input: Parameters<typeof applyProposalStageGate>[1]) {
  return applyProposalStageGate(createPrismaLifecycleStore(tx), input);
}
