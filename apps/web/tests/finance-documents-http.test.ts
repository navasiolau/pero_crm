import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { uploadFinanceDocumentResponse, readFinanceDocumentResponse } from "../src/server/finance-documents/http";
import { UploadError } from "../src/server/files/upload-result";
import { getViewableFileSource } from "../src/lib/viewable-file";
import type { createFinanceDocumentService } from "../src/server/finance-documents/core";
import type { FinanceDocumentView } from "../src/server/finance-documents/contracts";
import { multipartRequest } from "./helpers/multipart-request";

const document: FinanceDocumentView = { id: randomUUID(), source: "finance", fileName: "Чек.pdf", mimeType: "application/pdf", size: 4, createdAt: new Date().toISOString(), paymentId: null };
function dependencies() {
  let calls = 0;
  const service: ReturnType<typeof createFinanceDocumentService> = {
    async upload(actorId, input) {
      calls++; assert.equal(actorId, "actor"); assert.equal(input.fileName, "Чек.pdf");
      assert.equal(Buffer.isBuffer(input.bytes), false);
      if (Buffer.isBuffer(input.bytes)) throw Error("FULL_DOCUMENT_BUFFER");
      assert.equal(input.bytes.size, 4); assert.equal(input.bytes.contentHash, createHash("sha256").update("%PDF").digest("hex"));
      const parts: Buffer[] = []; for await (const chunk of await input.bytes.openRead()) parts.push(Buffer.from(chunk));
      assert.equal(Buffer.concat(parts).toString(), "%PDF");
      return { document, repeated: false };
    },
    async read() { return { document, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("%PDF")); controller.close(); } }) }; },
    async list() { return { rows: [document], total: 1, query: { page: 1, pageSize: 20, query: "", sort: "createdAt", direction: "desc" } }; },
  };
  return { service, authorize: async () => "actor", get calls() { return calls; } };
}

test("upload rejects unauthorized requests before reading multipart", async () => {
  const f = dependencies();
  const response = await uploadFinanceDocumentResponse(new Request("http://localhost/api/finance/documents/upload", { method: "POST", body: "not multipart" }), {
    ...f, authorize: async () => { throw new UploadError("FORBIDDEN", 403, "auth", "Недостаточно прав"); },
  });
  assert.equal(response.status, 403); assert.equal(f.calls, 0);
});

test("multipart adapter forwards guarded stream and returns confirmed financial view", async () => {
  const f = dependencies(), request = multipartRequest({ file: new File(["%PDF"], "Чек.pdf", { type: "application/pdf" }), clientMutationId: randomUUID() }, { chunkBytes: 1 });
  request.formData = async () => { throw Error("FULL_FORM_DATA"); }; request.arrayBuffer = async () => { throw Error("FULL_REQUEST_BUFFER"); };
  const response = await uploadFinanceDocumentResponse(request, f);
  assert.equal(response.status, 201); assert.equal(f.calls, 1);
  const body = await response.json(); assert.deepEqual(body.document, document); assert.equal(body.ok, true);
});

test("financial PDF streams with private headers, view is explicit, and technical URLs stay compatible", async () => {
  const f = dependencies();
  const download = await readFinanceDocumentResponse(new Request("http://localhost/doc"), document.id, f);
  assert.match(download.headers.get("content-disposition")!, /^attachment/);
  const view = await readFinanceDocumentResponse(new Request("http://localhost/doc?view=1"), document.id, f);
  assert.match(view.headers.get("content-disposition")!, /^inline/);
  assert.equal(view.headers.get("cache-control"), "private, no-store");
  assert.equal(view.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await view.text(), "%PDF");
  assert.equal(getViewableFileSource(document), `/api/finance/documents/${document.id}`);
  assert.equal(getViewableFileSource({ ...document, source: undefined, id: "legacy/id" }), "/api/files/legacy/id");
});

test("storage failures do not leak storage credentials or paths", async () => {
  const f = dependencies();
  f.service.read = async () => { throw Error("s3://secret-access-key/private-path"); };
  const response = await readFinanceDocumentResponse(new Request("http://localhost/doc"), document.id, f);
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes("secret"));
});
