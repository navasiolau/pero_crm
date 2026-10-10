import type { Prisma } from "@prisma/client";

/** Серверная точка расширения №124: проведённый рейс меняется только вместе с деньгами.
 * Политика вызывается внутри блокировки рейса; клиент не передаёт флаг обхода.
 * До появления финансовых проведений все рейсы являются непроведёнными. */
export const logisticsTripWritePolicy: {
  beforeManifestUpdate(tx: Prisma.TransactionClient, tripId: string): Promise<void>;
} = { async beforeManifestUpdate() { return; } };
