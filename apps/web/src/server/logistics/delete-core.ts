import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { canDeleteLogisticsTrip } from "@/lib/logistics-access";
import { UploadError } from "@/server/files/upload-result";
import { lockLogisticsMutation, lockLogisticsTrip, requireLogisticsActor, type LogisticsTransaction } from "./core";
import { logisticsTripDeleteSchema, type LogisticsTripDeleteResult } from "./delete-contracts";

const deletionInclude = { shares: true, lines: true, documents: { select: { id: true } }, postings: { include: { allocations: true } } } satisfies Prisma.LogisticsTripInclude;
type DeletionTrip = Prisma.LogisticsTripGetPayload<{ include: typeof deletionInclude }>;
const projectIds = (trip: DeletionTrip) => [...new Set([...trip.shares.map(row => row.projectId),
  ...trip.postings.flatMap(posting => posting.allocations.map(row => row.projectId))])];
function conflict(message: string): never {
  throw new UploadError("LOGISTICS_REVISION_CONFLICT", 409, "persist", message, "conflict");
}
async function requireAdministrator(actorId: string | null | undefined, tx: Prisma.TransactionClient) {
  const actor = await requireLogisticsActor(actorId, tx);
  if (!canDeleteLogisticsTrip(actor.roles))
    throw new UploadError("LOGISTICS_DELETE_FORBIDDEN", 403, "auth", "Удалять рейсы может только администратор", "forbidden");
  return actor;
}

/** transaction обязан брать общий денежный lock; затем mutation и trip, как у остальных денежных writers. */
export async function deleteLogisticsTripCore(actorId: string | null | undefined, input: unknown, transaction: LogisticsTransaction):
  Promise<LogisticsTripDeleteResult & { projectIds: string[]; eventId: string | null }> {
  const parsed = logisticsTripDeleteSchema.safeParse(input);
  if (!parsed.success) throw new UploadError("LOGISTICS_INPUT_INVALID", 422, "validation", "Проверьте идентификатор и ревизию рейса", "validation");
  const data = parsed.data;
  const fingerprint = createHash("sha256").update(JSON.stringify({ actorId, operation: "delete", ...data })).digest("hex");
  return transaction(async tx => {
    await requireAdministrator(actorId, tx);
    await lockLogisticsMutation(tx, data.clientMutationId);
    await lockLogisticsTrip(tx, data.tripId);
    const actor = await requireAdministrator(actorId, tx);
    const receipt = await tx.logisticsMutation.findUnique({ where: { clientMutationId: data.clientMutationId } });
    if (receipt && (receipt.actorId !== actor.id || receipt.operation !== "delete" || receipt.requestFingerprint !== fingerprint))
      conflict("Идентификатор удаления уже использован с другими данными");
    const trip = await tx.logisticsTrip.findUnique({ where: { id: data.tripId }, include: deletionInclude });
    if (!trip) throw new UploadError("LOGISTICS_TRIP_NOT_FOUND", 404, "context", "Рейс не найден");
    if (receipt) {
      if (!trip.deletedAt || receipt.tripId !== trip.id || receipt.revision !== trip.revision)
        conflict("Состояние удалённого рейса изменилось");
      return { tripId: trip.id, revision: receipt.revision, deletedAt: trip.deletedAt.toISOString(), repeated: true,
        projectIds: projectIds(trip), eventId: null };
    }
    if (trip.deletedAt || trip.revision !== data.expectedRevision)
      conflict("Рейс уже изменён или удалён. Откройте актуальную запись");
    const deletedAt = new Date(), revision = trip.revision + 1;
    const changed = await tx.logisticsTrip.updateMany({ where: { id: trip.id, revision: data.expectedRevision, deletedAt: null },
      data: { deletedAt, deletedById: actor.id, updatedById: actor.id, revision } });
    if (changed.count !== 1) conflict("Рейс уже изменён. Откройте актуальную запись");
    await tx.logisticsMutation.create({ data: { clientMutationId: data.clientMutationId, actorId: actor.id, tripId: trip.id,
      operation: "delete", requestFingerprint: fingerprint, revision } });
    const affected = projectIds(trip), current = trip.postings.find(row => row.status === "ACTIVE");
    await tx.changeLog.create({ data: { id: `logistics-delete:${data.clientMutationId}`, actorType: "user", actorId: actor.id,
      actorName: actor.name, source: "web", entity: "logisticsTrip", entityId: trip.id, action: "soft-delete",
      oldValue: { date: trip.date.toISOString().slice(0, 10), revision: trip.revision, projectIds: affected,
        lineIds: trip.lines.map(row => row.id), documentIds: trip.documents.map(row => row.id),
        postingId: current?.id ?? null, amount: current?.amount.toFixed(2) ?? null, currency: current?.currency ?? null,
        bynAmount: current?.bynAmount.toFixed(2) ?? null, cashAccountId: current?.cashAccountId ?? null },
      newValue: { deletedAt: deletedAt.toISOString(), deletedById: actor.id, revision } } });
    const event = await tx.domainEvent.create({ data: { type: "logistics.trip.deleted", actor: actor.id,
      payload: { tripId: trip.id, revision, projectIds: affected, postingId: current?.id ?? null } } });
    return { tripId: trip.id, revision, deletedAt: deletedAt.toISOString(), repeated: false, projectIds: affected, eventId: event.id };
  });
}
