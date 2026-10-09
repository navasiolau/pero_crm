export type MeasurementUploadContext = {projectId: string} & (
  {taskId: string; productId?: never} |
  {productId: string; taskId?: never}
);
// Задача сохраняет свою настоящую привязку; изделие не получает фиктивный taskId.
export function measurementUploadFields(context: MeasurementUploadContext): Record<string, string> {
  if (!context.projectId || Boolean(context.taskId) === Boolean(context.productId)) throw Error("Не определён контекст замера");
  if (context.taskId) return {projectId: context.projectId, taskId: context.taskId, section: "MEASUREMENT"};
  return {projectId: context.projectId, productId: context.productId!, section: "MEASUREMENT"};
}
