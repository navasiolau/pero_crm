import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import type { DomainActor } from "@/server/actor";
import { readCashBalance, readOrgBalance } from "@/server/payroll/cash-core";
import { logisticsManifestInclude, lockLogisticsTrip, replaceTripManifestInTransaction, validateTripManifest } from "./core";
import { logisticsTripManifestSchema } from "./contracts";
import { normalizeShipmentLine } from "./reallocation-contract";
import { reallocationPaths } from "./reallocation-core";
import { logisticsJournalHints } from "./journal";
import { documentUndoKind, documentUndoSchema, manifestSnapshot, tripUndoKind, tripUndoSchema, type TripUndo } from "./lifecycle-contract";

const postingInclude = { allocations: { include: { payment: { select: { comment: true } } } }, documents: true } satisfies Prisma.LogisticsPostingInclude;
type Posting = Prisma.LogisticsPostingGetPayload<{ include: typeof postingInclude }>;
const conflict = "Рейс уже изменён. Откройте актуальную запись";

async function loadTripUndo(tx: Prisma.TransactionClient, actor: DomainActor, data: TripUndo) {
  const trip = await tx.logisticsTrip.findUnique({ where: { id: data.tripId }, include: logisticsManifestInclude });
  if (!trip || trip.revision !== data.expectedRevision || Boolean(trip.deletedAt) !== data.expectedHidden)
    throw new JournalReversalRefusal(conflict);
  const current = await tx.logisticsPosting.findFirst({
    where: { tripId: trip.id, status: "ACTIVE" }, include: postingInclude,
  });
  if ((current?.id ?? null) !== data.expectedPostingId) throw new JournalReversalRefusal(conflict);
  if (data.requireNoDocuments && await tx.logisticsDocument.count({ where: { tripId: trip.id, hiddenAt: null, state: "READY" } }))
    throw new JournalReversalRefusal("В рейс добавлены документы. Сначала отмените их загрузку");

  const target = data.restorePostingId === current?.id ? current : data.restorePostingId
    ? await tx.logisticsPosting.findUnique({ where: { id: data.restorePostingId }, include: postingInclude }) : null;
  if (data.restorePostingId && (!target || target.tripId !== trip.id || (target.id !== current?.id &&
      (target.status !== "SUPERSEDED" || target.tripRevision >= trip.revision))))
    throw new JournalReversalRefusal("Историческая проводка рейса недоступна");

  const restoreManifest = data.manifest ?? (trip.deletedAt && !data.restoreHidden ? manifestSnapshot(trip) : null);
  if (restoreManifest) {
    const manifest = logisticsTripManifestSchema.parse({ ...restoreManifest, lines: restoreManifest.lines.map(normalizeShipmentLine) });
    await validateTripManifest(tx, manifest, trip, actor);
  }
  if (!data.restoreHidden && target) {
    const projectIds = target.allocations.map(row => row.projectId);
    const projects = await tx.project.findMany({ where: { id: { in: projectIds }, deletedAt: null }, select: { currency: true } });
    if (projects.length !== projectIds.length || projects.some(project => project.currency !== "BYN"))
      throw new JournalReversalRefusal("Проект проведённого рейса недоступен или его валюта изменилась");
    const account = await tx.cashAccount.findUnique({ where: { id: target.cashAccountId }, select: { currency: true } });
    if (account?.currency !== target.currency) throw new JournalReversalRefusal("Валюта исторической кассы изменилась");
  }
  await assertBalance(tx, trip.deletedAt ? null : current, data.restoreHidden ? null : target);
  return { trip, current, target };
}

async function assertBalance(tx: Prisma.TransactionClient, current: Posting | null, target: Posting | null) {
  if (current?.id === target?.id) return;
  const cashDeltas = new Map<string, Prisma.Decimal>();
  if (current) cashDeltas.set(current.cashAccountId, current.amount);
  if (target) cashDeltas.set(target.cashAccountId,
    (cashDeltas.get(target.cashAccountId) ?? new Prisma.Decimal(0)).minus(target.amount));
  for (const [accountId, delta] of cashDeltas) {
    if ((await readCashBalance(tx, accountId)).plus(delta).lt(0))
      throw new JournalReversalRefusal("Откат оставит отрицательный остаток кассы");
  }
  const bynDelta = (current?.bynAmount ?? new Prisma.Decimal(0)).minus(target?.bynAmount ?? 0).toFixed(2);
  if ((await readOrgBalance(tx, "1.000000", bynDelta)).lt(0))
    throw new JournalReversalRefusal("Откат оставит отрицательный баланс организации");
}

async function restorePosting(tx: Prisma.TransactionClient, actor: DomainActor, source: Posting, revision: number, requestId: string) {
  const { tripId, amount, bynAmount, currency, cashAccountId, cashAccountNameSnapshot, rate, rateDate, paidAt,
    expenseArticleId, ttnNotRequired, manifestSnapshot } = source;
  const next = await tx.logisticsPosting.create({ data: {
    tripId, tripRevision: revision, restoredFromId: source.id, clientMutationId: requestId,
    requestFingerprint: createHash("sha256").update(JSON.stringify({ actorId: actor.id, postingId: source.id, revision })).digest("hex"),
    actorId: actor.id, actorNameSnapshot: actor.name ?? "", amount, bynAmount, currency, cashAccountId, cashAccountNameSnapshot,
    rate, rateDate, paidAt, expenseArticleId, ttnNotRequired, manifestSnapshot: manifestSnapshot as Prisma.InputJsonValue,
  } });
  await tx.logisticsPostingDocument.createMany({ data: source.documents.map(({ documentId }) => ({ tripId, postingId: next.id, documentId })) });
  for (const { projectId, percentBps, amount, bynAmount, projectNumberSnapshot, payment } of source.allocations) {
    const part = await tx.logisticsPostingAllocation.create({ data: { postingId: next.id, projectId, percentBps, amount, bynAmount,
      projectNumberSnapshot } });
    if (part.amount.isZero()) continue;
    if (!payment) throw new JournalReversalRefusal("Историческая доля рейса не содержит платежа");
    await tx.payment.create({ data: { id: randomUUID(), direction: "EXPENSE", logisticsAllocationId: part.id, createdById: actor.id,
      amount, bynAmount, projectAmount: bynAmount, projectId, currency, rate, rateDate, paidAt, expenseArticleId, cashAccountId,
      comment: payment.comment } });
  }
  return next.id;
}

function postingAuditSnapshot(posting: Posting | null, postingId: string | null) {
  if (!posting || !postingId) return null;
  return {
    postingId, amount: posting.amount.toFixed(2), currency: posting.currency, bynAmount: posting.bynAmount.toFixed(2),
    cashAccount: posting.cashAccountNameSnapshot, cashAccountId: posting.cashAccountId, rate: posting.rate.toFixed(6),
    rateDate: posting.rateDate?.toISOString() ?? null, paidAt: posting.paidAt.toISOString(),
    documents: posting.documents.map(({ documentId }) => documentId),
    allocations: posting.allocations.map(({ projectId, projectNumberSnapshot, percentBps, amount, bynAmount }) =>
      ({ projectId, project: projectNumberSnapshot, percentBps, amount: amount.toFixed(2), bynAmount: bynAmount.toFixed(2) })),
  };
}

export const logisticsTripLifecycleReversal = defineJournalReversal({
  kind: tripUndoKind,
  version: 1,
  schema: tripUndoSchema,
  async preview(ctx, data) {
    try {
      await loadTripUndo(ctx.tx, ctx.actor, data);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : conflict;
    }
  },
  async apply(ctx, data) {
    const { tx, actor } = ctx;
    await lockLogisticsTrip(tx, data.tripId);
    const { trip, current, target } = await loadTripUndo(tx, actor, data);
    const revision = trip.revision + 1;
    const changed = await tx.logisticsTrip.updateMany({ where: { id: trip.id, revision: trip.revision },
      data: { revision, deletedAt: data.restoreHidden ? new Date() : null, deletedById: data.restoreHidden ? actor.id : null,
        updatedById: actor.id,
        ...(data.manifest ? { date: new Date(data.manifest.date + "T00:00:00.000Z"), comment: data.manifest.comment,
          ttnNotRequired: data.manifest.ttnNotRequired } : {}) } });
    if (changed.count !== 1) throw new JournalReversalRefusal(conflict);

    if (data.manifest) {
      const { lines, ...saved } = data.manifest;
      await replaceTripManifestInTransaction(tx, trip.id, { ...saved, lines: lines.map(normalizeShipmentLine), snapshots: lines }, trip);
    }
    if (current && current.id !== target?.id)
      await tx.logisticsPosting.update({ where: { id: current.id, status: "ACTIVE" }, data: { status: "SUPERSEDED" } });
    const postingId = target && target.id !== current?.id
      ? await restorePosting(tx, actor, target, revision, ctx.reversalId!) : target?.id ?? null;
    const row = await tx.logisticsTrip.findUniqueOrThrow({ where: { id: trip.id }, include: logisticsManifestInclude });
    const projectIds = [...new Set([...trip.shares.map(share => share.projectId), ...row.shares.map(share => share.projectId),
      ...(current?.allocations.map(part => part.projectId) ?? []), ...(target?.allocations.map(part => part.projectId) ?? [])])];
    const event = await tx.domainEvent.create({ data: { type: "logistics.trip.reversed", actor: actor.id,
      payload: { tripId: trip.id, revision, postingId, previousPostingId: current?.id ?? null, projectIds, journalEntryId: ctx.entryId } } });
    return {
      inverse: { ...data, expectedRevision: revision, expectedHidden: data.restoreHidden, expectedPostingId: postingId,
        restoreHidden: data.expectedHidden, restorePostingId: current?.id ?? null,
        manifest: data.manifest ? manifestSnapshot(trip) : null },
      hints: logisticsJournalHints(row, trip), cachePaths: reallocationPaths(trip.id, projectIds), eventIds: [event.id],
      oldValue: { ...manifestSnapshot(trip), posting: postingAuditSnapshot(trip.deletedAt ? null : current, current?.id ?? null), deletedAt: trip.deletedAt?.toISOString() ?? null, revision: trip.revision },
      newValue: { ...manifestSnapshot(row), posting: postingAuditSnapshot(data.restoreHidden ? null : target, postingId), deletedAt: row.deletedAt?.toISOString() ?? null, revision },
    };
  },
});

export const logisticsDocumentVisibilityReversal = defineJournalReversal({
  kind: documentUndoKind,
  version: 1,
  schema: documentUndoSchema,
  async preview(ctx, data) {
    return checkDocument(ctx.tx, data);
  },
  async apply(ctx, data) {
    await lockLogisticsTrip(ctx.tx, data.tripId);
    const reason = await checkDocument(ctx.tx, data);
    if (reason) throw new JournalReversalRefusal(reason);
    const changed = await ctx.tx.logisticsDocument.updateMany({
      where: { id: data.documentId, visibilityRevision: data.expectedRevision },
      data: { visibilityRevision: { increment: 1 }, hiddenAt: data.hide ? new Date() : null },
    });
    if (changed.count !== 1) throw new JournalReversalRefusal("Документ изменился");
    return { inverse: { ...data, expectedRevision: data.expectedRevision + 1, hide: !data.hide },
      oldValue: { visible: data.hide }, newValue: { visible: !data.hide },
      cachePaths: reallocationPaths(data.tripId, []) };
  },
});

async function checkDocument(tx: Prisma.TransactionClient, data: { tripId: string; documentId: string; expectedRevision: number; hide: boolean }) {
  const row = await tx.logisticsDocument.findUnique({ where: { id: data.documentId },
    select: { tripId: true, state: true, hiddenAt: true, visibilityRevision: true, trip: { select: { deletedAt: true } },
      _count: { select: { postingDocuments: true } } } });
  if (!row || row.tripId !== data.tripId || row.trip.deletedAt || row.state !== "READY" ||
      row.visibilityRevision !== data.expectedRevision || Boolean(row.hiddenAt) === data.hide) return "Документ или рейс изменился";
  if (row._count.postingDocuments > 0) return "ТТН закреплена за исторической проводкой рейса";
  return null;
}