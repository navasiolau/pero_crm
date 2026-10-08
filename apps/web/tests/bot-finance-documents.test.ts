import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, Module } from "node:module";
import { NextResponse } from "next/server";
const require = createRequire(import.meta.url);
function inject(name: string, exports: Record<string, unknown>) {
  const file = require.resolve(name), stub = new Module(file); stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub;
}
let authorized = false, financial = false, actorRead = 0, uploads = 0;
inject("../src/server/api/auth", {
  authenticate: async (_request: Request, scope: string) => { assert.equal(scope, "write"); return authorized ? { id: "service" } : NextResponse.json({}, { status: 401 }); },
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
});
inject("../src/server/telegram/bot-api", {
  resolveBotActor: async () => { actorRead++; return { id: "actor" }; }, isActorError: () => false,
  requireBotFinance: () => financial ? null : NextResponse.json({}, { status: 403 }),
});
inject("../src/server/finance-documents/service", { financeDocuments: {} });
inject("../src/server/finance-documents/http", { uploadFinanceDocumentResponse: async (_request: Request, dependencies: { authorize: () => Promise<string>; source: string }) => {
  assert.equal(await dependencies.authorize(), "actor"); assert.equal(dependencies.source, "telegram"); uploads++; return Response.json({ ok: true });
} });
const { POST } = require("../src/app/api/v1/bot/documents/upload/route") as typeof import("../src/app/api/v1/bot/documents/upload/route");
test("bot document adapter checks token and finance actor before touching upload body", async () => {
  const request = new Request("https://qa.invalid/api/v1/bot/documents/upload", { method: "POST", body: "invalid multipart" });
  assert.equal((await POST(request)).status, 401); assert.equal(actorRead, 0); assert.equal(uploads, 0);
  authorized = true; assert.equal((await POST(request)).status, 403); assert.equal(uploads, 0);
  financial = true; assert.equal((await POST(request)).status, 200); assert.equal(uploads, 1);
});
