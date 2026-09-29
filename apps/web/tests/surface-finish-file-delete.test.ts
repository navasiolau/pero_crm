import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { deleteFileMetadataCore } from "../src/server/files/delete-core";

test("used sample refuses metadata deletion before any storage operation", async () => {
  const calls: string[] = [];
  let references = 1;
  const tx = { productCompositionFinish: { count: async () => { calls.push("reference.count"); return references; } },
    file: { delete: async () => { calls.push("file.delete"); return { id: "sample", projectId: "project", productId: "product" }; } } } as unknown as Prisma.TransactionClient;
  await assert.rejects(deleteFileMetadataCore(tx, "sample"), /FILE_SAMPLE_IN_USE/);
  assert.deepEqual(calls, ["reference.count"]);
  references = 0;
  assert.equal((await deleteFileMetadataCore(tx, "sample")).id, "sample");
  assert.deepEqual(calls, ["reference.count", "reference.count", "file.delete"]);
});
