import type { Prisma } from "@prisma/client";
import type { DomainActor } from "@/server/actor";
import { changeWorkTaskLifecycle, WorkTaskLifecycleRefusal } from "./lifecycle-core";

export async function deleteTaskInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, taskId: string) {
  try {
    const { row: task } = await changeWorkTaskLifecycle(tx, actor, "task", taskId);
    return { ok: true as const, task };
  } catch (error) {
    // Бизнес-отказы можно вернуть в форму. Ошибка записи должна откатить транзакцию.
    if (error instanceof WorkTaskLifecycleRefusal) return { ok: false as const, error: error.message };
    throw error;
  }
}
