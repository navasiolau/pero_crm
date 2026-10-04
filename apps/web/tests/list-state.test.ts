import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeListPreference, encodeListPreference, normalizeListQuery, resolveListState, updateListQuery } from "../src/lib/list-state";
import { encodeProjectFilterValue, parseProjectFilterValue } from "../src/lib/project-filter-values";

const fields = (query: string) => Object.fromEntries(new URLSearchParams(query));

test("project codec treats empty as unrestricted and retains a selected ID absent from options", () => {
  assert.equal(parseProjectFilterValue(undefined), undefined);
  assert.equal(parseProjectFilterValue(" "), undefined);
  assert.equal(encodeProjectFilterValue(undefined), null);
  assert.equal(encodeProjectFilterValue([]), null);
  assert.equal(parseProjectFilterValue("[]"), undefined);
  assert.deepEqual(parseProjectFilterValue(" old-selected-id "), ["old-selected-id"]);
  assert.equal(encodeProjectFilterValue(["z", "a", "z"]), '["a","z"]');
});

test("project multi-value normalization preserves five clients and two engineers while empty axes disappear", () => {
  const source = new URLSearchParams({ client: JSON.stringify(["c5", "c2", "c1", "c4", "c3", "c1"]), engineer: '["e2","e1"]', stage: '[]', manager: '[]', active: '1' });
  assert.deepEqual(fields(normalizeListQuery("projects", source.toString())), {
    view: "kanban", client: '["c1","c2","c3","c4","c5"]', engineer: '["e1","e2"]', active: '1',
  });
  assert.deepEqual(fields(normalizeListQuery("projects", "client=c1&stage=IN_WORK")), { view: "kanban", client: '["c1"]', stage: '["IN_WORK"]' });
  assert.equal(normalizeListQuery("projects", ""), "view=kanban");
});

test("project preferences upgrade V1 effective activity, create V2 and keep products V1", () => {
  const old = JSON.stringify({ version: 1, revision: "old", query: "view=table&engineer=e1" });
  assert.deepEqual(fields(decodeListPreference("projects", old)!), { view: "table", engineer: '["e1"]', active: "1" });
  assert.equal(new URLSearchParams(decodeListPreference("projects", JSON.stringify({ version: 1, query: "active=0" }))!).get("active"), "0");
  assert.equal(JSON.parse(encodeListPreference("projects", "", "new")).version, 2);
  assert.equal(JSON.parse(encodeListPreference("products", "engineer=e1", "new")).version, 1);
  assert.equal(decodeListPreference("products", old), "view=table&engineer=e1");
  assert.equal(decodeListPreference("products", JSON.stringify({ version: 2, query: "engineer=e1" })), null);
});

test("project normalization retains a long valid set and ignores malformed axes only", () => {
  const ids = Array.from({ length: 100 }, (_, index) => `client-${String(index).padStart(3, "0")}`);
  const source = new URLSearchParams({ client: JSON.stringify(ids) });
  assert.deepEqual(JSON.parse(new URLSearchParams(normalizeListQuery("projects", source.toString())).get("client")!), ids);
  for (const client of ['["c1",7]', '["c1"', JSON.stringify(["x".repeat(129)]), '{"id":"c1"}']) {
    assert.deepEqual(fields(normalizeListQuery("projects", new URLSearchParams({ client, engineer: '["e1"]' }).toString())), { view: "kanban", engineer: '["e1"]' });
  }
});

test("clearing the last choice drops only that project axis and resets page", () => {
  const initial = new URLSearchParams({ view: "table", stage: '["IN_WORK"]', engineer: '["e1"]', manager: '["m1"]', page: "3" }).toString();
  const updated = updateListQuery("projects", initial, { engineer: "[]" });
  assert.deepEqual(fields(updated), { view: "table", stage: '["IN_WORK"]', manager: '["m1"]' });
});

test("bare project route restores all saved filters, search, sorting, view and paging", () => {
  const query = "view=table&q=Кухня&stage=IN_WORK&client=c1&manager=m1&engineer=e1&active=0&sort=title&dir=asc&page=3&pageSize=50";
  const saved = encodeListPreference("projects", query, "one");
  assert.deepEqual(fields(resolveListState("projects", {}, saved)), { ...fields(query), stage: '["IN_WORK"]', client: '["c1"]', manager: '["m1"]', engineer: '["e1"]' });
});

test("bare product route restores its own full state, including project and engineer", () => {
  const query = "view=table&q=Шкаф&status=DESIGN&project=p1&client=c1&engineer=e1&active=0&sort=price&dir=desc&page=2&pageSize=20";
  assert.deepEqual(fields(resolveListState("products", {}, encodeListPreference("products", query, "one"))), fields(query));
});

test("explicit partial URL overrides the entire saved state, including saved table view", () => {
  const saved = encodeListPreference("projects", "view=table&q=old&client=c1&page=3", "one");
  assert.deepEqual(fields(resolveListState("projects", { engineer: "e2" }, saved, "table")), { view: "kanban", engineer: '["e2"]' });
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
