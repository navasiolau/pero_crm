import type { Prisma } from "@prisma/client";
import { canManageLogistics } from "@/lib/logistics-access";
import { productDraftVisibilityWhere } from "@/server/access/visibility";
import { logisticsTripListSchema, type LogisticsTripDocumentsView, type LogisticsTripView } from "./contracts";
import { requireLogisticsActor, type LogisticsTransaction } from "./core";
import { logisticsDocumentView } from "./documents";

export const logisticsTripReadInclude = {
  shares: { include: { project: { select: { id: true, number: true, title: true } } }, orderBy: { projectId: "asc" } },
  lines: { orderBy: { id: "asc" } },
  documents: { where: { state: "READY" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.LogisticsTripInclude;
type TripReadRecord = Prisma.LogisticsTripGetPayload<{ include: typeof logisticsTripReadInclude }>;
export function logisticsTripView(row: TripReadRecord): LogisticsTripView {
  return { mode: "manage", id: row.id, date: row.date.toISOString().slice(0, 10), comment: row.comment, revision: row.revision,
    shares: row.shares.map(share => ({ id: share.id, projectId: share.projectId, projectNumber: share.project.number,
      projectTitle: share.project.title, percentBps: share.percentBps })),
    lines: row.lines.map(line => ({ id: line.id, projectId: line.projectId, kind: line.kind, productId: line.productId,
      materialId: line.materialId, nameSnapshot: line.nameSnapshot, numberSnapshot: line.numberSnapshot,
      unitSnapshot: line.unitSnapshot, quantity: line.quantity.toNumber() })),
    documents: row.documents.map(logisticsDocumentView) };
}
const documentsSelect = { id: true, date: true,
  shares: { select: { project: { select: { id: true, number: true } } }, orderBy: { projectId: "asc" } },
  documents: { where: { state: "READY" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.LogisticsTripSelect;
type DocumentsReadRecord = Prisma.LogisticsTripGetPayload<{ select: typeof documentsSelect }>;
function documentsView(row: DocumentsReadRecord): LogisticsTripDocumentsView {
  return { mode: "documents", id: row.id, date: row.date.toISOString().slice(0, 10),
    projects: row.shares.map(share => share.project), documents: row.documents.map(logisticsDocumentView) };
}

export async function getLogisticsTripCore(actorId: string | null | undefined, id: string, transaction: LogisticsTransaction) {
  return transaction(async tx => {
    const actor = await requireLogisticsActor(actorId, tx, "documents");
    if (canManageLogistics(actor.roles)) {
      const row = await tx.logisticsTrip.findUnique({ where: { id }, include: logisticsTripReadInclude });
      return row ? logisticsTripView(row) : null;
    }
    const row = await tx.logisticsTrip.findUnique({ where: { id }, select: documentsSelect });
    return row ? documentsView(row) : null;
  });
}

export async function listLogisticsTripsCore(actorId: string | null | undefined, input: unknown,
  transaction: LogisticsTransaction, requiredMode: "manage" | "documents" = "documents") {
  return transaction(async tx => {
    const actor = await requireLogisticsActor(actorId, tx, requiredMode);
    const query = logisticsTripListSchema.parse(input ?? {}), manage = canManageLogistics(actor.roles);
    const search: Prisma.LogisticsTripWhereInput[] = [
      { id: { contains: query.query, mode: "insensitive" } },
      { shares: { some: { project: { number: { contains: query.query, mode: "insensitive" } } } } },
      { documents: { some: { state: "READY", OR: [
        { ttnNumber: { contains: query.query, mode: "insensitive" } }, { fileName: { contains: query.query, mode: "insensitive" } },
      ] } } },
    ];
    if (manage) search.push({ comment: { contains: query.query, mode: "insensitive" } },
      { lines: { some: { nameSnapshot: { contains: query.query, mode: "insensitive" } } } },
      { shares: { some: { project: { title: { contains: query.query, mode: "insensitive" } } } } });
    const where: Prisma.LogisticsTripWhereInput = {
      ...(query.query ? { OR: search } : {}),
      ...(query.projectId ? { shares: { some: { projectId: query.projectId } } } : {}),
      ...((query.dateFrom || query.dateTo) ? { date: {
        ...(query.dateFrom ? { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) } : {}),
        ...(query.dateTo ? { lte: new Date(`${query.dateTo}T00:00:00.000Z`) } : {}),
      } } : {}),
    };
    const total = await tx.logisticsTrip.count({ where });
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const paging = { where, orderBy: [{ date: query.direction }, { id: "asc" as const }], take: query.pageSize, skip: (page - 1) * query.pageSize };
    if (manage) return { mode: "manage" as const,
      rows: (await tx.logisticsTrip.findMany({ ...paging, include: logisticsTripReadInclude })).map(logisticsTripView), total, query: { ...query, page } };
    return { mode: "documents" as const,
      rows: (await tx.logisticsTrip.findMany({ ...paging, select: documentsSelect })).map(documentsView), total, query: { ...query, page } };
  });
}

export async function getLogisticsOptionsCore(actorId: string | null | undefined, transaction: LogisticsTransaction) {
  return transaction(async tx => {
    const actor = await requireLogisticsActor(actorId, tx);
    const [projects, materials] = await Promise.all([
      tx.project.findMany({ where: { deletedAt: null }, select: { id: true, number: true, title: true,
        products: { where: { deletedAt: null, AND: [productDraftVisibilityWhere(actor)] }, select: { id: true, number: true, title: true, quantity: true }, orderBy: [{ suffixInt: "asc" }, { id: "asc" }] } },
        orderBy: [{ numberInt: "desc" }, { id: "asc" }] }),
      tx.material.findMany({ where: { active: true }, select: { id: true, name: true, measurementUnit: { select: { name: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    ]);
    return { projects, materials: materials.map(row => ({ id: row.id, name: row.name, unit: row.measurementUnit.name })) };
  });
}
