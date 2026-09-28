import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
const require = createRequire(import.meta.url);
let reads = 0;
let actions: typeof import("../src/server/product-stage-pay/actions");
function inject(path: string, exports: Record<string, unknown>) {
  const filename = require.resolve(path), stub = new Module(filename); stub.exports = exports; stub.filename = filename; stub.loaded = true; require.cache[filename] = stub;
}
before(() => {
  (globalThis as { prisma?: PrismaClient }).prisma = new Proxy({}, { get: () => { reads++; throw new Error("Database read before permission check"); } }) as PrismaClient;
  inject("../src/auth", { auth: async () => ({ user: { id: "worker", name: "Worker", roles: ["WORKER"] } }) });
  inject("../src/server/products/revalidate", { revalidateProductPaths: async () => {} });
  inject("../src/server/plugins/events", { dispatchEvent: async () => {} });
  actions = require("../src/server/product-stage-pay/actions");
});
test("a non-manager cannot trigger product reads or FX preparation through close server action", async () => {
  reads = 0; let message: string | undefined;
  try {
    const result = await actions.closeEngineeringStageAction({ productId: "foreign", expectedPoolRevision: 0, requestId: "00000000-0000-4000-8000-000000000000" });
    if (!result.ok) message = result.error;
  } catch (error) { message = error instanceof Error ? error.message : undefined; }
  assert.equal(message, "Недостаточно прав"); assert.equal(reads, 0);
});
