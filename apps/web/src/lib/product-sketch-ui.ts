import type { SketchFilePreview } from "@/lib/product-hero";

// Отображение меняется только после согласованного ACK указателя и файла.
export function readSketchUploadConfirmation(value: unknown, mutationId: string): SketchFilePreview {
  if (!value || typeof value !== "object") throw Error("Не получено подтверждение эскиза. Повторите запрос.");
  const result = value as Record<string, unknown>;
  const sketch = result.sketch as Record<string, unknown> | undefined;
  if (result.ok !== true || typeof result.id !== "string" || !result.id || result.sketchFileId !== result.id || result.clientMutationId !== mutationId || !sketch || sketch.id !== result.id || typeof sketch.fileName !== "string" || typeof sketch.mimeType !== "string" || !sketch.mimeType.startsWith("image/") || typeof sketch.hasThumb !== "boolean") throw Error("Не получено подтверждение эскиза. Повторите запрос.");
  return { id: result.id, fileName: sketch.fileName, mimeType: sketch.mimeType, hasThumb: sketch.hasThumb };
}
export function isConfirmedSketchDelete(value: unknown, mutationId: string): boolean {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return result.ok === true && result.sketchFileId === null && result.clientMutationId === mutationId;
}
