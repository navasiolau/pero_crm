import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeListPreference, type ListSection } from "../src/lib/list-state";
import { createListPreferenceService, type ListPreferenceStore } from "../src/server/list-preference-service";

function fixture() {
  const rows = new Map<string, string>();
  let user: string | null = "alice";
  let revision = 0;
  const store: ListPreferenceStore = {
    async get(userId, key) { return rows.get(`${userId}/${key}`) ?? null; },
    async compareAndSwap(userId, key, expected, value) {
      const id = `${userId}/${key}`;
      if ((rows.get(id) ?? null) !== expected) return false;
      rows.set(id, value);
      return true;
    },
  };
  const service = createListPreferenceService({ sessionUser: async () => user, store, revision: () => String(++revision) });
  return { service, rows, login: (id: string | null) => { user = id; } };
}

test("authenticated preference survives returning and remains separate per section and user", async () => {
  const f = fixture();
  assert.equal((await f.service.save("projects", "view=table&q=Alice", null)).ok, true);
  assert.equal((await f.service.save("products", "view=table&engineer=e1", null)).ok, true);
  assert.equal(new URLSearchParams((await f.service.load("projects", {})).query).get("q"), "Alice");
  assert.equal(new URLSearchParams((await f.service.load("products", {})).query).get("engineer"), "e1");
  f.login("bob");
  assert.equal((await f.service.load("projects", {})).query, "view=kanban");
  await f.service.save("projects", "q=Bob", null);
  f.login("alice");
  assert.equal(new URLSearchParams((await f.service.load("projects", {})).query).get("q"), "Alice");
  assert.equal(f.rows.size, 3);
});

test("unauthenticated read/write is rejected without changing any preference", async () => {
  const f = fixture();
  f.login(null);
  await assert.rejects(f.service.save("projects", "q=other", null), /авторизован/);
  await assert.rejects(f.service.load("projects", {}), /авторизован/);
  assert.equal(f.rows.size, 0);
});

test("stale concurrent save fails, returning current version without overwriting reset", async () => {
  const f = fixture();
  const old = await f.service.save("products", "q=old&page=3", null);
  const reset = await f.service.save("products", "view=kanban", old.value);
  const late = await f.service.save("products", "q=stale", old.value);
  assert.equal(late.ok, false);
  assert.equal(late.value, reset.value);
  assert.equal(decodeListPreference("products", late.value), "view=kanban");
});

test("load never writes, including explicit URLs and framework prefetches", async () => {
  const f = fixture();
  await f.service.save("projects", "view=table&q=old", null);
  const before = [...f.rows];
  assert.equal((await f.service.load("projects", { engineer: "new" })).query, "view=kanban&engineer=new");
  assert.deepEqual([...f.rows], before);
});

test("new reset overrides the previous view preference and persists after sign in", async () => {
  const f = fixture();
  f.rows.set("alice/projects.view", "table");
  assert.equal((await f.service.load("projects", {})).query, "view=table");
  await f.service.save("projects", "view=kanban", null);
  f.login("bob");
  f.login("alice");
  assert.equal((await f.service.load("projects", {})).query, "view=kanban");
});

test("server restricts writable sections and ignores attempts to name a different owner", async () => {
  const f = fixture();
  await assert.rejects(f.service.save("other" as ListSection, "q=bad", null), /раздел/);
  await f.service.save("products", "userId=bob&engineer=e1", null);
  assert.equal(f.rows.size, 1);
  const saved = f.rows.get("alice/products.list") ?? null;
  assert.equal(decodeListPreference("products", saved), "view=kanban&engineer=e1");
});
