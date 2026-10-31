import { z } from "zod";
import { apiChangeClient } from "./api-contract";
import { KP_API_SCOPES, type KpApiScope } from "@/lib/kp-api-scopes";
import { apiCreateDocument, apiFailure, apiGenerateContract, apiId, apiOperationId, apiRateQuery, apiRelease,
  apiRestore, apiRevision, apiSaveContract, apiSaveDocument, KpApiError, parseApi,
  type ApiAction, type ApiBinary, type KpApiContext, type KpApiService } from "./api-contract";
import { readKpJson, readKpUpload } from "./api-body";
import { reportKpApiError } from "./api-error-report";
import type { PdfStreamReply } from "./pdf-io";

type Match = { action: ApiAction; scope: KpApiScope | readonly KpApiScope[]; values: Record<string, unknown>; body?: "json" | "upload" };
const id = (value: string) => parseApi(apiId, value);
function match(method: string, path: readonly string[], query: URLSearchParams): Match {
  const [head, key, child, detail, last] = path;
  const read: readonly KpApiScope[] = ["kp:read", "kp:contracts:read"];
  if (path.length > 6) return apiFailure("KP_NOT_FOUND", 404, "Маршрут КП не найден");
  if (head === "documents") {
    if (path.length === 1 && method === "GET") return { action: "listDocuments", scope: "kp:read", values: queryValues(query, ["q", "cursor", "limit"]) };
    if (path.length === 1 && method === "POST") return { action: "createDocument", scope: "kp:write", values: {}, body: "json" };
    if (key) id(key);
    if (path.length === 2 && method === "GET") return { action: "getDocument", scope: "kp:read", values: { proposalId: key } };
    if (path.length === 2 && method === "PUT") return { action: "saveDocument", scope: "kp:write", values: { proposalId: key }, body: "json" };
    if (path.length === 3 && child === "client" && method === "PATCH") return { action: "changeClient", scope: "kp:write", values: { proposalId: key }, body: "json" };
    if (path.length === 3 && child === "pdf" && method === "POST") return { action: "pdf", scope: "kp:export", values: { proposalId: key }, body: "json" };
    if (child === "media") {
      if (path.length === 3 && method === "POST") return { action: "upload", scope: "kp:media:write", values: { proposalId: key }, body: "upload" };
      if (path.length === 4 && method === "GET") return { action: "readMedia", scope: "kp:read", values: { proposalId: key, mediaId: id(detail), ...queryValues(query, ["variant", "scope", "versionId"]) } };
    }
    if (child === "versions") {
      if (path.length === 3 && method === "GET") return { action: "listVersions", scope: "kp:read", values: { proposalId: key } };
      if (path.length === 4 && method === "GET") return { action: "getVersion", scope: "kp:read", values: { proposalId: key, versionId: id(detail) } };
      if (path.length === 5 && last === "restore" && method === "POST") return { action: "restoreVersion", scope: "kp:write", values: { proposalId: key, versionId: id(detail) }, body: "json" };
    }
  }
  if (head === "uploads" && path.length === 1 && method === "POST") return { action: "upload", scope: "kp:media:write", values: {}, body: "upload" };
  if (head === "operations" && path.length === 2 && method === "GET") return { action: "readOperation", scope: KP_API_SCOPES, values: { operationId: parseApi(apiOperationId, key) } };
  if (head === "jobs" && path.length === 2 && method === "GET") return { action: "getJob", scope: read, values: { jobId: id(key) } };
  if (head === "artifacts" && (path.length === 2 || path.length === 3 && child === "download") && method === "GET") return { action: "readArtifact", scope: read, values: { artifactId: id(key) } };
  if (head === "clients") {
    if (path.length === 1 && method === "GET") return { action: "listClients", scope: "kp:read", values: queryValues(query, ["q", "limit"]) };
    if (path.length === 1 && method === "POST") return { action: "createClient", scope: "kp:write", values: {}, body: "json" };
    if (path.length === 2 && method === "GET") return { action: "getClient", scope: "kp:read", values: { clientId: id(key) } };
  }
  if (head === "rates" && path.length === 1 && method === "GET") return { action: "rates", scope: "kp:read", values: queryValues(query, ["currency", "date"]) };
  if (head === "contracts") {
    if (path.length === 2 && key === "history" && method === "GET") return { action: "contractHistory", scope: "kp:contracts:read", values: { documentId: id(queryValues(query, ["documentId"]).documentId ?? "") } };
    if (path.length === 3 && child === "versions" && method === "GET") return { action: "contractHistory", scope: "kp:contracts:read", values: { documentId: id(key) } };
    if (path.length === 1 && method === "GET") return { action: "getContract", scope: "kp:contracts:read", values: { documentId: id(queryValues(query, ["documentId"]).documentId ?? "") } };
    if (path.length === 2 && method === "GET") return { action: "getContract", scope: "kp:contracts:read", values: { documentId: id(key) } };
    if ((path.length === 1 || path.length === 2) && method === "PUT") return { action: "saveContract", scope: "kp:contracts:write", values: path.length === 2 ? { documentId: id(key) } : {}, body: "json" };
    if (path.length === 3 && child === "generate" && method === "POST") return { action: "generateContract", scope: "kp:contracts:generate", values: { documentId: id(key) }, body: "json" };
  }
  if (head === "contract" && path.length === 1 && method === "POST") return { action: "generateContract", scope: "kp:contracts:generate", values: {}, body: "json" };
  return apiFailure("KP_NOT_FOUND", 404, "Маршрут или метод КП не поддерживается");
}
function queryValues(query: URLSearchParams, allowed: readonly string[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of query) {
    if (!allowed.includes(key) || key in output || value.length > 500) return apiFailure("KP_QUERY_INVALID", 400, "Некорректные параметры запроса");
    output[key] = value;
  }
  return output;
}
function command(action: ApiAction, body: unknown, values: Record<string, unknown>) {
  if (action === "changeClient") return { ...parseApi(apiChangeClient, body), ...values };
  if (action === "createDocument") return parseApi(apiCreateDocument, body);
  if (action === "saveDocument" || action === "pdf") {
    const parsed = action === "saveDocument" ? parseApi(apiSaveDocument, body) : parseApi(apiRelease, body);
    if (parsed.proposalId !== undefined && parsed.proposalId !== values.proposalId) return apiFailure("KP_ID_MISMATCH", 400, "ID КП не совпал с адресом");
    return { ...parsed, ...values };
  }
  if (action === "restoreVersion") return { ...parseApi(apiRestore, body), ...values };
  if (action === "saveContract" || action === "generateContract") {
    const candidate = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    if (values.documentId !== undefined && candidate.documentId !== undefined && candidate.documentId !== values.documentId)
      return apiFailure("KP_ID_MISMATCH", 400, "ID договора не совпал с адресом");
    const input = { ...candidate, ...values };
    return action === "saveContract" ? parseApi(apiSaveContract, input) : parseApi(apiGenerateContract, input);
  }
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : apiFailure("KP_REQUEST_INVALID", 400, "Нужен объект запроса");
}
const headers = { "cache-control": "private, no-store, max-age=0", vary: "Cookie, Authorization", "x-content-type-options": "nosniff" };
function binary(value: unknown): value is ApiBinary | PdfStreamReply {
  return value !== null && typeof value === "object" && "fileName" in value && "mimeType" in value &&
    ("bytes" in value && value.bytes instanceof Uint8Array || "body" in value && value.body instanceof ReadableStream && "size" in value && Number.isSafeInteger(value.size));
}
function reply(value: unknown, base: string): Response {
  if (binary(value)) {
    const safeName = value.fileName.replace(/[\r\n\u0000-\u001f\u007f]/g, "").slice(0, 200);
    const ascii = safeName.replace(/[^\x20-\x7e]|["\\]/g, "_") || "document";
    return new Response("body" in value ? value.body : new Uint8Array(value.bytes), { headers: { ...headers, "content-type": value.mimeType,
      "content-length": String("body" in value ? value.size : value.bytes.byteLength), "content-disposition": `${value.disposition ?? "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safeName).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}` } });
  }
  // URL строится на границе HTTP, а в receipts остаётся только private artifact ID.
  const json = JSON.parse(JSON.stringify(value)) as unknown;
  const decorate = (entry: unknown): void => {
    if (!entry || typeof entry !== "object") return;
    if (Array.isArray(entry)) return;
    const object = entry as Record<string, unknown>;
    if (typeof object.operationId === "string" && typeof object.kind === "string") { decorate(object.result); return; }
    const result = object.result;
    if (typeof object.id === "string" && ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED"].includes(String(object.state)) &&
      result && typeof result === "object" && !Array.isArray(result)) {
      const artifact = result as Record<string, unknown>;
      if (typeof artifact.artifactId === "string" && typeof artifact.mimeType === "string")
        artifact.downloadUrl = `${base}/artifacts/${encodeURIComponent(artifact.artifactId)}/download`;
    }
  };
  decorate(json); return Response.json(json, { headers });
}
export function createKpApiHandler(dependencies: {
  enabled(): boolean;
  authorize(request: Request, surface: "session" | "bearer", scope: KpApiScope | readonly KpApiScope[]): Promise<KpApiContext>;
  service: KpApiService;
}) {
  return async (request: Request, path: readonly string[], surface: "session" | "bearer"): Promise<Response> => {
    let action: ApiAction | undefined;
    try {
      if (!dependencies.enabled()) return apiFailure("KP_NOT_FOUND", 404, "Раздел КП недоступен");
      const route = match(request.method, path, new URL(request.url).searchParams);
      action = route.action;
      const context = Object.assign(await dependencies.authorize(request, surface, route.scope), { signal: request.signal });
      let input = route.values;
      if (route.body === "json") input = command(route.action, await readKpJson(request, { documentState: route.action === "createDocument" || route.action === "saveDocument" }), route.values);
      if (route.body === "upload") {
        const body = await readKpUpload(request);
        const proposalId = route.values.proposalId ?? body.proposalId;
        if (route.values.proposalId && body.proposalId && route.values.proposalId !== body.proposalId) return apiFailure("KP_ID_MISMATCH", 400, "ID КП не совпал");
        input = { ...body, proposalId: parseApi(apiId, proposalId), operationId: parseApi(apiOperationId, body.operationId),
          expectedRevision: parseApi(apiRevision, typeof body.expectedRevision === "string" && /^\d+$/.test(body.expectedRevision) ? Number(body.expectedRevision) : body.expectedRevision) };
      }
      if (route.action === "rates") input = parseApi(apiRateQuery, input);
      return reply(await dependencies.service.execute(route.action, context, input), surface === "session" ? "/api/kp" : "/api/v1/kp");
    } catch (error) {
      if (error instanceof KpApiError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
      if (error instanceof z.ZodError) return Response.json({ error: { code: "KP_REQUEST_INVALID", message: error.issues[0]?.message ?? "Проверьте запрос" } }, { status: 400, headers });
      reportKpApiError(error, action, surface);
      // В ответе нет SQL, storage key/binding, секретов либо внутренних stack traces.
      return Response.json({ error: { code: "KP_UNAVAILABLE", message: "Операция КП не подтверждена. Проверьте результат по UUID" } }, { status: 503, headers });
    }
  };
}
