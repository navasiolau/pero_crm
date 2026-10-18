import type { Prisma } from "@prisma/client";

/** Блокировка общая с mutation coordinator; MAX включает скрытые проекты. */
export async function allocateProjectNumberInTransaction(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
  const max = await tx.project.aggregate({ _max: { numberInt: true } });
  const numberInt = (max._max.numberInt ?? 0) + 1;
  if (!Number.isSafeInteger(numberInt) || numberInt < 1 || numberInt > 2_147_483_647)
    throw new Error("Исчерпан диапазон номеров проектов");
  return { numberInt, number: String(numberInt) };
}
