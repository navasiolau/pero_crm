import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeListPreference, normalizeListQuery, resolveListState, updateListQuery } from "../src/lib/list-state";

const fields = (query: string) => Object.fromEntries(new URLSearchParams(query));

test("bare project route restores all saved filters, search, sorting, view and paging", () => {
  const query = "view=table&q=Кухня&stage=IN_WORK&client=c1&manager=m1&engineer=e1&active=0&sort=title&dir=asc&page=3&pageSize=50";
  const saved = encodeListPreference("projects", query, "one");
  assert.deepEqual(fields(resolveListState("projects", {}, saved)), fields(query));
});

test("bare product route restores its own full state, including project and engineer", () => {
  const query = "view=table&q=Шкаф&status=DESIGN&project=p1&client=c1&engineer=e1&active=0&sort=price&dir=desc&page=2&pageSize=20";
  assert.deepEqual(fields(resolveListState("products", {}, encodeListPreference("products", query, "one"))), fields(query));
});

test("explicit partial URL overrides the entire saved state, including saved table view", () => {
  const saved = encodeListPreference("projects", "view=table&q=old&client=c1&page=3", "one");
  assert.deepEqual(fields(resolveListState("projects", { engineer: "e2" }, saved, "table")), { view: "kanban", engineer: "e2" });
});

test("even an unknown explicit query does not restore hidden saved filters", () => {
  const saved = encodeListPreference("products", "view=table&q=old", "one");
  assert.deepEqual(fields(resolveListState("products", { unknown: "value" }, saved, "table")), { view: "kanban" });
});

test("legacy table view is used only when new state is absent, never after reset", () => {
  assert.equal(resolveListState("projects", {}, null, "table"), "view=table");
  const reset = encodeListPreference("projects", "view=kanban", "reset");
  assert.equal(resolveListState("projects", {}, reset, "table"), "view=kanban");
});

test("malformed saved values fail closed to defaults", () => {
  for (const value of ["not json", "[]", "null", '{"version":999,"query":"q=old"}', '{"version":1,"query":{}}']) {
    assert.equal(resolveListState("products", {}, value), "view=kanban");
  }
});

test("normalization accepts only parameters for this list and bounded valid values", () => {
  assert.deepEqual(fields(normalizeListQuery("products", "view=bad&status=DESIGN&stage=LEAD&manager=m1&active=bad&sort=garbage&dir=up&page=-9&pageSize=99&owner=other&q=%20desk%20")), { view: "kanban", status: "DESIGN", q: "desk" });
  assert.equal(new URLSearchParams(normalizeListQuery("projects", `q=${"x".repeat(120)}`)).get("q")?.length, 100);
  assert.equal(new URLSearchParams(normalizeListQuery("projects", "q=first&q=second")).get("q"), "first");
});

test("changing a filter, sort or page size resets page while page and view changes preserve it", () => {
  const initial = "view=table&engineer=e1&page=4&pageSize=50";
  const updates: Record<string, string | null>[] = [{ q: "desk" }, { engineer: "e2" }, { sort: "title" }, { dir: "asc" }, { pageSize: "20" }];
  for (const update of updates) {
    assert.equal(new URLSearchParams(updateListQuery("products", initial, update)).get("page"), null);
  }
  assert.equal(new URLSearchParams(updateListQuery("products", initial, { page: "5" })).get("page"), "5");
  assert.equal(new URLSearchParams(updateListQuery("products", initial, { view: "kanban" })).get("page"), "4");
});
