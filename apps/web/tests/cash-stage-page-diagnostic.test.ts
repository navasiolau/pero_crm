import assert from "node:assert/strict";
import { test } from "node:test";
import { validateStagePageRequest } from "./cash-stage-page-diagnostic.mjs";

const origin = "https://staging-crm.peromebel.by";
test("stage page diagnosis permits only fixed same-origin GET routes and static assets", () => {
  assert.deepEqual(validateStagePageRequest({ url: `${origin}/advances`, method: "GET" }),
    { kind: "continue", path: "/advances" });
  assert.deepEqual(validateStagePageRequest({ url: `${origin}/api/auth/session`, method: "GET" }),
    { kind: "continue", path: "/api/auth/session" });
  assert.deepEqual(validateStagePageRequest({ url: `${origin}/_next/static/chunk.js`, method: "GET" }),
    { kind: "continue", path: "/_next/static/chunk.js" });
  assert.throws(() => validateStagePageRequest({ url: "https://crm.peromebel.by/advances", method: "GET" }),
    /PAGE_DIAGNOSTIC_CROSS_ORIGIN_FORBIDDEN/);
  assert.throws(() => validateStagePageRequest({ url: `${origin}/finance/payroll`, method: "GET" }),
    /PAGE_DIAGNOSTIC_GET_FORBIDDEN/);
});

test("every POST is blocked regardless of Next-Action, including the known issue UUID", () => {
  assert.deepEqual(validateStagePageRequest({ url: `${origin}/advances`, method: "POST",
    headers: { "next-action": "money-action" } }), { kind: "abort-write", path: "/advances" });
  assert.deepEqual(validateStagePageRequest({ url: `${origin}/api/auth/session`, method: "POST" }),
    { kind: "abort-write", path: "/api/auth/session" });
  assert.deepEqual(validateStagePageRequest({ url: `${origin}/advances`, method: "GET",
    headers: { "next-router-prefetch": "1" } }), { kind: "abort-prefetch" });
});
