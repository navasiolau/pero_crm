export type MeasurementUploadContext = { projectId: string } & (
  { taskId: string; productId?: never; stage?: never } |
  { productId: string; taskId?: never; stage: "PRODUCTION" }
);
// Контекст задачи сохраняет прежний payload; изделие не получает фиктивный taskId.
export function measurementUploadFields(context: MeasurementUploadContext): Record<string, string> {
  if (!context.projectId || Boolean(context.taskId) === Boolean(context.productId)) throw Error("Не определён контекст замера");
  if (context.taskId) return { projectId: context.projectId, taskId: context.taskId, category: "MEASUREMENT" };
  if (context.stage !== "PRODUCTION") throw Error("Неверный этап замера изделия");
  return { projectId: context.projectId, productId: context.productId!, category: "MEASUREMENT", stage: "PRODUCTION" };
}
