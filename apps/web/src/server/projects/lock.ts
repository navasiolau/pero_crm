import type { Prisma } from "@prisma/client";

/** Создание изделия и переходы проекта читают этап под одной блокировкой. */
export async function lockProjectRow(tx: Prisma.TransactionClient, projectId: string) {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
}