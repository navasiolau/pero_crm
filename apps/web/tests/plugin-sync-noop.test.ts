import assert from "node:assert/strict";
import test from "node:test";
import { syncPluginMetadata, type PluginSyncStore } from "../src/server/plugins/sync-core";

const manifest = { id: "file-stages", name: "File stages", version: "1.2.3", apiVersion: 1,
  description: "Groups project files by production stage", permissions: ["files:read"] };
const { id, ...metadata } = manifest;
test("plugin metadata no-op avoids writes; changed and missing metadata write the exact projection", async () => {
  for (const current of [metadata, { ...metadata, version: "1.2.2" }, null]) {
    const calls: Parameters<PluginSyncStore["upsert"]>[0][] = [];
    let reads = 0;
    const store: PluginSyncStore = {
      async findUnique(input) {
        reads++; assert.deepEqual(input, { where: { id }, select: { name: true, version: true, apiVersion: true, description: true, permissions: true } });
        return current;
      },
      async upsert(input) { calls.push(input); },
    };
    const result = await syncPluginMetadata(store, manifest); assert.equal(reads, 1);
    assert.equal(result, current === metadata ? "unchanged" : current ? "updated" : "created");
    assert.deepEqual(calls, current === metadata ? [] : [{ where: { id }, create: manifest, update: metadata }]);
  }
});
