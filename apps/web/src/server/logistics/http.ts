import { randomUUID } from "node:crypto";
import { privateFileHeaders } from "@/server/files/private-response";
import { UploadError, uploadFailure, type UploadPhase } from "@/server/files/upload-result";
import { spoolMultipartUpload, type MultipartUpload } from "@/server/files/multipart-upload";
import type { createLogisticsDocumentService } from "./documents";

type HttpDependencies = { authorize: () => Promise<string>; service: ReturnType<typeof createLogisticsDocumentService> };
const privateHeaders = { "Cache-Control": "private, no-store", "Vary": "Cookie, Authorization", "X-Content-Type-Options": "nosniff" };

export async function uploadLogisticsDocumentResponse(request: Request, dependencies: HttpDependencies) {
  const requestId = randomUUID();
  let phase: UploadPhase = "auth";
  let upload: MultipartUpload | undefined;
  try {
    const actorId = await dependencies.authorize();
    phase = "request";
    upload = await spoolMultipartUpload(request, { onFileField: () => {
      throw new UploadError("LOGISTICS_DOCUMENT_INVALID", 422, "request", "Выберите ТТН и отметьте одну или две печати", "validation");
    } });
    const file = upload.file, { clientMutationId: mutation, tripId, stage } = upload.fields;
    const ttnNumber = upload.fields.ttnNumber ?? null;
    if (typeof mutation !== "string" || typeof tripId !== "string" ||
      (stage !== "ISSUED" && stage !== "SIGNED"))
      throw new UploadError("LOGISTICS_DOCUMENT_INVALID", 422, "request", "Выберите ТТН и отметьте одну или две печати", "validation");
    const mimeType = file.type || "application/octet-stream";
    const result = await dependencies.service.upload(actorId, { tripId, clientMutationId: mutation, stage,
      ttnNumber, fileName: file.name, mimeType, bytes: file }, { onPhase: next => { phase = next; } });
    return Response.json({ ok: true, ...result, requestId }, { status: result.repeated ? 200 : 201, headers: privateHeaders });
  } catch (error) {
    const failedPhase = phase as UploadPhase;
    const failureError = error instanceof UploadError && ["UPLOAD_MULTIPART_INVALID", "UPLOAD_DUPLICATE_FIELD"].includes(error.code)
      ? new UploadError("LOGISTICS_DOCUMENT_INVALID", 422, "request", "Выберите ТТН и отметьте одну или две печати", "validation")
      : error instanceof UploadError && ["UPLOAD_FILE_TOO_LARGE", "UPLOAD_MULTIPART_LIMIT"].includes(error.code)
        ? new UploadError("LOGISTICS_DOCUMENT_TOO_LARGE", 413, "validation", error.message, "validation") : error;
    const failure = uploadFailure(requestId, failedPhase, failureError, failedPhase === "persist" ? "unknown" : "notCommitted");
    return Response.json(failure.body, { status: failure.status, headers: privateHeaders });
  } finally {
    await upload?.dispose();
  }
}

export async function readLogisticsDocumentResponse(request: Request, id: string, dependencies: HttpDependencies) {
  try {
    const actorId = await dependencies.authorize();
    const result = await dependencies.service.read(actorId, id);
    if (!result) return Response.json({ error: "ТТН не найдена" }, { status: 404, headers: privateHeaders });
    const file = result.document;
    return new Response(result.body, { headers: privateFileHeaders({ mimeType: file.mimeType,
      fileName: file.fileName, size: file.size, vary: "Cookie, Authorization",
      inline: new URL(request.url).searchParams.get("view") === "1" ? "raster-or-pdf" : "raster" }) });
  } catch (error) {
    return Response.json({ error: error instanceof UploadError ? error.message : "Не удалось открыть ТТН" },
      { status: error instanceof UploadError ? error.status : 503, headers: privateHeaders });
  }
}
