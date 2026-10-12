import { createHash, randomUUID } from "node:crypto";
import type { FinanceDocument, Prisma } from "@prisma/client";
import { FINANCE_ROLES, hasAnyRole } from "@/lib/roles";
import { uploadSizeLimitError, uploadSizeLimitFor } from "@/server/files/upload-limits";
import { UploadError, type UploadPhase } from "@/server/files/upload-result";
import type { FileContentSource } from "@/server/files/document-storage";
import { financeDocumentUploadSchema, financeDocumentListSchema, type FinanceDocumentView } from "./contracts";

export type FinanceDocumentTransaction = <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
export type FinanceDocumentStorage = {
  mode(): "local" | "s3";
  put(document: FinanceDocument, bytes: FinanceDocumentUploadInput["bytes"]): Promise<void>;
  open(document: FinanceDocument): Promise<ReadableStream<Uint8Array> | null>;
};
export type FinanceDocumentUploadInput = {
  clientMutationId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer | FileContentSource;
};

export async function requireFinanceDocumentActor(actorId: string | null | undefined, db: Pick<Prisma.TransactionClient, "user">) {
  if (!actorId) throw new UploadError("FINANCE_AUTH_REQUIRED", 401, "auth", "Не авторизован");
  const actor = await db.user.findUnique({ where: { id: actorId }, select: { id: true, name: true, active: true, roles: true } });
  if (!actor?.active || !hasAnyRole(actor.roles, FINANCE_ROLES))
    throw new UploadError("FINANCE_DOCUMENT_FORBIDDEN", 403, "auth", "Недостаточно прав для финансовых документов", "forbidden");
  return actor;
}

export function financeDocumentView(row: FinanceDocument, paymentId: string | null = null): FinanceDocumentView {
  return { id: row.id, source: "finance", fileName: row.fileName, mimeType: row.mimeType,
    size: row.size, createdAt: row.createdAt.toISOString(), paymentId };
}

async function lockUpload(tx: Prisma.TransactionClient, mutationId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18438, hashtext(${mutationId}))`;
}

export function createFinanceDocumentService({ transaction, storage }: {
  transaction: FinanceDocumentTransaction;
  storage: FinanceDocumentStorage;
}) {
  return {
    async upload(actorId: string, input: FinanceDocumentUploadInput,
      options: { source?: "web" | "telegram"; onPhase?: (phase: UploadPhase) => void } = {}) {
      options.onPhase?.("auth");
      await transaction(tx => requireFinanceDocumentActor(actorId, tx));
      const parsed = financeDocumentUploadSchema.safeParse({ clientMutationId: input.clientMutationId,
        fileName: input.fileName, mimeType: input.mimeType });
      const content = input.bytes, buffered = Buffer.isBuffer(content);
      const size = buffered ? content.length : content?.size;
      if (!parsed.success || !Number.isSafeInteger(size) || size <= 0 || (!buffered &&
        (typeof content?.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(content.contentHash) || typeof content?.openRead !== "function")))
        throw new UploadError("FINANCE_DOCUMENT_INVALID", 422, "validation", "Выберите непустой файл с корректными реквизитами", "validation");
      const data = parsed.data;
      const limit = uploadSizeLimitFor(data);
      if (size > limit.maxBytes) throw new UploadError("FINANCE_DOCUMENT_TOO_LARGE", 413, "validation", uploadSizeLimitError(limit.kind), "validation");
      const contentHash = buffered ? createHash("sha256").update(content).digest("hex") : content.contentHash;
      const requestFingerprint = createHash("sha256").update(JSON.stringify({ actorId, ...data, size, contentHash })).digest("hex");
      options.onPhase?.("persist");
      const reserved = await transaction(async tx => {
        await requireFinanceDocumentActor(actorId, tx);
        await lockUpload(tx, data.clientMutationId);
        const previous = await tx.financeDocument.findUnique({ where: { clientMutationId: data.clientMutationId }, include: { payment: { select: { id: true } } } });
        if (previous) {
          if (previous.uploadedById !== actorId || previous.requestFingerprint !== requestFingerprint)
            throw new UploadError("FINANCE_DOCUMENT_CONFLICT", 409, "persist", "Идентификатор загрузки уже использован с другими данными", "conflict");
          return { document: previous, paymentId: previous.payment?.id ?? null };
        }
        const id = randomUUID();
        const document = await tx.financeDocument.create({ data: { id, ...data, size, contentHash,
          requestFingerprint, uploadedById: actorId, state: "PENDING", storageMode: storage.mode(),
          storageKey: `finance-documents/${id}/${contentHash}` } });
        return { document, paymentId: null };
      });
      if (reserved.document.state === "READY") return { document: financeDocumentView(reserved.document, reserved.paymentId), repeated: true };
      options.onPhase?.("storage-original");
      await storage.put(reserved.document, input.bytes);
      options.onPhase?.("persist");
      return transaction(async tx => {
        const actor = await requireFinanceDocumentActor(actorId, tx);
        await lockUpload(tx, data.clientMutationId);
        const row = await tx.financeDocument.findUnique({ where: { id: reserved.document.id }, include: { payment: { select: { id: true } } } });
        if (!row || row.requestFingerprint !== requestFingerprint)
          throw new UploadError("FINANCE_DOCUMENT_CONFLICT", 409, "persist", "Документ изменился — повторите загрузку", "conflict");
        if (row.state === "READY") return { document: financeDocumentView(row, row.payment?.id ?? null), repeated: true };
        const ready = await tx.financeDocument.update({ where: { id: row.id }, data: { state: "READY", readyAt: new Date() } });
        await tx.changeLog.create({ data: { id: `finance-document:${row.id}`, actorType: "user", actorId,
          actorName: actor.name, source: options.source ?? "web", entity: "financeDocument", entityId: row.id,
          action: "create", newValue: { fileName: row.fileName, mimeType: row.mimeType, size: row.size, contentHash } } });
        return { document: financeDocumentView(ready), repeated: false };
      });
    },

    async read(actorId: string, id: string) {
      const document = await transaction(async tx => {
        await requireFinanceDocumentActor(actorId, tx);
        const row = await tx.financeDocument.findUnique({ where: { id }, include: { payment: { select: { id: true } } } });
        if (!row || row.state !== "READY" || (row.uploadedById !== actorId && !row.payment)) return null;
        return row;
      });
      if (!document) return null;
      const body = await storage.open(document);
      return body ? { document: financeDocumentView(document, document.payment?.id ?? null), body } : null;
    },

    async list(actorId: string, input: unknown = {}) {
      const query = financeDocumentListSchema.parse(input);
      return transaction(async tx => {
        await requireFinanceDocumentActor(actorId, tx);
        const where: Prisma.FinanceDocumentWhereInput = { state: "READY",
          OR: [{ uploadedById: actorId }, { payment: { isNot: null } }],
          ...(query.query ? { fileName: { contains: query.query, mode: "insensitive" } } : {}) };
        const total = await tx.financeDocument.count({ where });
        const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
        const rows = await tx.financeDocument.findMany({ where, include: { payment: { select: { id: true } } },
          orderBy: [{ [query.sort]: query.direction }, { id: "asc" }], take: query.pageSize, skip: (page - 1) * query.pageSize });
        return { rows: rows.map(row => financeDocumentView(row, row.payment?.id ?? null)), total, query: { ...query, page } };
      });
    },
  };
}
