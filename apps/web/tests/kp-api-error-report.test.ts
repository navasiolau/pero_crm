import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { createKpApiHandler } from "../src/server/kp/api-router";
import { KpApiError, type KpApiContext } from "../src/server/kp/api-contract";

const secret = "SYNTHETIC_PRIVATE_CLIENT_AND_TOKEN";
const context: KpApiContext = {
  actor: { id: "private-owner", name: secret, roles: ["MANAGER"], source: "api" },
  binding: { id: "private-owner", source: "api", tokenId: "private-token-id" },
  authorize: async () => context.actor,
};
async function failedPdf(error: unknown) {
  const handler = createKpApiHandler({ enabled: () => true, authorize: async () => context,
    service: { execute: async () => { throw error; } } });
  return handler(new Request("https://crm.example.invalid/api/v1/kp/documents/private-document-id/pdf", {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ operationId: "550e8400-e29b-41d4-a716-446655440000", expectedRevision: 0 }),
  }), ["documents", "private-document-id", "pdf"], "bearer");
}

test("unexpected PDF 503 reports only closed Prisma fields and five static locations", async t => {
  const reports: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { reports.push(args); });
  const sql = `SELECT passport, '${secret}' FROM private_client`;
  const error = new Prisma.PrismaClientKnownRequestError(sql, {
    code: "P2010", clientVersion: "6.19.3", meta: { code: "23514", message: sql, params: [secret] },
  });
  error.stack = [
    `Error: ${sql} /app/apps/web/.next/server/chunks/999.js:1:1`,
    `    at ${secret} (/app/apps/web/.next/server/chunks/1234.js:1:20)`,
    "    at /app/apps/web/.next/server/app/api/v1/kp/[[...path]]/route.js:2:30",
    "    at render (/app/packages/kp-template/index.cjs:3:40)",
    "    at process.processTicksAndRejections (node:internal/process/task_queues:4:50)",
    "    at /app/apps/web/.next/server/webpack-runtime.js:5:60",
    "    at /app/packages/kp-template/limits.cjs:6:70",
  ].join("\n");
  const response = await failedPdf(error);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: "KP_UNAVAILABLE", message: "Операция КП не подтверждена. Проверьте результат по UUID" } });
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.deepEqual(reports, [["KP_API_UNEXPECTED", {
    action: "pdf", surface: "bearer", errorClass: "PrismaClientKnownRequestError", code: "P2010", sqlState: "23514",
    frames: ["/app/apps/web/.next/server/chunks/1234.js:1:20", "/app/apps/web/.next/server/app/api/v1/kp/[[...path]]/route.js:2:30",
      "/app/packages/kp-template/index.cjs:3:40", "node:internal/process/task_queues:4:50", "/app/apps/web/.next/server/webpack-runtime.js:5:60"],
  }]]);
  for (const forbidden of [secret, sql, "private-owner", "private-document-id", "private-token-id", "550e8400-e29b-41d4-a716-446655440000", "crm.example.invalid", "Bearer", "999.js", "limits.cjs"])
    assert.equal(JSON.stringify(reports).includes(forbidden), false, forbidden);
});

test("unknown names/codes and client, upload, URL, query and traversal stack paths are omitted", async t => {
  const reports: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { reports.push(args); });
  const error = Object.assign(new Error(secret), { name: secret, code: secret, sqlState: secret,
    meta: { code: secret, message: secret } });
  error.stack = [secret,
    `    at /app/uploads/${secret}.js:1:1`,
    `    at /app/apps/web/.next/server/uploads/${secret}.js:1:1`,
    `    at /app/packages/kp-template/uploads/${secret}.js:1:1`,
    `    at /app/apps/web/.next/server/chunks/123.js?token=${secret}:1:1`,
    `    at https://example.invalid/${secret}.js:1:1`,
    `    at file:///app/apps/web/.next/server/chunks/123.js:1:1`,
    `    at /app/apps/web/.next/server/chunks/../uploads/${secret}.js:1:1`,
    `    at C:\\uploads\\${secret}.js:1:1`,
  ].join("\n");
  assert.equal((await failedPdf(error)).status, 503);
  assert.deepEqual(reports, [["KP_API_UNEXPECTED", { action: "pdf", surface: "bearer", errorClass: "UnknownError", frames: [] }]]);
});

test("node codes and top-level PostgreSQL SQLSTATE remain useful without raw messages", async t => {
  const reports: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { reports.push(args); });
  const node = Object.assign(new TypeError(secret), { code: "ECONNRESET", stack: `${secret}\n    at node:internal/process/task_queues:10:20\n    at /app/apps/web/.next/server/app/api/kp/[...path]/route.js:2:30` });
  const postgres = Object.assign(new Error(secret), { name: "DatabaseError", code: "23505", stack: secret });
  const initialization = Object.assign(new Error(secret), { name: "PrismaClientInitializationError", errorCode: "P1001", stack: secret });
  for (const error of [node, postgres, initialization]) assert.equal((await failedPdf(error)).status, 503);
  assert.deepEqual(reports, [
    ["KP_API_UNEXPECTED", { action: "pdf", surface: "bearer", errorClass: "TypeError", code: "ECONNRESET", frames: ["node:internal/process/task_queues:10:20", "/app/apps/web/.next/server/app/api/kp/[...path]/route.js:2:30"] }],
    ["KP_API_UNEXPECTED", { action: "pdf", surface: "bearer", errorClass: "DatabaseError", sqlState: "23505", frames: [] }],
    ["KP_API_UNEXPECTED", { action: "pdf", surface: "bearer", errorClass: "PrismaClientInitializationError", code: "P1001", frames: [] }],
  ]);
});

test("expected KpApiError and Zod rejection do not emit server error reports", async t => {
  const reports: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { reports.push(args); });
  const validation = z.string().safeParse(42);
  assert.equal(validation.success, false);
  assert.equal((await failedPdf(new KpApiError("KP_REVISION_CONFLICT", 409, "КП изменено"))).status, 409);
  assert.equal((await failedPdf(validation.error)).status, 400);
  assert.deepEqual(reports, []);
});

test("a failing console or error accessor cannot change the generic 503 response", async t => {
  t.mock.method(console, "error", () => { throw new Error(secret); });
  assert.equal((await failedPdf(new Error(secret))).status, 503);
  const error = new Error(secret);
  Object.defineProperty(error, "name", { get() { throw new Error(secret); } });
  assert.equal((await failedPdf(error)).status, 503);
});
