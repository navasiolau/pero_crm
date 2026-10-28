import { createHash, randomUUID } from "node:crypto";
import type { LogisticsDocument, Prisma } from "@prisma/client";
import { uploadSizeLimitError, uploadSizeLimitFor } from "@/server/files/upload-limits";
import { UploadError, type UploadPhase } from "@/server/files/upload-result";
import type { FileContentSource } from "@/server/files/document-storage";
import { logisticsDocumentUploadSchema, type LogisticsDocumentView } from "./contracts";
import { lockLogisticsTrip, requireLiveLogisticsTrip, requireLogisticsActor, type LogisticsTransaction } from "./core";

export type LogisticsDocumentStorage = {
  mode(): "local" | "s3";
  put(document: LogisticsDocument, bytes: LogisticsDocumentUploadInput["bytes"]): Promise<void>;
  open(document: LogisticsDocument): Promise<ReadableStream<Uint8Array> | null>;
};
export type LogisticsDocumentUploadInput = {
  tripId: string; clientMutationId: string; stage: "ISSUED" | "SIGNED"; ttnNumber?: string | null;
  fileName: string; mimeType: string; bytes: Buffer | FileContentSource;
};
export function logisticsDocumentView(row: LogisticsDocument): LogisticsDocumentView {
  return { id: row.id, tripId: row.tripId, source: "logistics", fileName: row.fileName, mimeType: row.mimeType,
    size: row.size, stage: row.stage, ttnNumber: row.ttnNumber, createdAt: row.createdAt.toISOString() };
}
async function lockUpload(tx: Prisma.TransactionClient, clientMutationId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18443, hashtext(${clientMutationId}))`;
}
async function requireTrip(tx: Prisma.TransactionClient, tripId: string) {
  return requireLiveLogisticsTrip(tx, tripId);
}

/** Документы добавляются неизменяемыми: ни удаление, ни перезапись оригинала не опубликованы. */
export function createLogisticsDocumentService({ transaction, storage }: {
  transaction: LogisticsTransaction; storage: LogisticsDocumentStorage;
}) {
  return {
    async upload(actorId: string, input: LogisticsDocumentUploadInput, options: { onPhase?: (phase: UploadPhase) => void } = {}) {
      options.onPhase?.("auth");
      await transaction(tx => requireLogisticsActor(actorId, tx));
      const parsed = logisticsDocumentUploadSchema.safeParse({ tripId: input.tripId, clientMutationId: input.clientMutationId,
        stage: input.stage, ttnNumber: input.ttnNumber, fileName: input.fileName, mimeType: input.mimeType });
      const content = input.bytes, buffered = Buffer.isBuffer(content);
      const size = buffered ? content.length : content?.size;
      if (!parsed.success || !Number.isSafeInteger(size) || size <= 0 || (!buffered &&
        (typeof content?.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(content.contentHash) || typeof content?.openRead !== "function")))
        throw new UploadError("LOGISTICS_DOCUMENT_INVALID", 422, "validation", parsed.error?.issues[0]?.message ?? "Выберите непустой файл ТТН", "validation");
      const data = parsed.data;
      const limit = uploadSizeLimitFor(data);
      if (size > limit.maxBytes) throw new UploadError("LOGISTICS_DOCUMENT_TOO_LARGE", 413, "validation", uploadSizeLimitError(limit.kind), "validation");
      const contentHash = buffered ? createHash("sha256").update(content).digest("hex") : content.contentHash;
      const requestFingerprint = createHash("sha256").update(JSON.stringify({ actorId, ...data, size, contentHash })).digest("hex");
      options.onPhase?.("persist");
      const reserved = await transaction(async tx => {
        await requireLogisticsActor(actorId, tx);
        await lockUpload(tx, data.clientMutationId);
        await lockLogisticsTrip(tx, data.tripId);
        await requireTrip(tx, data.tripId);
        const previous = await tx.logisticsDocument.findUnique({ where: { clientMutationId: data.clientMutationId } });
        if (previous) {
          if (previous.uploadedById !== actorId || previous.requestFingerprint !== requestFingerprint)
            throw new UploadError("LOGISTICS_DOCUMENT_CONFLICT", 409, "persist", "Идентификатор загрузки уже использован с другими данными", "conflict");
          return previous;
        }
        const id = randomUUID();
        return tx.logisticsDocument.create({ data: { id, ...data, size, contentHash, requestFingerprint,
          uploadedById: actorId, state: "PENDING", storageMode: storage.mode(), storageKey: `logistics-documents/${id}/${contentHash}` } });
      });
      if (reserved.state === "READY") return { document: logisticsDocumentView(reserved), repeated: true };
      options.onPhase?.("storage-original");
      await storage.put(reserved, input.bytes);
      options.onPhase?.("persist");
      return transaction(async tx => {
        const actor = await requireLogisticsActor(actorId, tx);
        await lockUpload(tx, data.clientMutationId);
        await lockLogisticsTrip(tx, data.tripId);
        await requireTrip(tx, data.tripId);
        const row = await tx.logisticsDocument.findUnique({ where: { id: reserved.id } });
        if (!row || row.requestFingerprint !== requestFingerprint)
          throw new UploadError("LOGISTICS_DOCUMENT_CONFLICT", 409, "persist", "Документ изменился — повторите загрузку", "conflict");
        if (row.state === "READY") return { document: logisticsDocumentView(row), repeated: true };
        const ready = await tx.logisticsDocument.update({ where: { id: row.id }, data: { state: "READY", readyAt: new Date() } });
        await tx.changeLog.create({ data: { id: `logistics-document:${row.id}`, actorType: "user", actorId,
          actorName: actor.name, entity: "logisticsDocument", entityId: row.id, action: "create",
          newValue: { tripId: row.tripId, stage: row.stage, ttnNumber: row.ttnNumber, fileName: row.fileName,
            mimeType: row.mimeType, size: row.size, contentHash } } });
        // Загрузка второй печати не изменяет ни состав, ни revision, ни деньги.
        return { document: logisticsDocumentView(ready), repeated: false };
      });
    },

    async read(actorId: string, id: string) {
      const document = await transaction(async tx => {
        await requireLogisticsActor(actorId, tx, "documents");
        return tx.logisticsDocument.findFirst({ where: { id, state: "READY", trip: { deletedAt: null } } });
      });
      if (!document) return null;
      const body = await storage.open(document);
      return body ? { document: logisticsDocumentView(document), body } : null;
    },

    async list(actorId: string, tripId: string) {
      return transaction(async tx => {
        await requireLogisticsActor(actorId, tx, "documents");
        await requireTrip(tx, tripId);
        return (await tx.logisticsDocument.findMany({ where: { tripId, state: "READY" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map(logisticsDocumentView);
      });
    },
  };
}
