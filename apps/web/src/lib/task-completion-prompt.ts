/** A running timer is finalized by the server when the task is completed. */
export function requiresManualCompletionTime(task: { id: string; spentMinutes: number }, canManualTime: boolean, runningTaskId?: string | null): boolean {
  return task.spentMinutes === 0 && canManualTime && runningTaskId !== task.id;
}
