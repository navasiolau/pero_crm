import type { Prisma } from "@prisma/client";
import { UploadError } from "@/server/files/upload-result";

/** Серверная точка расширения №124: проведённый рейс меняется только вместе с деньгами.
 * Политика вызывается внутри блокировки рейса; клиент не передаёт флаг обхода.
 * До появления финансовых проведений все рейсы являются непроведёнными. */
export const logisticsTripWritePolicy: {
  beforeManifestUpdate(tx: Prisma.TransactionClient, tripId: string): Promise<void>;
} = { async beforeManifestUpdate(tx, tripId) {
  if (await tx.logisticsPosting.findFirst({ where: { tripId, status: "ACTIVE" }, select: { id: true } }))
    throw new UploadError("LOGISTICS_POSTED_TRIP", 409, "persist", "Рейс оплачен. Сохраните изменения вместе с исправлением расхода в логистике", "conflict");
} };
