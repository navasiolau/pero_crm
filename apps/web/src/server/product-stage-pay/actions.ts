"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyOrg, notifyPerson } from "@/server/notifications/notify";
import { withTaskTransaction } from "@/server/tasks/transaction";
import type { DomainActor } from "@/server/projects/core";
import { closeEngineeringStageCore, configureEngineeringPool, configureEngineeringTaskShares, convertUnpaidWorkToEngineering,
  createEngineeringWorkCore, prepareEngineeringQuote } from "./core";
import { deliverEngineeringClosed, deliverEngineeringCreated } from "./post-commit";

async function actor(): Promise<DomainActor> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  if (!hasAnyRole(session.user.roles, MANAGER_ROLES)) throw new Error("Недостаточно прав");
  return { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" };
}

export async function configureEngineeringTaskSharesAction(input: {
  productId: string; workId: string; shares: { taskId: string; units: number; expectedRevision: number }[]; expectedPoolRevision: number;
}) {
  const user = await actor();
  return answer(input.productId, () => withTaskTransaction((tx) => configureEngineeringTaskShares(user, input, tx)));
}

async function answer<T>(productId: string, operation: () => Promise<T>): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  try {
    const result = await operation();
    await revalidateProductPaths(productId).catch(() => {});
    return { ok: true, result };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Ошибка инженерного фонда" }; }
}

export async function configureEngineeringPoolAction(input: {
  productId: string; ratePercent: string | null; workWeights: { workId: string; units: number }[]; expectedPoolRevision: number;
}) {
  const user = await actor();
  return answer(input.productId, async () => {
    const pool = await withTaskTransaction((tx) => configureEngineeringPool(user, input, tx));
    return { poolId: pool.id, revision: pool.revision, state: pool.state, ratePercent: pool.ratePercent?.toString() ?? null };
  });
}

export async function createEngineeringWorkAction(input: {
  productId: string; title: string; quantity: string; assigneeId: string; dueAt: Date; estimateMinutes: number;
  poolWeights: { workId: string; units: number }[]; expectedPoolRevision: number;
}) {
  const user = await actor();
  return answer(input.productId, async () => {
    const result = await withTaskTransaction((tx) => createEngineeringWorkCore(user, input, tx));
    await deliverEngineeringCreated(result, { dispatchEvent, notifyPerson, notifyOrg });
    try { revalidatePath("/my"); revalidatePath("/tasks"); } catch { /* committed mutation remains successful */ }
    return { workId: result.workId, taskId: result.taskId, poolId: result.poolId };
  });
}

export async function convertUnpaidWorkToEngineeringAction(input: {
  productId: string; workId: string; poolId: string; poolWeights: { workId: string; units: number }[];
  taskShares: { taskId: string; units: number; expectedRevision: number }[]; expectedPoolRevision: number; requestId: string;
}) {
  const user = await actor();
  return answer(input.productId, async () => {
    const receipt = await withTaskTransaction((tx) => convertUnpaidWorkToEngineering(user, input, tx));
    return { receiptId: receipt.id, workId: receipt.workId, poolId: receipt.poolId };
  });
}

export async function closeEngineeringStageAction(input: { productId: string; expectedPoolRevision: number; requestId: string }) {
  const user = await actor();
  return answer(input.productId, async () => {
    const existing = await prisma.changeLog.findUnique({ where: { id: `product-engineering-close:${input.requestId}` }, select: { id: true } });
    const quote = existing ? null : await prepareEngineeringQuote(input.productId, prisma);
    const result = await withTaskTransaction((tx) => closeEngineeringStageCore(user, input, quote, tx));
    await deliverEngineeringClosed(result, user.id, { dispatchEvent, notifyPerson, notifyOrg });
    if (!result.repeated) {
      try { revalidatePath("/my"); revalidatePath("/payroll"); revalidatePath("/finance/payroll"); } catch { /* committed mutation remains successful */ }
    }
    return { settlementId: result.settlementId, repeated: result.repeated, eventId: result.eventId };
  });
}
