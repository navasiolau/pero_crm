import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type TaskTransaction = <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

/** All task graph/allocation writers use one short lock; never call server
 * actions or external effects from the callback (they run after commit). */
export function createTaskTransaction(database: Pick<PrismaClient, "$transaction">): TaskTransaction {
  return (operation) => database.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
    return operation(tx);
  }, { maxWait: 5_000, timeout: 15_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export const withTaskTransaction = createTaskTransaction(prisma);
