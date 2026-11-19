import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { taskEditReversalKind, taskEditReversalSchema, type TaskEditReversal } from "./edit-reversal-contract";
import { updateTaskInTransaction, type TaskUpdateData } from "./update-core";

function patch(data: TaskEditReversal): TaskUpdateData {
  const { quantity, title, type, dueAt, assigneeId, productId, workId, dependencyIds } = data.restore;
  return { title, type, dueAt, assigneeId, productId, workId, dependencyIds, ...(quantity !== undefined && { quantity: quantity === null ? null : Number(quantity) }) };
}

export const taskEditReversal = defineJournalReversal({
  kind: taskEditReversalKind,
  version: 1,
  schema: taskEditReversalSchema,
  async preview(ctx, data) {
    const result = await updateTaskInTransaction(ctx.tx, ctx.actor, ctx.entityId, patch(data), data, true);
    return result.ok ? null : result.error;
  },
  async apply(ctx, data) {
    const result = await updateTaskInTransaction(ctx.tx, ctx.actor, ctx.entityId, patch(data), data);
    if (!result.ok || !result.inverse)
      throw new JournalReversalRefusal(result.ok ? "Изменение задачи отсутствует" : result.error);
    const { task, hints, beforeSnapshot, afterSnapshot, inverse } = result;
    const productIds = [...new Set([task.productId, result.afterTask?.productId].filter(Boolean))];
    return { inverse, hints, oldValue: beforeSnapshot, newValue: afterSnapshot,
      cachePaths: ["/tasks", "/my", "/calendar", `/projects/${task.projectId}`, ...productIds.map(id => `/products/${id}`)] };
  },
});
