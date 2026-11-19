"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { scopedFinanceAuth, financeSessionSource } from "@/server/telegram/finance-session";
import { prisma } from "@/lib/prisma";
import { productDraftVisibilityWhere } from "@/server/access/visibility";
import { dispatchEvent } from "@/server/plugins/events";
import { deliverPostCommit } from "@/server/operations/post-commit";
import { withMutationTransaction } from "@/server/transactions/coordinator";
import { loadReallocation, prepareReallocation, redistributeTripInTransaction, requireReallocationActor } from "./reallocation-core";
import { normalizeShipmentLine, reallocationInputSchema } from "./reallocation-contract";

async function reallocationSession() {
  const session = await scopedFinanceAuth();
  if (!session?.user.id) throw Error("Недостаточно прав для распределения рейса");
  return session;
}

function failure(error: unknown) {
  const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : null;
  return { ok: false as const, message: message ?? "Не удалось распределить рейс" };
}

export async function readTripReallocation(paymentId: string) {
  try {
    const id = (await reallocationSession()).user.id;
    return await prisma.$transaction(async tx => {
      const actor = await requireReallocationActor(tx, id);
      const payment = await tx.payment.findUnique({ where: { id: z.string().min(1).max(128).parse(paymentId) },
        select: { logisticsAllocation: { select: { posting: { select: { id: true, trip: { select: { id: true, revision: true } } } } } } } });
      const selected = payment?.logisticsAllocation?.posting;
      if (!selected) throw Error("Расход рейса не найден");
      const version = { tripId: selected.trip.id, revision: selected.trip.revision, postingId: selected.id };
      const { trip, posting } = await loadReallocation(tx, version);
      const [projects, materials] = await Promise.all([
        tx.project.findMany({ where: { deletedAt: null, currency: "BYN" },
          select: { id: true, number: true, title: true }, orderBy: { numberInt: "desc" } }),
        tx.material.findMany({ where: { active: true }, select: { id: true, name: true, sku: true }, orderBy: { name: "asc" } }),
      ]);
      const products = await tx.product.findMany({ where: { projectId: { in: trip.shares.map(share => share.projectId) },
        deletedAt: null, AND: [productDraftVisibilityWhere(actor)] },
        select: { id: true, projectId: true, title: true, number: true }, orderBy: { number: "asc" } });
      return { ok: true as const, version, projects, products, materials,
        shares: trip.shares.map(({ projectId, percentBps }) => ({ projectId, percentBps })),
        lines: trip.lines.map(line => normalizeShipmentLine({ ...line, quantity: line.quantity.toNumber() })),
        currency: posting.currency, amount: posting.amount.toFixed(2), bynAmount: posting.bynAmount.toFixed(2),
        cashName: posting.cashAccountNameSnapshot, date: posting.paidAt.toISOString().slice(0, 10) };
    });
  } catch (error) { return failure(error); }
}

export async function readTripReallocationProducts(rawProjectId: string) {
  try {
    const id = (await reallocationSession()).user.id;
    const projectId = z.string().min(1).max(128).parse(rawProjectId);
    return await prisma.$transaction(async tx => {
      const actor = await requireReallocationActor(tx, id);
      const products = await tx.product.findMany({ where: { projectId, deletedAt: null, project: { deletedAt: null, currency: "BYN" },
        AND: [productDraftVisibilityWhere(actor)] }, select: { id: true, projectId: true, title: true, number: true },
        orderBy: { number: "asc" } });
      return { ok: true as const, products };
    });
  } catch (error) { return failure(error); }
}

export async function previewTripReallocation(rawInput: unknown) {
  try {
    const id = (await reallocationSession()).user.id;
    const input = reallocationInputSchema.parse(rawInput);
    return await prisma.$transaction(async tx => {
      const { noOp, split } = await prepareReallocation(tx, id, input);
      return { ok: true as const, noOp, ...split };
    });
  } catch (error) { return failure(error); }
}

export async function saveTripReallocation(rawInput: unknown) {
  try {
    const session = await reallocationSession();
    const id = session.user.id;
    const input = reallocationInputSchema.parse(rawInput);
    const result = await withMutationTransaction(tx => redistributeTripInTransaction(tx, id, input, false, financeSessionSource(session)));
    await deliverPostCommit("logistics-redistribute", result.postingId, [
      ...result.cachePaths.map(path => ({ kind: "cache" as const, run: () => revalidatePath(path) })),
      ...result.eventIds.map(eventId => ({ kind: "dispatch" as const, run: () => dispatchEvent(eventId) })),
    ]);
    return { ok: true as const, noOp: result.noOp };
  } catch (error) { return failure(error); }
}
