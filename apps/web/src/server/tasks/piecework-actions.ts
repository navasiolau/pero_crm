"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyPerson } from "@/server/notifications/notify";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { deliverPostCommit } from "@/server/operations/post-commit";
import { createPieceworkAllocationCore, transferPieceworkShareCore, type CreatePieceworkInput, type TransferPieceworkInput, type PieceworkResult } from "./piecework-core";
import { listPieceworkOptions } from "./piecework-queries";

async function deliver(result: PieceworkResult) {
  if (!result.ok) return result;
  await deliverPostCommit("task-create", result.groupId, [
    ...(!result.repeated ? result.eventIds.map(eventId => ({ kind: "dispatch" as const, run: () => dispatchEvent(eventId) })) : []),
    ...(!result.repeated ? result.recipientIds.map(userId => ({ kind: "person" as const, run: () => notifyPerson({ userId, type: "task.assigned", title: "Вам назначена доля работы", link: "/my" }) })) : []),
    { kind: "cache", run: () => revalidateProductPaths(result.productId) },
    { kind: "cache", run: () => revalidatePath(`/projects/${result.projectId}`) },
    { kind: "cache", run: () => revalidatePath("/my") },
  ]);
  return result;
}

export async function createPieceworkAllocation(input: CreatePieceworkInput): Promise<PieceworkResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, kind: "forbidden", error: "Не авторизован" };
  return deliver(await createPieceworkAllocationCore({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, input));
}

export async function transferPieceworkShare(input: TransferPieceworkInput): Promise<PieceworkResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, kind: "forbidden", error: "Не авторизован" };
  return deliver(await transferPieceworkShareCore({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, input));
}

export async function getPieceworkOptions(productId: string, taskId?: string) {
  const session = await auth();
  if (!session?.user) return null;
  return listPieceworkOptions(session.user.id, productId, taskId);
}
