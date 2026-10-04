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

test("old stored empty arrays remove only their axes and retain raw CAS across V1 and V2", async () => {
  for (const version of [1, 2]) {
    const f = fixture();
    const raw = JSON.stringify({ version, revision: "old", query: new URLSearchParams({ client: "[]", engineer: '["e1"]', stage: '["IN_WORK"]', manager: "[]" }).toString() });
    f.rows.set("alice/projects.list", raw);
    const loaded = await f.service.load("projects", {});
    assert.equal(loaded.value, raw);
    const params = new URLSearchParams(loaded.query);
    assert.equal(params.get("client"), null);
    assert.equal(params.get("manager"), null);
    assert.equal(params.get("engineer"), '["e1"]');
    assert.equal(params.get("stage"), '["IN_WORK"]');
    assert.equal(params.get("active"), version === 1 ? "1" : null);
    const saved = await f.service.save("projects", loaded.query, loaded.value);
    assert.equal(saved.ok, true);
    assert.equal(JSON.parse(saved.value!).version, 2);
  }
});

test("V1 load preserves its raw CAS token and upgrade saves V2 without expiry", async () => {
  const f = fixture();
  const raw = '{ "version": 1, "revision": "2000-old", "query": "view=table&client=c1" }';
  f.rows.set("alice/projects.list", raw);
  const loaded = await f.service.load("projects", {});
  assert.equal(loaded.value, raw);
  assert.equal(new URLSearchParams(loaded.query).get("active"), "1");
  const choice = new URLSearchParams({ view: "table", client: '["c1","c2","c3","c4","c5"]', engineer: '["e1","e2"]' }).toString();
  const saved = await f.service.save("projects", choice, loaded.value);
  assert.equal(saved.ok, true);
  assert.equal(JSON.parse(saved.value!).version, 2);
  const late = await f.service.save("projects", "client=c3", raw);
  assert.equal(late.ok, false);
  assert.equal(late.value, saved.value);
  f.login(null); f.login("alice");
  assert.equal((await f.service.load("projects", {})).value, saved.value);
  assert.equal(new URLSearchParams((await f.service.load("projects", {})).query).get("engineer"), '["e1","e2"]');
});

test("large project selections fit bounded save and subsequent raw CAS while products retain bounds", async () => {
  const f = fixture();
  const clients = Array.from({ length: 150 }, (_, index) => `client-${index}-${"x".repeat(20)}`);
  const query = new URLSearchParams({ client: JSON.stringify(clients) }).toString();
  assert.ok(query.length > 4096);
  const saved = await f.service.save("projects", query, null);
  assert.equal(saved.ok, true);
  assert.equal(JSON.parse(new URLSearchParams(decodeListPreference("projects", saved.value)!).get("client")!).length, clients.length);
  assert.equal((await f.service.save("projects", "client=[]", saved.value)).ok, true);
  await assert.rejects(f.service.save("products", query, null), /параметры/);
  await assert.rejects(f.service.save("projects", "x".repeat(16_385), null), /параметры/);
  const oversized = new URLSearchParams({ client: JSON.stringify(Array.from({ length: 150 }, (_, index) => `${index}${"я".repeat(40)}`)) }).toString();
  const before = [...f.rows];
  await assert.rejects(f.service.save("projects", oversized, saved.value), /параметры/);
  const expands = `client=${JSON.stringify(Array.from({ length: 150 }, (_, index) => `${index}${"я".repeat(40)}`))}`;
  assert.ok(expands.length < 16_384);
  await assert.rejects(f.service.save("projects", expands, saved.value), /параметры/);
  assert.deepEqual([...f.rows], before);
});

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
  assert.equal(new URLSearchParams((await f.service.load("projects", { engineer: "new" })).query).get("engineer"), '["new"]');
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
