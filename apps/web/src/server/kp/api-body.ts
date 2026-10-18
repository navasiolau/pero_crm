import { apiFailure } from "./api-contract";
export const KP_JSON_LIMIT = 2 * 1024 * 1024;
export const KP_UPLOAD_FILE_LIMIT = 15 * 1024 * 1024;
export const KP_MULTIPART_LIMIT = KP_UPLOAD_FILE_LIMIT * 2 + 256 * 1024;

export async function readKpBody(request: Request, limit: number): Promise<Uint8Array> {
  const announced = request.headers.get("content-length");
  if (announced && (!/^\d+$/.test(announced) || Number(announced) > limit))
    return apiFailure("KP_BODY_TOO_LARGE", 413, "Запрос превышает допустимый размер");
  const reader = request.body?.getReader();
  if (!reader) return apiFailure("KP_BODY_REQUIRED", 400, "Нужно тело запроса");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); return apiFailure("KP_BODY_TOO_LARGE", 413, "Запрос превышает допустимый размер"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readKpJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
    return apiFailure("KP_CONTENT_TYPE", 415, "Нужен Content-Type application/json");
  const bytes = await readKpBody(request, KP_JSON_LIMIT);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return apiFailure("KP_JSON_INVALID", 400, "Некорректный JSON"); }
}

export async function readKpUpload(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return apiFailure("KP_CONTENT_TYPE", 415, "Нужна multipart-форма изображения");
  const bytes = await readKpBody(request, KP_MULTIPART_LIMIT);
  let form: FormData;
  try { form = await new Request("https://kp-upload.invalid", { method: "POST", headers: { "content-type": contentType }, body: new Uint8Array(bytes) }).formData(); }
  catch { return apiFailure("KP_MULTIPART_INVALID", 400, "Не удалось прочитать изображение"); }
  const allowed = new Set(["file", "optimized", "operationId", "expectedRevision", "documentId", "proposalId"]);
  const seen = new Set<string>();
  for (const [key] of form) {
    if (!allowed.has(key) || seen.has(key)) return apiFailure("KP_MULTIPART_INVALID", 400, "Неизвестное или повторённое поле загрузки");
    seen.add(key);
  }
  const file = form.get("file"), optimized = form.get("optimized");
  if (!(file instanceof File) || optimized !== null && !(optimized instanceof File))
    return apiFailure("KP_UPLOAD_REQUIRED", 400, "Выберите изображение");
  for (const image of [file, optimized]) if (image && (image.size < 1 || image.size > KP_UPLOAD_FILE_LIMIT))
    return apiFailure("KP_IMAGE_TOO_LARGE", 413, "Каждое изображение должно быть не больше 15 МиБ");
  const documentId = form.get("documentId"), proposalId = form.get("proposalId");
  if (documentId !== null && proposalId !== null && documentId !== proposalId)
    return apiFailure("KP_ID_MISMATCH", 400, "ID КП в полях загрузки не совпали");
  return {
    proposalId: documentId ?? proposalId, expectedRevision: form.get("expectedRevision"), operationId: form.get("operationId"),
    original: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType: file.type,
    ...(optimized instanceof File ? { optimized: Buffer.from(await optimized.arrayBuffer()), optimizedMimeType: optimized.type } : {}),
  };
}
