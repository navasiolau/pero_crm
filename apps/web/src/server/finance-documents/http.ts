import { randomUUID } from "node:crypto";
import { UploadError, uploadFailure, type UploadPhase } from "@/server/files/upload-result";
import { uploadSizeLimitError, uploadSizeLimitFor } from "@/server/files/upload-limits";
import type { createFinanceDocumentService } from "./core";

type HttpDependencies = {
  authorize: () => Promise<string>;
  service: ReturnType<typeof createFinanceDocumentService>;
  source?: "web" | "telegram";
};
const privateHeaders = { "Cache-Control": "private, no-store", "Vary": "Cookie, Authorization", "X-Content-Type-Options": "nosniff" };

/** Авторизация предшествует чтению multipart в обоих транспортных адаптерах. */
export async function uploadFinanceDocumentResponse(request: Request, dependencies: HttpDependencies) {
  const requestId = randomUUID();
  let phase: UploadPhase = "auth";
  try {
    const actorId = await dependencies.authorize();
    phase = "request";
    const form = await request.formData().catch(() => null), file = form?.get("file");
    const mutation = form?.get("clientMutationId");
    if (!form || !(file instanceof File) || typeof mutation !== "string")
      throw new UploadError("FINANCE_DOCUMENT_INVALID", 422, "request", "Выберите файл отчётного документа", "validation");
    const mimeType = file.type || "application/octet-stream";
    const limit = uploadSizeLimitFor({ mimeType });
    if (file.size > limit.maxBytes)
      throw new UploadError("FINANCE_DOCUMENT_TOO_LARGE", 413, "validation", uploadSizeLimitError(limit.kind), "validation");
    const result = await dependencies.service.upload(actorId, { clientMutationId: mutation, fileName: file.name,
      mimeType, bytes: Buffer.from(await file.arrayBuffer()) }, { source: dependencies.source,
      onPhase: next => { phase = next; } });
    return Response.json({ ok: true, ...result, requestId }, { status: result.repeated ? 200 : 201, headers: privateHeaders });
  } catch (error) {
    // Фаза может измениться внутри onPhase при ожидании сервиса.
    const failedPhase = phase as UploadPhase;
    const failure = uploadFailure(requestId, failedPhase, error, failedPhase === "persist" ? "unknown" : "notCommitted");
    return Response.json(failure.body, { status: failure.status, headers: privateHeaders });
  }
}

export async function readFinanceDocumentResponse(request: Request, id: string, dependencies: HttpDependencies) {
  try {
    const actorId = await dependencies.authorize();
    const result = await dependencies.service.read(actorId, id);
    if (!result) return Response.json({ error: "Документ не найден" }, { status: 404, headers: privateHeaders });
    const file = result.document;
    const inline = /^(image\/(jpeg|png|gif|webp|avif))$/.test(file.mimeType) ||
      (file.mimeType === "application/pdf" && new URL(request.url).searchParams.get("view") === "1");
    return new Response(result.body, { headers: { ...privateHeaders,
      "Content-Type": file.mimeType, "Content-Length": String(file.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Content-Security-Policy": "sandbox" } });
  } catch (error) {
    return Response.json({ error: error instanceof UploadError ? error.message : "Не удалось открыть документ" },
      { status: error instanceof UploadError ? error.status : 503, headers: privateHeaders });
  }
}
