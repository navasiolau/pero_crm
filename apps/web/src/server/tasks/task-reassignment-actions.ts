'use server';
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyPerson } from "@/server/notifications/notify";
import { listTaskReassignmentOptions, reassignOrdinaryTaskCore, type TaskReassignmentInput, type TaskReassignmentResult } from "./task-reassignment-core";

export async function getTaskReassignmentOptions(taskId: string) {
  const session = await auth(); if (!session?.user) return { ok: false as const, error: "Не авторизован" };
  return listTaskReassignmentOptions({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, taskId);
}

export async function reassignOrdinaryTask(input: TaskReassignmentInput): Promise<TaskReassignmentResult> {
  const session = await auth(); if (!session?.user) return { ok: false, kind: "forbidden", error: "Не авторизован" };
  const result = await reassignOrdinaryTaskCore({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, input);
  if (!result.ok) return result;
  if (!result.repeated && result.eventId) {
    try { await dispatchEvent(result.eventId); } catch { console.warn(JSON.stringify({ event: "task-reassignment.event-delivery-failed", requestId: input.clientMutationId })); }
    try { await notifyPerson({ userId: result.assigneeId, type: "task.assigned", title: `Вам назначена задача: ${result.title}`, body: `Проект ${result.projectNumber}`, link: "/my" }); }
    catch { console.warn(JSON.stringify({ event: "task-reassignment.notification-failed", requestId: input.clientMutationId })); }
  }
  try { await revalidateProductPaths(result.productId); revalidatePath(`/projects/${result.projectId}`); revalidatePath("/my"); }
  catch { /* Подтверждённый receipt сохраняется независимо от обновления cache. */ }
  return result;
}
