import assert from "node:assert/strict";
import test from "node:test";

import { syncPluginMetadata } from "../src/server/plugins/sync-core";

const manifest = {
  id: "file-stages",
  name: "File stages",
  version: "1.2.3",
  apiVersion: 1,
  description: "Groups project files by production stage",
  permissions: ["files:read"],
};

function storeWith(current: Record<string, unknown> | null) {
  const calls = { findUnique: 0, upsert: [] as unknown[] };
  const store = {
    async findUnique() {
      calls.findUnique += 1;
      return current;
    },
    async upsert(args: unknown) {
      calls.upsert.push(args);
    },
  };
  return { calls, store };
}

test("unchanged plugin metadata is a no-op and does not refresh updatedAt", async () => {
  const { calls, store } = storeWith({
    name: manifest.name,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    description: manifest.description,
    permissions: [...manifest.permissions],
  });

  const result = await syncPluginMetadata(store as never, manifest);

  assert.equal(result, "unchanged");
  assert.equal(calls.findUnique, 1);
  assert.equal(calls.upsert.length, 0);
});

test("changed plugin metadata is persisted", async () => {
  const { calls, store } = storeWith({
    name: manifest.name,
    version: "1.2.2",
    apiVersion: manifest.apiVersion,
    description: manifest.description,
    permissions: [...manifest.permissions],
  });

  const result = await syncPluginMetadata(store as never, manifest);

  assert.equal(result, "updated");
  assert.equal(calls.upsert.length, 1);
});

test("missing plugin is created", async () => {
  const { calls, store } = storeWith(null);

  const result = await syncPluginMetadata(store as never, manifest);

  assert.equal(result, "created");
  assert.equal(calls.upsert.length, 1);
});
