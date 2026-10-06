// Дифференцированные лимиты размера загрузки (чистый модуль без зависимостей,
// используется серверным роутом и юнит-тестами).
// Правило: изображения и обложки — 25 МБ, не-изображения
// (документы, чертежи, PDF) — до 1 ГБ. Лимит определяется типом содержимого,
// а не категорией: PDF замера и фото замера лежат в одной категории MEASUREMENT.

/** Лимит изображений, эскизов и обложек — как было. */
export const IMAGE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** Лимит документов, чертежей и прочих не-изображений — 1 ГБ. */
export const DOCUMENT_UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;

export type UploadSizeKind = "image" | "document";

export function resolveUploadSizeKind(input: {
  mimeType: string;
  assignCover?: boolean;
  assignProjectCover?: boolean;
}): UploadSizeKind {
  // Обложки — всегда изображения поддерживаемого формата, но фиксируем явно:
  // даже при пустом MIME они остаются под лимитом 25 МБ.
  if (input.assignCover || input.assignProjectCover) return "image";
  return input.mimeType.toLowerCase().startsWith("image/") ? "image" : "document";
}

export function uploadSizeLimitFor(input: {
  mimeType: string;
  assignCover?: boolean;
  assignProjectCover?: boolean;
}): { maxBytes: number; kind: UploadSizeKind } {
  const kind = resolveUploadSizeKind(input);
  return { maxBytes: kind === "image" ? IMAGE_UPLOAD_MAX_BYTES : DOCUMENT_UPLOAD_MAX_BYTES, kind };
}

/** Раздельные тексты ошибок лимита для изображений и документов. */
export function uploadSizeLimitError(kind: UploadSizeKind): string {
  return kind === "image" ? "Файл больше 25 МБ" : "Файл больше 1 ГБ";
}
