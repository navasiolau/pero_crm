import { z } from "zod";

export const workTaskLifecycleSchema = z.object({
  entity: z.enum(["work", "task"]),
  id: z.string().min(1).max(128),
  revision: z.number().int().nonnegative(),
  deleted: z.boolean(),
}).strict();
export type WorkTaskLifecycle = z.infer<typeof workTaskLifecycleSchema>;
export const workTaskLifecycleKind = "work-task.lifecycle";

export function workTaskLifecycleCommand(data: WorkTaskLifecycle) {
  return { kind: workTaskLifecycleKind, version: 1, data };
}
