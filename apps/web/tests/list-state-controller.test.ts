import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeListPreference } from "../src/lib/list-state";
import { createListSearchDebouncer, createListSearchDraft, ListStateController } from "../src/lib/list-state-controller";
import type { SaveListPreferenceResult } from "../src/server/list-preference-service";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("rapid project checkbox changes keep latest arrays and preserve raw V1 CAS through a late conflict", async () => {
  const calls: { query: string; expected: string | null; resolve: (result: SaveListPreferenceResult) => void }[] = [];
  const navigations: string[] = [];
  const rawV1 = '{ "version":1, "query":"view=table&engineer=e1", "revision":"old" }';
  const controller = new ListStateController({ section: "projects", query: "view=table&engineer=%5B%22e1%22%5D&active=1", preference: rawV1,
    save: (query, expected) => new Promise((resolve) => calls.push({ query, expected, resolve })),
    navigate: (query) => navigations.push(query), isCurrent: () => true });
  controller.start();
  controller.set({ engineer: '["e1","e2"]' });
  controller.set({ client: '["c1","c2","c3","c4","c5"]' });
  controller.set({ stage: '[]' });
  assert.equal(calls[0].expected, rawV1);
  calls[0].resolve({ ok: false, value: "external-update" });
  await tick();
  assert.equal(calls[1].expected, "external-update");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[1].query)), { view: "table", client: '["c1","c2","c3","c4","c5"]', engineer: '["e1","e2"]', stage: '[]', active: '1' });
  assert.deepEqual(navigations, []);
  calls[1].resolve({ ok: true, value: encodeListPreference("projects", calls[1].query, "latest") });
  await tick();
  assert.deepEqual(navigations, [calls[1].query]);
  controller.stop();
});

function fixture() {
  const calls: { query: string; expected: string | null; resolve: (value: SaveListPreferenceResult) => void }[] = [];
  const navigations: string[] = [];
  let current = true;
  const initial = "view=table&engineer=e1&page=4";
  const controller = new ListStateController({
    section: "products", query: initial, preference: encodeListPreference("products", initial, "first"),
    save: (query, expected) => new Promise((resolve) => calls.push({ query, expected, resolve })),
    navigate: (query) => navigations.push(query), isCurrent: () => current,
  });
  controller.start();
  return { controller, calls, navigations, leave: () => { current = false; } };
}

test("rapid changes serialize saves, merge parameters and navigate only to the latest state", async () => {
  const f = fixture();
  f.controller.set({ q: "desk" });
  f.controller.set({ status: "DESIGN" });
  assert.equal(f.calls.length, 1);
  const firstValue = encodeListPreference("products", f.calls[0].query, "second");
  f.calls[0].resolve({ ok: true, value: firstValue });
  await tick();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].expected, firstValue);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(f.calls[1].query)), { view: "table", q: "desk", engineer: "e1", status: "DESIGN" });
  assert.deepEqual(f.navigations, []);
  f.calls[1].resolve({ ok: true, value: encodeListPreference("products", f.calls[1].query, "third") });
  await tick();
  assert.deepEqual(f.navigations, [f.calls[1].query]);
  f.controller.stop();
});

test("reset after an in-flight filter update stays reset without navigating through the old query", async () => {
  const f = fixture();
  f.controller.set({ q: "stale" });
  f.controller.reset();
  f.calls[0].resolve({ ok: true, value: encodeListPreference("products", f.calls[0].query, "second") });
  await tick();
  assert.deepEqual(f.navigations, []);
  assert.equal(f.calls[1].query, "view=kanban");
  f.calls[1].resolve({ ok: true, value: encodeListPreference("products", "view=kanban", "reset") });
  await tick();
  assert.deepEqual(f.navigations, ["view=kanban"]);
  f.controller.stop();
});

test("unmount discards queued saves and never navigates after the current request resolves", async () => {
  const f = fixture();
  f.controller.set({ q: "first" });
  f.controller.set({ q: "unsent" });
  f.controller.stop();
  f.calls[0].resolve({ ok: false, value: "newer" });
  await tick();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.navigations, []);
});

test("changed browser location prevents late navigation even before React unmount", async () => {
  const f = fixture();
  f.controller.set({ q: "first" });
  f.leave();
  f.calls[0].resolve({ ok: true, value: "saved" });
  await tick();
  assert.deepEqual(f.navigations, []);
  f.controller.stop();
});

test("external URL navigation supersedes pending state and is persisted as the full replacement", async () => {
  const f = fixture();
  f.controller.set({ q: "old" });
  f.controller.observe("view=kanban&engineer=e2", null);
  f.calls[0].resolve({ ok: true, value: encodeListPreference("products", f.calls[0].query, "second") });
  await tick();
  assert.equal(f.calls[1].query, "view=kanban&engineer=e2");
  assert.deepEqual(f.navigations, []);
  f.calls[1].resolve({ ok: true, value: encodeListPreference("products", f.calls[1].query, "third") });
  await tick();
  assert.deepEqual(f.navigations, []);
  f.controller.stop();
});

test("current action retries a version conflict; discarded actions do not", async () => {
  const f = fixture();
  f.controller.set({ q: "current" });
  f.calls[0].resolve({ ok: false, value: "other-window" });
  await tick();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].expected, "other-window");
  f.controller.stop();
  f.calls[1].resolve({ ok: false, value: "newer" });
  await tick();
  assert.equal(f.calls.length, 2);
});

test("confirmation of own navigation does not cancel a newer unsent search draft", async () => {
  const f = fixture();
  f.controller.set({ q: "first" });
  const value = encodeListPreference("products", f.calls[0].query, "second");
  f.calls[0].resolve({ ok: true, value });
  await tick();
  const draftRevision = f.controller.getSnapshot().revision;
  f.controller.observe(f.calls[0].query, value);
  assert.equal(f.controller.getSnapshot().revision, draftRevision);
  assert.equal(f.calls.length, 1);
  f.controller.stop();
});

test("reset/navigation cancels scheduled search without writing a stale query", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const queries: string[] = [];
  const search = createListSearchDebouncer((value) => queries.push(value));
  search.queue("old");
  search.cancel();
  t.mock.timers.tick(301);
  assert.deepEqual(queries, []);
  search.queue("a");
  search.queue("ab");
  t.mock.timers.tick(301);
  assert.deepEqual(queries, ["ab"]);
});

test("a stale draft is rejected immediately by the revision guard, before effect cleanup", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const queries: string[] = [];
  let current = true;
  const search = createListSearchDebouncer((value) => queries.push(value), 300, () => current);
  search.queue("draft");
  current = false;
  t.mock.timers.tick(301);
  assert.deepEqual(queries, []);
});

test("a pending search is merged with a status chosen before the debounce expires", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  const draft = createListSearchDraft(f.controller);
  draft.queue("desk");
  t.mock.timers.tick(100);
  f.controller.set({ status: "DESIGN" });
  t.mock.timers.tick(201);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(f.controller.getSnapshot().query)), {
    view: "table", q: "desk", engineer: "e1", status: "DESIGN",
  });
  f.calls[0].resolve({ ok: true, value: encodeListPreference("products", f.calls[0].query, "status") });
  await tick();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(f.calls[1].query)), {
    view: "table", q: "desk", engineer: "e1", status: "DESIGN",
  });
  f.controller.stop();
  f.calls[1].resolve({ ok: true, value: "saved" });
  draft.cancel();
});

test("an external return to A is applied after a newer issued B was observed", async () => {
  const f = fixture();
  f.controller.set({ q: "A" });
  const valueA = encodeListPreference("products", f.calls[0].query, "A");
  f.calls[0].resolve({ ok: true, value: valueA });
  await tick();
  f.controller.set({ q: "B" });
  const valueB = encodeListPreference("products", f.calls[1].query, "B");
  f.calls[1].resolve({ ok: true, value: valueB });
  await tick();
  f.controller.observe(f.calls[1].query, valueB);
  f.controller.observe(f.calls[0].query, valueB);
  assert.equal(new URLSearchParams(f.controller.getSnapshot().query).get("q"), "A");
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[2].query, f.calls[0].query);
  f.calls[2].resolve({ ok: true, value: valueA });
  await tick();
  assert.equal(f.navigations.length, 2, "external URL does not trigger another router.replace");
  f.controller.stop();
});

test("search draft survives a filter save and its confirmed navigation before 300 ms", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  const draft = createListSearchDraft(f.controller);
  draft.queue("desk");
  f.controller.set({ status: "DESIGN" });
  const filterValue = encodeListPreference("products", f.calls[0].query, "status");
  f.calls[0].resolve({ ok: true, value: filterValue });
  await tick();
  f.controller.observe(f.calls[0].query, filterValue);
  t.mock.timers.tick(301);
  assert.equal(f.calls.length, 2);
  assert.equal(new URLSearchParams(f.calls[1].query).get("q"), "desk");
  assert.equal(new URLSearchParams(f.calls[1].query).get("status"), "DESIGN");
  f.controller.stop();
  f.calls[1].resolve({ ok: true, value: "saved" });
  draft.cancel();
});

test("reset and external navigation cancel a draft synchronously without React effect cleanup", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const cancel of ["reset", "external", "popstate"] as const) {
    const f = fixture();
    const draft = createListSearchDraft(f.controller);
    draft.queue("stale");
    if (cancel === "reset") f.controller.reset();
    else if (cancel === "external") f.controller.observe("view=kanban&status=PRODUCTION", null);
    else f.controller.cancelPending();
    t.mock.timers.tick(301);
    assert.equal(new URLSearchParams(f.controller.getSnapshot().query).get("q"), null, cancel);
    assert.ok(f.calls.every((call) => !new URLSearchParams(call.query).has("q")), cancel);
    f.controller.stop();
    for (const call of f.calls) call.resolve({ ok: true, value: "saved" });
    draft.cancel();
  }
});

test("confirming B retires older A even while newer C is still saving", async () => {
  const f = fixture();
  for (const q of ["A", "B"]) {
    f.controller.set({ q });
    const call = f.calls.at(-1)!;
    call.resolve({ ok: true, value: encodeListPreference("products", call.query, q) });
    await tick();
  }
  f.controller.set({ q: "C" });
  const valueB = encodeListPreference("products", f.calls[1].query, "B");
  f.controller.observe(f.calls[1].query, valueB);
  f.controller.observe(f.calls[0].query, valueB);
  assert.equal(new URLSearchParams(f.controller.getSnapshot().query).get("q"), "A");
  f.calls[2].resolve({ ok: true, value: encodeListPreference("products", f.calls[2].query, "C") });
  await tick();
  assert.equal(f.calls[3].query, f.calls[0].query);
  f.controller.stop();
  f.calls[3].resolve({ ok: true, value: "saved" });
});
