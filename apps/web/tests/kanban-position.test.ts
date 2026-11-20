import assert from "node:assert/strict";
import test from "node:test";
import { decodeKanbanPosition, readKanbanPosition, writeKanbanPosition, type KanbanPosition } from "../src/lib/kanban-position";
import { projectDetailHref, resolveProjectReturn } from "../src/lib/project-return-navigation";

const position: KanbanPosition = { version: 1, query: "view=kanban&active=0", left: 431, top: 2345,
  viewport: { width: 390, height: 844 }, anchor: { id: "card", x: -15, y: 105 } };
const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};

test("позиции разделены по вкладке, пользователю, разделу и параметрам", () => {
  const first = storage(), second = storage();
  writeKanbanPosition("actor", "projects", position, first);
  writeKanbanPosition("actor", "projects", { ...position, left: 900 }, second);
  assert.deepEqual(readKanbanPosition("actor", "projects", position.query, first), position);
  assert.equal(readKanbanPosition("actor", "projects", position.query, second)?.left, 900);
  assert.equal(readKanbanPosition("other", "projects", position.query, first), null);
  assert.equal(readKanbanPosition("actor", "products", position.query, first), null);
  assert.equal(readKanbanPosition("actor", "projects", "view=kanban&q=5", first), null);
});

test("повреждённый снимок не применяется, запрет storage оставляет безопасный резерв", () => {
  for (const invalid of [null, "{", "null", "{}", JSON.stringify({ ...position, version: 2 }), JSON.stringify({ ...position, left: -1 }),
    JSON.stringify({ ...position, top: 1e30 }), JSON.stringify({ ...position, anchor: { id: "x", x: "100", y: 50 } }),
    JSON.stringify({ ...position, viewport: { width: 0, height: 844 } }), " ".repeat(30_000)]) {
    assert.equal(decodeKanbanPosition(invalid, position.query), null);
  }
  const denied = { getItem(): string | null { throw Error("denied"); }, setItem() { throw Error("denied"); } };
  assert.doesNotThrow(() => writeKanbanPosition("denied-user", "products", position, denied));
  assert.deepEqual(readKanbanPosition("denied-user", "products", position.query, denied), position);
});

test("мини-канбаны хранят отдельные позиции для каждого проекта и пользователя", () => {
  const tab = storage();
  writeKanbanPosition("actor", "projects/A", position, tab);
  writeKanbanPosition("actor", "projects/B", { ...position, left: 900 }, tab);
  writeKanbanPosition("actor", "projects", { ...position, left: 25 }, tab);
  writeKanbanPosition("actor", "products", { ...position, left: 42 }, tab);

  assert.equal(readKanbanPosition("actor", "projects/A", position.query, tab)?.left, 431);
  assert.equal(readKanbanPosition("actor", "projects/B", position.query, tab)?.left, 900);
  assert.equal(readKanbanPosition("actor", "projects", position.query, tab)?.left, 25);
  assert.equal(readKanbanPosition("actor", "products", position.query, tab)?.left, 42);
  assert.equal(readKanbanPosition("other", "projects/A", position.query, tab), null);
});

test("ссылка проекта возвращает канонические параметры и ограничивает назначение", () => {
  const href = new URL(projectDetailHref("project/1", "active=0&view=kanban&client=client&unknown=discard"), "https://crm.invalid");
  assert.equal(href.pathname, "/projects/project%2F1");
  assert.equal(resolveProjectReturn(href.searchParams.get("returnTo")), "/projects?view=kanban&client=%5B%22client%22%5D&active=0");
  for (const invalid of [undefined, null, ["/projects"], "https://outside.invalid/projects", "//outside.invalid", "/products?view=kanban", "/projects/other", "/projects#x", "/projects?x=\\evil", "/projects?x=\u0000", "/projects?" + "x".repeat(20_000)]) {
    assert.equal(resolveProjectReturn(invalid), "/projects");
  }
  assert.equal(resolveProjectReturn("/projects?unknown=value"), "/projects?view=kanban");
});
