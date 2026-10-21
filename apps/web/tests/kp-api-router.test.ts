import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createKpApiHandler } from "../src/server/kp/api-router";
import { KpApiError, type ApiAction, type KpApiContext } from "../src/server/kp/api-contract";
import { KP_JSON_LIMIT } from "../src/server/kp/api-body";
import { authorizeKpResource, apiOperationScope } from "../src/server/kp/api-resource-policy";
import type { KpApiScope } from "../src/lib/kp-api-scopes";

const context: KpApiContext = { actor: { id: "owner", name: "Владелец", roles: ["MANAGER"], source: "api" },
  binding: { id: "owner", source: "api", tokenId: "key" }, authorize: async () => context.actor };
const request = (path: string, method = "GET", body?: unknown) => new Request(`https://crm.example.invalid/api/v1/kp/${path}`, {
  method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
});
function fixture() {
  let enabled = true, authorizations = 0;
  const calls: { action: ApiAction; input: Record<string, unknown> }[] = [];
  const handler = createKpApiHandler({ enabled: () => enabled, authorize: async () => { authorizations++; return context; },
    service: { execute: async (action, _context, input) => { calls.push({ action, input }); return { ok: true }; } } });
  return { handler, calls, disable: () => { enabled = false; }, authorizations: () => authorizations };
}
test("feature flag returns 404 before auth, body and service", async () => {
  const f = fixture(); f.disable();
  const response = await f.handler(request("documents", "POST", null), ["documents"], "bearer");
  assert.equal(response.status, 404); assert.equal(f.authorizations(), 0); assert.equal(f.calls.length, 0);
});
test("strict stored-PDF command refuses raw state and path mismatches", async () => {
  const f = fixture(); const input = { operationId: randomUUID(), expectedRevision: 2 };
  for (const body of [{ ...input, state: { items: [] } }, { ...input, proposalId: "other" }, { ...input, actorId: "admin" }]) {
    assert.equal((await f.handler(request("documents/qp/pdf", "POST", body), ["documents", "qp", "pdf"], "bearer")).status, 400);
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await f.handler(request("documents/qp/pdf", "POST", { ...input, proposalId: "qp" }), ["documents", "qp", "pdf"], "bearer")).status, 200);
  assert.deepEqual(f.calls[0], { action: "pdf", input: { ...input, proposalId: "qp" } });
});
test("canonical save and operation lookup normalize UUID without mutating state", async () => {
  const f = fixture(); const operationId = randomUUID(); const state = { items: [], custom: { artifactId: "do-not-rewrite", mimeType: "application/pdf" } };
  const response = await f.handler(request("documents/qp", "PUT", { operationId: operationId.toUpperCase(), expectedRevision: 0, proposalId: "qp", state }), ["documents", "qp"], "bearer");
  assert.equal(response.status, 200); assert.equal(f.calls[0].input.operationId, operationId); assert.deepEqual(f.calls[0].input.state, state);
  const plain = createKpApiHandler({ enabled: () => true, authorize: async () => context, service: { execute: async () => ({ id: "qp", revision: 0, state }) } });
  assert.deepEqual((await (await plain(request("documents/qp"), ["documents", "qp"], "bearer")).json()).state, state);
  await f.handler(request(`operations/${operationId.toUpperCase()}`), ["operations", operationId.toUpperCase()], "bearer");
  assert.equal(f.calls.at(-1)?.input.operationId, operationId);
});
test("actual stream limit is enforced with absent and dishonest Content-Length", async () => {
  for (const length of [null, "1"]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(KP_JSON_LIMIT + 1)); }, cancel() { cancelled = true; } });
    const f = fixture(); const req = new Request("https://crm.example.invalid/api/v1/kp/documents", { method: "POST", duplex: "half", body,
      headers: { "content-type": "application/json", ...(length ? { "content-length": length } : {}) } } as RequestInit & { duplex: "half" });
    assert.equal((await f.handler(req, ["documents"], "bearer")).status, 413); assert.equal(cancelled, true); assert.equal(f.calls.length, 0);
  }
});
test("authorization happens before body consumption and safe errors disclose no internals", async () => {
  let reads = 0; const body = new ReadableStream<Uint8Array>({ pull() { reads++; } }, { highWaterMark: 0 });
  const handler = createKpApiHandler({ enabled: () => true, authorize: async () => { throw new KpApiError("KP_AUTH_REQUIRED", 401, "Нужен ключ"); }, service: { execute: async () => { throw Error("unreachable"); } } });
  const req = new Request("https://crm.example.invalid/api/v1/kp/documents", { method: "POST", duplex: "half", body,
    headers: { "content-type": "application/json" } } as RequestInit & { duplex: "half" });
  assert.equal((await handler(req, ["documents"], "bearer")).status, 401); assert.equal(reads, 0);
  const failed = createKpApiHandler({ enabled: () => true, authorize: async () => context, service: { execute: async () => { throw Error("SECRET SQL S3_BUCKET credential"); } } });
  const response = await failed(request("documents/qp"), ["documents", "qp"], "bearer");
  assert.equal(response.status, 503); assert.equal((await response.text()).includes("SECRET"), false);
});
test("contract aliases keep primary document ID and reject unsaved generation settings", async () => {
  const f = fixture(); const input = { operationId: randomUUID(), expectedRevision: 0, documentId: "qp", clientBaseline: "a".repeat(64), sourceRefs: [{ proposalId: "qp", expectedRevision: 2 }] };
  assert.equal((await f.handler(request("contracts/qp/generate", "POST", input), ["contracts", "qp", "generate"], "bearer")).status, 200);
  assert.equal((await f.handler(request("contract", "POST", { ...input, settings: {} }), ["contract"], "bearer")).status, 400);
  assert.equal((await f.handler(request("contracts", "PUT", { ...input, settings: {} }), ["contracts"], "bearer")).status, 200);
  assert.deepEqual(f.calls.map(call => call.action), ["generateContract", "saveContract"]);
});
test("media upload accepts original/optimized pair only with captured revision and operation UUID", async () => {
  const f = fixture(); const form = new FormData(); form.set("file", new File(["image"], "image.png", { type: "image/png" }));
  form.set("optimized", new File(["jpeg"], "optimized.jpg", { type: "image/jpeg" })); form.set("operationId", randomUUID()); form.set("expectedRevision", "4");
  const req = new Request("https://crm.example.invalid/api/kp/documents/qp/media", { method: "POST", body: form });
  assert.equal((await f.handler(req, ["documents", "qp", "media"], "session")).status, 200);
  assert.equal(f.calls[0].action, "upload"); assert.equal(f.calls[0].input.expectedRevision, 4); assert.equal(f.calls[0].input.proposalId, "qp");
  assert.deepEqual(f.calls[0].input.original, Buffer.from("image")); assert.deepEqual(f.calls[0].input.optimized, Buffer.from("jpeg"));
});

test("canonical multipart documentId is accepted and conflicting proposalId alias is refused", async () => {
  const f = fixture();
  const form = () => { const body = new FormData(); body.set("file", new File(["image"], "image.png", { type: "image/png" }));
    body.set("optimized", new File(["jpeg"], "optimized.jpg", { type: "image/jpeg" })); body.set("documentId", "qp");
    body.set("operationId", randomUUID()); body.set("expectedRevision", "4"); return body; };
  const accepted = new Request("https://crm.example.invalid/api/v1/kp/uploads", { method: "POST", body: form() });
  assert.equal((await f.handler(accepted, ["uploads"], "bearer")).status, 200); assert.equal(f.calls[0].input.proposalId, "qp");
  const conflicting = form(); conflicting.set("proposalId", "other");
  assert.equal((await f.handler(new Request("https://crm.example.invalid/api/v1/kp/uploads", { method: "POST", body: conflicting }), ["uploads"], "bearer")).status, 400);
  assert.equal(f.calls.length, 1);
});
test("jobs and operation recovery receive fixed private download URLs while canonical state stays raw", async () => {
  const job = { id: "job", state: "SUCCEEDED", result: { artifactId: "artifact", versionId: "version", fileName: "КП_222.pdf", mimeType: "application/pdf" } };
  const handler = createKpApiHandler({ enabled: () => true, authorize: async () => context, service: { execute: async action => action === "readArtifact"
    ? { bytes: Buffer.from("%PDF-1.7"), fileName: job.result.fileName, mimeType: "application/pdf" }
    : { operationId: randomUUID(), kind: "pdf", result: job } } });
  const response = await handler(request(`operations/${randomUUID()}`), ["operations", randomUUID()], "bearer");
  assert.equal((await response.json()).result.result.downloadUrl, "/api/v1/kp/artifacts/artifact/download");
  assert.match(response.headers.get("cache-control")!, /no-store/); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const download = await handler(request("artifacts/artifact/download"), ["artifacts", "artifact", "download"], "bearer");
  assert.equal(download.status, 200);
  assert.equal(decodeURIComponent(download.headers.get("content-disposition")!.split("filename*=UTF-8''")[1]), "КП_222.pdf");
});

test("HTTP job/artifact/operation readers derive contract grants from persisted kind, never caller query", async () => {
  for (const granted of ["kp:read", "kp:contracts:read"] as KpApiScope[]) {
    const scoped: KpApiContext = { ...context, authorize: async scope => {
      if (scope !== granted) throw new KpApiError("KP_SCOPE_REQUIRED", 403, "Недостаточно прав"); return context.actor;
    } };
    const handler = createKpApiHandler({ enabled: () => true, authorize: async () => scoped,
      service: { execute: async (action, ctx, input) => {
        const kind = input.jobId === "pdf" || input.artifactId === "pdf" ? "PDF" : "CONTRACT";
        if (action === "readOperation") await ctx.authorize(apiOperationScope("contract.generate"));
        else await authorizeKpResource(ctx, kind);
        return { safe: true };
      } } });
    for (const head of ["jobs", "artifacts"]) {
      assert.equal((await handler(request(`${head}/contract?kind=PDF`), [head, "contract"], "bearer")).status, granted === "kp:contracts:read" ? 200 : 403);
      assert.equal((await handler(request(`${head}/pdf?kind=CONTRACT`), [head, "pdf"], "bearer")).status, granted === "kp:read" ? 200 : 403);
    }
    assert.equal((await handler(request(`operations/${randomUUID()}`), ["operations", randomUUID()], "bearer")).status, 403, "read scope cannot recover generate result");
  }
});
