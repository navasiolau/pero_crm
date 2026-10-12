import {Prisma, type PrismaClient} from "@prisma/client";
import {prisma} from "@/lib/prisma";

export type MutationTransaction = <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

/** Общий денежный/task lock: внешние эффекты выполняются после подтверждённого commit. */
export function createMutationTransaction(database: Pick<PrismaClient, "$transaction">): MutationTransaction {
  return operation => database.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
    return operation(tx);
  }, {maxWait: 5_000, timeout: 15_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted});
}

export const withMutationTransaction = createMutationTransaction(prisma);
