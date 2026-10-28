import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { canManageLogistics, canReadLogisticsDocuments } from "@/lib/logistics-access";
import { UploadError } from "@/server/files/upload-result";
import { productDraftVisibilityWhere, type VisibilityActor } from "@/server/access/visibility";
import { logisticsTripCreateSchema, logisticsTripUpdateSchema, shipmentLineKey,
  type LogisticsTripManifestInput, type LogisticsTripMutationResult } from "./contracts";
import { logisticsTripWritePolicy } from "./policy";

export type LogisticsTransaction = <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

export async function requireLogisticsActor(actorId: string | null | undefined,
  db: Pick<Prisma.TransactionClient, "user">, mode: "manage" | "documents" = "manage") {
  if (!actorId) throw new UploadError("LOGISTICS_AUTH_REQUIRED", 401, "auth", "Не авторизован");
  const actor = await db.user.findUnique({ where: { id: actorId }, select: { id: true, name: true, active: true, roles: true } });
  if (!actor?.active || !(mode === "manage" ? canManageLogistics(actor.roles) : canReadLogisticsDocuments(actor.roles)))
    throw new UploadError("LOGISTICS_FORBIDDEN", 403, "auth", "Недостаточно прав для логистики", "forbidden");
  return actor;
}

export async function lockLogisticsTrip(tx: Prisma.TransactionClient, tripId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18441, hashtext(${tripId}))`;
}
export async function lockLogisticsMutation(tx: Prisma.TransactionClient, clientMutationId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18442, hashtext(${clientMutationId}))`;
}
export async function requireLiveLogisticsTrip(tx: Prisma.TransactionClient, tripId: string) {
  const trip = await tx.logisticsTrip.findUnique({ where: { id: tripId }, select: { id: true, deletedAt: true } });
  if (!trip || trip.deletedAt) throw new UploadError("LOGISTICS_TRIP_NOT_FOUND", 404, "context", "Рейс не найден");
  return trip;
}
function invalid(message: string): never {
  throw new UploadError("LOGISTICS_INPUT_INVALID", 422, "validation", message, "validation");
}
function conflict(message = "Рейс уже изменён. Откройте актуальную запись"): never {
  throw new UploadError("LOGISTICS_REVISION_CONFLICT", 409, "persist", message, "conflict");
}
export const logisticsManifestInclude = { shares: true, lines: true } satisfies Prisma.LogisticsTripInclude;
export type LogisticsManifestRecord = Prisma.LogisticsTripGetPayload<{ include: typeof logisticsManifestInclude }>;
export type PreparedLogisticsManifest = LogisticsTripManifestInput & {
  snapshots: { projectId: string; kind: "PRODUCT" | "MATERIAL"; productId: string | null; materialId: string | null;
    nameSnapshot: string; numberSnapshot: string | null; unitSnapshot: string; quantity: number }[];
};

/** Только сервер формирует наименования/единицы; состав не пишет склад или статусы. */
export async function validateTripManifest(tx: Prisma.TransactionClient, data: LogisticsTripManifestInput,
  previous?: LogisticsManifestRecord, actor: VisibilityActor = { id: "", roles: [] }): Promise<PreparedLogisticsManifest> {
  const projectIds = data.shares.map(share => share.projectId);
  const projects = await tx.project.findMany({ where: { id: { in: projectIds }, deletedAt: null }, select: { id: true } });
  if (projects.length !== projectIds.length) invalid("Один из проектов не найден или находится в корзине");
  const productIds = data.lines.flatMap(line => line.kind === "PRODUCT" ? [line.productId] : []);
  const materialIds = data.lines.flatMap(line => line.kind === "MATERIAL" ? [line.materialId] : []);
  const [products, materials] = await Promise.all([
    tx.product.findMany({ where: { id: { in: productIds }, deletedAt: null, project: { deletedAt: null },
      AND: [productDraftVisibilityWhere(actor)] }, select: { id: true, projectId: true, title: true, number: true } }),
    tx.material.findMany({ where: { id: { in: materialIds }, active: true }, select: { id: true, name: true, sku: true, measurementUnit: { select: { name: true } } } }),
  ]);
  const snapshots = data.lines.map(line => {
    const old = previous?.lines.find(row => shipmentLineKey(row) === shipmentLineKey(line));
    if (line.kind === "PRODUCT") {
      const product = products.find(row => row.id === line.productId);
      if (!product || product.projectId !== line.projectId) invalid("Изделие не принадлежит выбранному проекту или находится в корзине");
      return { projectId: line.projectId, kind: line.kind, productId: product.id, materialId: null,
        nameSnapshot: old?.nameSnapshot ?? product.title, numberSnapshot: old?.numberSnapshot ?? product.number,
        unitSnapshot: old?.unitSnapshot ?? "шт", quantity: line.quantity };
    }
    const material = materials.find(row => row.id === line.materialId);
    if (!material) invalid("Материал не найден или отключён");
    return { projectId: line.projectId, kind: line.kind, productId: null, materialId: material.id,
      nameSnapshot: old?.nameSnapshot ?? material.name, numberSnapshot: old ? old.numberSnapshot : material.sku,
      unitSnapshot: old?.unitSnapshot ?? material.measurementUnit.name, quantity: line.quantity };
  });
  return { ...data, snapshots };
}

/** Вызывается №124 только внутри его серверной денежной транзакции и блокировки. */
export async function replaceTripManifestInTransaction(tx: Prisma.TransactionClient, tripId: string,
  data: PreparedLogisticsManifest, previous?: LogisticsManifestRecord) {
  await tx.logisticsShipmentLine.deleteMany({ where: { tripId } });
  await tx.logisticsProjectShare.deleteMany({ where: { tripId, projectId: { notIn: data.shares.map(share => share.projectId) } } });
  for (const share of data.shares) await tx.logisticsProjectShare.upsert({
    where: { tripId_projectId: { tripId, projectId: share.projectId } },
    create: { id: randomUUID(), tripId, ...share }, update: { percentBps: share.percentBps },
  });
  await tx.logisticsShipmentLine.createMany({ data: data.snapshots.map(line => ({
    id: previous?.lines.find(row => shipmentLineKey(row) === shipmentLineKey(line))?.id ?? randomUUID(), tripId, ...line,
  })) });
}

function snapshot(row: LogisticsManifestRecord) {
  return { date: row.date.toISOString().slice(0, 10), comment: row.comment, revision: row.revision,
    shares: row.shares.map(share => ({ projectId: share.projectId, percentBps: share.percentBps })),
    lines: row.lines.map(line => ({ projectId: line.projectId, kind: line.kind, productId: line.productId,
      materialId: line.materialId, nameSnapshot: line.nameSnapshot, numberSnapshot: line.numberSnapshot,
      unitSnapshot: line.unitSnapshot, quantity: line.quantity.toNumber() })) };
}

async function mutationReceipt(tx: Prisma.TransactionClient, actorId: string, clientMutationId: string, fingerprint: string) {
  const receipt = await tx.logisticsMutation.findUnique({ where: { clientMutationId } });
  if (!receipt) return null;
  if (receipt.actorId !== actorId || receipt.requestFingerprint !== fingerprint)
    conflict("Идентификатор изменения уже использован с другими данными");
  return { tripId: receipt.tripId, revision: receipt.revision, repeated: true };
}

async function auditMutation(tx: Prisma.TransactionClient, actor: { id: string; name: string }, clientMutationId: string,
  operation: "create" | "update", fingerprint: string, row: LogisticsManifestRecord, previous?: LogisticsManifestRecord) {
  await tx.logisticsMutation.create({ data: { clientMutationId, actorId: actor.id, tripId: row.id,
    requestFingerprint: fingerprint, operation, revision: row.revision } });
  await tx.changeLog.create({ data: { id: `logistics-mutation:${clientMutationId}`, actorType: "user", actorId: actor.id,
    actorName: actor.name, entity: "logisticsTrip", entityId: row.id, action: operation,
    ...(previous ? { oldValue: snapshot(previous) } : {}), newValue: snapshot(row) } });
  await tx.domainEvent.create({ data: { type: `logistics.trip.${operation === "create" ? "created" : "updated"}`, actor: actor.id,
    payload: { tripId: row.id, revision: row.revision, projectIds: row.shares.map(share => share.projectId) } } });
}

export async function createLogisticsTripCore(actorId: string | null | undefined, input: unknown,
  transaction: LogisticsTransaction): Promise<LogisticsTripMutationResult> {
  const parsed = logisticsTripCreateSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? "Проверьте состав отгрузки");
  const data = parsed.data;
  const fingerprint = createHash("sha256").update(JSON.stringify({ actorId, operation: "create", ...data })).digest("hex");
  return transaction(async tx => {
    const actor = await requireLogisticsActor(actorId, tx);
    await lockLogisticsMutation(tx, data.clientMutationId);
    const receipt = await mutationReceipt(tx, actor.id, data.clientMutationId, fingerprint);
    if (receipt) return receipt;
    const prepared = await validateTripManifest(tx, data, undefined, actor);
    const tripId = randomUUID();
    await tx.logisticsTrip.create({ data: { id: tripId, date: new Date(`${data.date}T00:00:00.000Z`),
      comment: data.comment, createdById: actor.id, updatedById: actor.id } });
    await replaceTripManifestInTransaction(tx, tripId, prepared);
    const row = await tx.logisticsTrip.findUniqueOrThrow({ where: { id: tripId }, include: logisticsManifestInclude });
    await auditMutation(tx, actor, data.clientMutationId, "create", fingerprint, row);
    return { tripId, revision: row.revision, repeated: false };
  });
}

export async function updateLogisticsTripCore(actorId: string | null | undefined, input: unknown,
  transaction: LogisticsTransaction): Promise<LogisticsTripMutationResult> {
  const parsed = logisticsTripUpdateSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? "Проверьте состав отгрузки");
  const data = parsed.data;
  const fingerprint = createHash("sha256").update(JSON.stringify({ actorId, operation: "update", ...data })).digest("hex");
  return transaction(async tx => {
    const actor = await requireLogisticsActor(actorId, tx);
    await lockLogisticsMutation(tx, data.clientMutationId);
    const receipt = await mutationReceipt(tx, actor.id, data.clientMutationId, fingerprint);
    if (receipt) return receipt;
    await lockLogisticsTrip(tx, data.tripId);
    const previous = await tx.logisticsTrip.findUnique({ where: { id: data.tripId }, include: logisticsManifestInclude });
    if (!previous || previous.deletedAt) throw new UploadError("LOGISTICS_TRIP_NOT_FOUND", 404, "context", "Рейс не найден");
    if (previous.revision !== data.expectedRevision) conflict();
    await logisticsTripWritePolicy.beforeManifestUpdate(tx, data.tripId);
    const prepared = await validateTripManifest(tx, data, previous, actor);
    const changed = await tx.logisticsTrip.updateMany({ where: { id: data.tripId, revision: data.expectedRevision, deletedAt: null },
      data: { date: new Date(`${data.date}T00:00:00.000Z`), comment: data.comment, updatedById: actor.id, revision: { increment: 1 } } });
    if (changed.count !== 1) conflict();
    await replaceTripManifestInTransaction(tx, data.tripId, prepared, previous);
    const row = await tx.logisticsTrip.findUniqueOrThrow({ where: { id: data.tripId }, include: logisticsManifestInclude });
    await auditMutation(tx, actor, data.clientMutationId, "update", fingerprint, row, previous);
    return { tripId: row.id, revision: row.revision, repeated: false };
  });
}
