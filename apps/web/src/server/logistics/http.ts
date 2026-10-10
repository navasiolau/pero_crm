import { randomUUID } from "node:crypto";
import { UploadError, uploadFailure, type UploadPhase } from "@/server/files/upload-result";
import { uploadSizeLimitError, uploadSizeLimitFor } from "@/server/files/upload-limits";
import type { createLogisticsDocumentService } from "./documents";

type HttpDependencies = { authorize: () => Promise<string>; service: ReturnType<typeof createLogisticsDocumentService> };
const privateHeaders = { "Cache-Control": "private, no-store", "Vary": "Cookie, Authorization", "X-Content-Type-Options": "nosniff" };

export async function uploadLogisticsDocumentResponse(request: Request, dependencies: HttpDependencies) {
  const requestId = randomUUID();
  let phase: UploadPhase = "auth";
  try {
    const actorId = await dependencies.authorize();
    phase = "request";
    const form = await request.formData().catch(() => null), file = form?.get("file");
    const mutation = form?.get("clientMutationId"), tripId = form?.get("tripId"), stage = form?.get("stage");
    const ttnNumber = form?.get("ttnNumber");
    if (!form || !(file instanceof File) || typeof mutation !== "string" || typeof tripId !== "string" ||
      (stage !== "ISSUED" && stage !== "SIGNED") || (ttnNumber !== null && typeof ttnNumber !== "string"))
      throw new UploadError("LOGISTICS_DOCUMENT_INVALID", 422, "request", "Выберите ТТН и отметьте одну или две печати", "validation");
    const mimeType = file.type || "application/octet-stream", limit = uploadSizeLimitFor({ mimeType });
    if (file.size > limit.maxBytes)
      throw new UploadError("LOGISTICS_DOCUMENT_TOO_LARGE", 413, "validation", uploadSizeLimitError(limit.kind), "validation");
    const result = await dependencies.service.upload(actorId, { tripId, clientMutationId: mutation, stage,
      ttnNumber, fileName: file.name, mimeType, bytes: Buffer.from(await file.arrayBuffer()) }, { onPhase: next => { phase = next; } });
    return Response.json({ ok: true, ...result, requestId }, { status: result.repeated ? 200 : 201, headers: privateHeaders });
  } catch (error) {
    const failedPhase = phase as UploadPhase;
    const failure = uploadFailure(requestId, failedPhase, error, failedPhase === "persist" ? "unknown" : "notCommitted");
    return Response.json(failure.body, { status: failure.status, headers: privateHeaders });
  }
}

export async function readLogisticsDocumentResponse(request: Request, id: string, dependencies: HttpDependencies) {
  try {
    const actorId = await dependencies.authorize();
    const result = await dependencies.service.read(actorId, id);
    if (!result) return Response.json({ error: "ТТН не найдена" }, { status: 404, headers: privateHeaders });
    const file = result.document;
    const inline = /^(image\/(jpeg|png|gif|webp|avif))$/.test(file.mimeType) ||
      (file.mimeType === "application/pdf" && new URL(request.url).searchParams.get("view") === "1");
    return new Response(result.body, { headers: { ...privateHeaders,
      "Content-Type": file.mimeType, "Content-Length": String(file.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Content-Security-Policy": "sandbox" } });
  } catch (error) {
    return Response.json({ error: error instanceof UploadError ? error.message : "Не удалось открыть ТТН" },
      { status: error instanceof UploadError ? error.status : 503, headers: privateHeaders });
  }
}
