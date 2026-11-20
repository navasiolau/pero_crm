import { z } from "zod";
import type { Task } from "@prisma/client";

const share = z.object({
  allocationGroupId: z.string().nullable(), shareUnits: z.number().int().nullable(), shareAmount: z.string().nullable(),
});
const task = z.object({
  id: z.string(), revision: z.number().int().nonnegative(), deleted: z.boolean(),
  restoreDeleted: z.boolean(), restoreShare: share.nullable(),
});
export const pieceworkUndoSchema = z.object({
  groupId: z.string(), workId: z.string(), activeGroupIds: z.array(z.string()), affectedDependents: z.array(z.string()),
  budget: z.string(), quantity: z.string(), currency: z.string(), ordinaryRate: z.string().nullable(),
  tasks: z.array(task).min(1),
});
export const pieceworkUndoKind = "task-allocation.lifecycle";
export type PieceworkUndo = z.infer<typeof pieceworkUndoSchema>;

type ShareState = Pick<Task, "allocationGroupId" | "shareUnits" | "shareAmount">;

export function taskShareSnapshot(row: ShareState) {
  return { allocationGroupId: row.allocationGroupId, shareUnits: row.shareUnits, shareAmount: row.shareAmount?.toString() ?? null };
}

export function pieceworkUndoCommand(data: PieceworkUndo) {
  return { kind: pieceworkUndoKind, version: 1, data };
}