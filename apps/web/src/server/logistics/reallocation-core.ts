import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { hasAnyRole } from "@/lib/roles";
import { assertProjectMoneyCurrency } from "@/lib/internal-currency";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { logisticsManifestInclude, lockLogisticsTrip, replaceTripManifestInTransaction, validateTripManifest } from "./core";
import { logisticsTripManifestSchema, shipmentLineKey } from "./contracts";
import { logisticsJournalHints } from "./journal";
import { reallocateLogisticsMoney } from "./reallocation-money";
import {
  normalizeShipmentLine, reallocationInputSchema, reallocationReversalKind,
  type ReallocationInput, type ReallocationVersion,
} from "./reallocation-contract";

export const LOGISTICS_REALLOCATION_ROLES = ["ADMIN", "DIRECTOR", "ACCOUNTANT"] as const;

export async function requireReallocationActor(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, name: true, active: true, roles: true } });
  if (!actor?.active || !hasAnyRole(actor.roles, [...LOGISTICS_REALLOCATION_ROLES]))
    throw Error("Недостаточно прав для распределения рейса");
  return actor;
}

const include = { allocations: true, documents: true } satisfies Prisma.LogisticsPostingInclude;

export async function loadReallocation(tx: Prisma.TransactionClient, version: ReallocationVersion) {
  const trip = await tx.logisticsTrip.findUnique({ where: { id: version.tripId }, include: logisticsManifestInclude });
  const posting = await tx.logisticsPosting.findUnique({ where: { id: version.postingId }, include });
  if (!trip || trip.deletedAt || posting?.tripId !== trip.id || posting.status !== "ACTIVE" || trip.revision !== version.revision)
    throw Error("Рейс уже изменён. Откройте актуальный расход");
  return { trip, posting };
}

function sorted<T>(items: readonly T[], key: (item: T) => string) {
  return [...items].sort((a, b) => key(a).localeCompare(key(b)));
}

function composition(shares: ReallocationInput["shares"], lines: ReallocationInput["lines"]) {
  return { shares: sorted(shares.map(({ projectId, percentBps }) => ({ projectId, percentBps })), share => share.projectId),
    lines: sorted(lines, shipmentLineKey) };
}

export async function prepareReallocation(tx: Prisma.TransactionClient, actorId: string, input: ReallocationInput) {
  const actor = await requireReallocationActor(tx, actorId);
  const { trip, posting } = await loadReallocation(tx, input);
  const manifest = logisticsTripManifestSchema.parse({
    date: trip.date.toISOString().slice(0, 10), comment: trip.comment, ttnNotRequired: posting.ttnNotRequired,
    shares: input.shares, lines: input.lines,
  });
  const before = composition(trip.shares, trip.lines.map(line => normalizeShipmentLine({ ...line, quantity: line.quantity.toNumber() })));
  const noOp = JSON.stringify(before) === JSON.stringify(composition(manifest.shares, manifest.lines));
  const projectIds = sorted(manifest.shares, share => share.projectId).map(share => share.projectId);
  const projects = await tx.project.findMany({ where: { id: { in: projectIds }, deletedAt: null },
    select: { id: true, number: true, currency: true } });
  if (projects.length !== projectIds.length) throw Error("Один из проектов не найден или находится в корзине");
  for (const project of projects) assertProjectMoneyCurrency(project.currency);
  const replacement = await validateTripManifest(tx, manifest, trip, actor);
  const split = reallocateLogisticsMoney(posting.amount.toFixed(2), posting.bynAmount.toFixed(2), posting.rate.toFixed(6), manifest.shares);
  return { actor, trip, posting, manifest, replacement, split, projects, noOp };
}

export function reallocationPaths(tripId: string, projectIds: string[]) {
  return ["/logistics", `/logistics/${tripId}`, "/finance/expenses", "/finance/accounts", "/finance/accounts/report", "/changelog",
    ...projectIds.flatMap(id => [`/projects/${id}`, `/finance/projects/${id}`])];
}

export async function redistributeTripInTransaction(
  tx: Prisma.TransactionClient, actorId: string, rawInput: ReallocationInput, reversal = false, source: "web" | "telegram" | "api" = "web",
) {
  const input = reallocationInputSchema.parse(rawInput);
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId} FOR SHARE`;
  await requireReallocationActor(tx, actorId);
  await lockLogisticsTrip(tx, input.tripId);
  const fingerprint = createHash("sha256").update(JSON.stringify({
    actorId, tripId: input.tripId, postingId: input.postingId, revision: input.revision, reversal,
    ...composition(input.shares, input.lines),
  })).digest("hex");
  const receipt = await tx.logisticsPosting.findUnique({ where: { clientMutationId: input.requestId } });
  if (receipt) {
    if (receipt.requestFingerprint !== fingerprint || receipt.actorId !== actorId || receipt.reallocatedFromId !== input.postingId)
      throw Error("Идентификатор распределения уже использован");
    return { postingId: receipt.id, revision: receipt.tripRevision, noOp: false, eventIds: [], cachePaths: [] };
  }
  const lockedProjects = sorted(input.shares, share => share.projectId).map(share => share.projectId);
  const productIds = input.lines.flatMap(line => line.kind === "PRODUCT" ? [line.productId] : []);
  const materialIds = input.lines.flatMap(line => line.kind === "MATERIAL" ? [line.materialId] : []);
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id IN (${Prisma.join(lockedProjects)}) ORDER BY id FOR SHARE`;
  if (productIds.length)
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id IN (${Prisma.join(productIds)}) ORDER BY id FOR SHARE`;
  if (materialIds.length)
    await tx.$queryRaw`SELECT id FROM "Material" WHERE id IN (${Prisma.join(materialIds)}) ORDER BY id FOR SHARE`;
  const { actor, trip, posting, manifest, replacement, split, projects, noOp } = await prepareReallocation(tx, actorId, input);
  if (noOp) return { postingId: posting.id, revision: trip.revision, noOp: true, eventIds: [], cachePaths: [] };
  const revision = trip.revision + 1;
  const changed = await tx.logisticsTrip.updateMany({ where: { id: trip.id, revision: input.revision, deletedAt: null },
    data: { revision, updatedById: actorId } });
  if (changed.count !== 1) throw Error("Рейс уже изменён. Откройте актуальный расход");
  await replaceTripManifestInTransaction(tx, trip.id, replacement, trip);
  await tx.logisticsPosting.update({ where: { id: posting.id, status: "ACTIVE" }, data: { status: "SUPERSEDED" } });
  const { amount, bynAmount, currency, cashAccountId, cashAccountNameSnapshot, expenseArticleId, rate, rateDate, paidAt, ttnNotRequired } = posting;
  const money = { amount, bynAmount, currency, cashAccountId, cashAccountNameSnapshot, expenseArticleId, rate, rateDate, paidAt, ttnNotRequired };
  const next = await tx.logisticsPosting.create({ data: {
    ...money, tripId: trip.id, tripRevision: revision, reallocatedFromId: posting.id,
    clientMutationId: input.requestId, requestFingerprint: fingerprint, actorId, actorNameSnapshot: actor.name,
    manifestSnapshot: { ...manifest, lines: replacement.snapshots },
  } });
  await tx.logisticsPostingDocument.createMany({ data: posting.documents.map(({ documentId }) => ({ postingId: next.id, tripId: trip.id, documentId })) });
  for (const { projectId, percentBps, amount: partAmount, bynAmount: partByn } of split.allocations) {
    const allocation = await tx.logisticsPostingAllocation.create({ data: {
      postingId: next.id, projectId, percentBps, amount: partAmount, bynAmount: partByn,
      projectNumberSnapshot: projects.find(row => row.id === projectId)!.number,
    } });
    if (!allocation.amount.isZero()) {
      await tx.payment.create({ data: {
        id: randomUUID(), projectId: allocation.projectId, direction: "EXPENSE", amount: allocation.amount, currency, rate, rateDate,
        bynAmount: allocation.bynAmount, projectAmount: allocation.bynAmount, cashAccountId, expenseArticleId, paidAt,
        createdById: actorId, logisticsAllocationId: allocation.id, comment: manifest.comment || `Логистика · ${manifest.date}`,
      } });
    }
  }
  const projectIds = [...new Set([...projects.map(project => project.id), ...posting.allocations.map(row => row.projectId)])];
  const event = await tx.domainEvent.create({ data: { type: "logistics.trip.redistributed", actor: actorId,
    payload: { tripId: trip.id, postingId: next.id, previousPostingId: posting.id, revision, projectIds } } });
  const hints = logisticsJournalHints({ id: trip.id, date: trip.date,
    shares: manifest.shares.map(share => ({ ...share, project: projects.find(row => row.id === share.projectId) })),
    lines: replacement.snapshots }, trip);
  const before = { postingId: posting.id, revision: trip.revision, manifest: posting.manifestSnapshot, shares: posting.allocations.map(({ projectId, percentBps, amount, bynAmount }) =>
    ({ projectId, percentBps, amount: amount.toFixed(2), bynAmount: bynAmount.toFixed(2) })) };
  const after = { postingId: next.id, revision, manifest: next.manifestSnapshot, shares: split.allocations };
  if (!reversal) await writeChangeLogInTransaction(tx, {
    actorType: "user", actorId, actorName: actor.name, source, entity: "logisticsPosting", entityId: next.id, action: "redistribute",
    oldValue: before, newValue: after, reversal: { kind: reallocationReversalKind, version: 1,
      data: { tripId: trip.id, postingId: next.id, revision, restorePostingId: posting.id } },
  }, { ...hints, before, after, kind: "event" });
  return { postingId: next.id, revision, noOp: false, eventIds: [event.id], cachePaths: reallocationPaths(trip.id, projectIds), hints, before, after };
}
