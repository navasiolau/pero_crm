import { z } from "zod";

const revision = z.number().int().nonnegative();
const taskValue = z.object({
  title: z.string().optional(), type: z.string().nullable().optional(), dueAt: z.string().nullable().optional(),
  productId: z.string().nullable().optional(), workId: z.string().nullable().optional(), assigneeId: z.string().nullable().optional(),
  quantity: z.string().nullable().optional(), status: z.enum(["DRAFT", "NEW", "IN_PROGRESS"]).optional(),
  dependencyIds: z.array(z.string()).optional(),
}).strict();
export const taskEditReversalKind = "task.edit";
export const taskEditReversalSchema = z.object({
  expected: taskValue, restore: taskValue, revisions: z.record(z.string(), revision),
}).strict();
export type TaskEditReversal = z.infer<typeof taskEditReversalSchema>;

export function trackedRevision(revisions: unknown, field: string) {
  if (revisions && typeof revisions === "object" && !Array.isArray(revisions)) {
    const value = (revisions as Record<string, unknown>)[field];
    if (typeof value === "number") return value;
  }
  return 0;
}
