import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
function inject(specifier: string, exports: Record<string, unknown>) {
  const filename = require.resolve(specifier), stub = new Module(filename);
  stub.exports = exports; stub.filename = filename; stub.loaded = true; require.cache[filename] = stub;
}
let references = 1;
const calls: string[] = [];
let actions: typeof import("../src/server/files/actions");
before(() => {
  const file = { id: "sample", projectId: "project", productId: "product", storedName: "sample.png",
    fileName: "sample.png", hasThumb: false, uploadedById: "manager" };
  const db = {
    $queryRaw: async () => [{ locked: 1 }],
    task: { findMany: async () => [] },
    file: { findFirst: async () => file, delete: async () => { calls.push("metadata.delete"); return file; } },
    productCompositionFinish: { count: async () => { calls.push("sample.count"); return references; } },
    changeLog: { create: async () => { calls.push("audit.create"); return { id: "log" }; } },
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(db),
  };
  (globalThis as { prisma?: PrismaClient }).prisma = db as unknown as PrismaClient;
  inject("../src/auth", { auth: async () => ({ user: { id: "manager", name: "Manager", roles: ["MANAGER"] } }) });
  inject("next/cache", { revalidatePath: () => {} });
  inject("../src/server/products/revalidate", { revalidateProductPaths: async () => {} });
  inject("../src/lib/s3", { UPLOADS_ROOT: "not-used", s3Enabled: () => true,
    fileKey: () => "project/sample.png", thumbKey: () => "project/thumb/sample.png",
    s3Delete: async () => { calls.push("storage.delete"); } });
  actions = require("../src/server/files/actions");
});

test("confirmed or draft sample reference blocks metadata and storage deletion", async () => {
  references = 1; calls.length = 0;
  const result = await actions.deleteFile("sample");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /подтверждённых ревизий/);
  assert.deepEqual(calls, ["sample.count"]);
});

test("after last draft reference is removed, storage delete follows committed metadata", async () => {
  references = 0; calls.length = 0;
  assert.deepEqual(await actions.deleteFile("sample"), { ok: true });
  assert.deepEqual(calls, ["sample.count", "metadata.delete", "audit.create", "storage.delete"]);
});
