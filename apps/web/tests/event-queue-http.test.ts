import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { after, beforeEach, test } from "node:test";

const require = createRequire(import.meta.url), original = new Map<string, NodeModule | undefined>();
function inject(specifier: string, exports: Record<string, unknown>) {
  const filename = require.resolve(specifier), stub = new Module(filename); original.set(filename, require.cache[filename]);
  stub.filename = filename; stub.loaded = true; stub.exports = exports; require.cache[filename] = stub;
}
let authorized = false, reads = 0, dispatches = 0, failed = false;
inject("../src/server/api/auth", { authenticate: async (_request: Request, scope: string) => {
  assert.equal(scope, "write"); return authorized ? { token: "memory-only" } : Response.json({ error: "Не авторизован" }, { status: 401 });
}, isErrorResponse: (value: unknown) => value instanceof Response });
inject("../src/server/plugins/events", { dispatchPendingEvents: async () => { dispatches++; return 5; },
  readEventQueueStats: async () => { reads++; if (failed) throw Error("private storage token"); return { ready: 2, active: 1, exhausted: 3, oldestPendingAgeMs: 42 }; } });
inject("../src/server/plugins/event-worker", { domainEventWorkerStatus: () => ({ enabled: false, started: false, running: false, lastTickAt: null, lastCount: null }) });
const routeFile = require.resolve("../src/app/api/v1/events/dispatch/route"); original.set(routeFile, require.cache[routeFile]);
const route = require(routeFile) as typeof import("../src/app/api/v1/events/dispatch/route");
const request = () => new Request("http://example.invalid/api/v1/events/dispatch");
beforeEach(() => { authorized = false; reads = 0; dispatches = 0; failed = false; });
after(() => { for (const [filename, value] of original) { if (value) require.cache[filename] = value; else delete require.cache[filename]; } });

test("GET/POST enforce Bearer write scope before any queue read or dispatch", async () => {
  assert.equal((await route.GET(request())).status, 401); assert.equal((await route.POST(request())).status, 401);
  assert.equal(reads, 0); assert.equal(dispatches, 0);
});
test("diagnostics expose only aggregates and existing POST keeps count contract", async () => {
  authorized = true;
  const response = await route.GET(request()); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("vary"), "Authorization");
  const body = await response.json(); assert.deepEqual(body.queue, { ready: 2, active: 1, exhausted: 3, oldestPendingAgeMs: 42 });
  assert.deepEqual(Object.keys(body).sort(), ["ok", "queue", "worker"]);
  assert.deepEqual(await (await route.POST(request())).json(), { ok: true, dispatched: 5 });
});
test("unavailable diagnostics never echo storage paths or secrets", async () => {
  authorized = true; failed = true;
  const response = await route.GET(request()); assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("private"));
});