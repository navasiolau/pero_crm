import type { Prisma } from "@prisma/client";
import { applyProposalStageGate } from "./lifecycle";
import { createPrismaLifecycleStore } from "./lifecycle-store";
import type {DomainActor} from '@/server/actor';

/** Caller уже держит общий KP mutex и Project FOR UPDATE; флаг UI не отменяет принятие документа. */
export function applyProposalStageGateInTransaction(tx: Prisma.TransactionClient, input: Parameters<typeof applyProposalStageGate>[1], actor?:DomainActor, operationRootId?: string) {
  return applyProposalStageGate(createPrismaLifecycleStore(tx,undefined,actor,operationRootId), input);
}
