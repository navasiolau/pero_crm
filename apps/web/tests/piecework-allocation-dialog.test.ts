import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import React from "react";
import { createRequire, Module } from "node:module";
import type { PieceworkContext } from "../src/components/piecework-allocation-dialog";
import type { PieceworkOptions } from "../src/server/tasks/piecework-queries";

const require = createRequire(import.meta.url);
function inject(name: string, exports: Record<string, unknown>) { const file = require.resolve(name), stub = new Module(file); stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub; }
const host = (tag: string) => function Host(props: Record<string, unknown>) { return React.createElement(tag, props); };
let dialog: typeof import("../src/components/piecework-allocation-dialog").PieceworkAllocationDialog;
const states: unknown[] = [], refs: { current: unknown }[] = [], calls: unknown[] = [];
let stateIndex = 0, refIndex = 0, finish: Promise<void> | undefined, closes = 0, refreshes = 0, loseAck = true;
before(() => {
  (globalThis as unknown as { React: typeof React }).React = React;
  inject("react", { ...React, useState: (initial: unknown) => { const i = stateIndex++; if (!(i in states)) states[i] = typeof initial === "function" ? (initial as () => unknown)() : initial; return [states[i], (value: unknown) => { states[i] = typeof value === "function" ? (value as (old: unknown) => unknown)(states[i]) : value; }]; }, useRef: (value: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }), useTransition: () => [false, (callback: () => Promise<void>) => { finish = callback(); }] });
  inject("next/navigation", { useRouter: () => ({ refresh() { refreshes++; } }) }); inject("sonner", { toast: { success() {}, error() {} } });
  inject("../src/components/ui/button", { Button: host("button") }); inject("../src/components/ui/input", { Input: host("input") }); inject("../src/components/ui/label", { Label: host("label") }); inject("../src/components/ui/searchable-select", { SearchableSelect: host("select") }); inject("../src/components/quantity-stepper", { QuantityStepper: host("input") });
  inject("../src/components/ui/dialog", Object.fromEntries(["Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"].map(name => [name, host("section")])));
  const write = async (payload: unknown) => { calls.push(payload); if (loseAck) { loseAck = false; throw Error("LOST_ACK"); } return { ok: true, groupId: "group" }; };
  inject("../src/server/tasks/piecework-actions", { createPieceworkAllocation: write, transferPieceworkShare: write, getPieceworkOptions: async () => null });
  dialog = (require("../src/components/piecework-allocation-dialog") as typeof import("../src/components/piecework-allocation-dialog")).PieceworkAllocationDialog;
});
beforeEach(() => { states.length = refs.length = calls.length = 0; closes = refreshes = 0; loseAck = true; finish = undefined; });
function nodes(value: unknown): React.ReactElement<Record<string, unknown>>[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!React.isValidElement(value)) return []; const node = value as React.ReactElement<Record<string, unknown>>; return [node, ...nodes(node.props.children)]; }
function button(tree: React.ReactElement, label: string) { const node = nodes(tree).find(node => node.props.children === label && typeof node.props.onClick === "function"); assert.ok(node); return node.props; }
function text(value: unknown): string { if (Array.isArray(value)) return value.map(text).join(""); if (React.isValidElement(value)) return text((value.props as { children?: unknown }).children); return typeof value === "string" || typeof value === "number" ? String(value) : ""; }
const options: PieceworkOptions = { recipients: [{ id: "worker", name: "Работник" }, { id: "recipient", name: "Второй" }, { id: "manager", name: "Менеджер" }], canCreate: true, transferable: false, source: null, works: [{ id: "work", remaining: "10.00", priceSnapshot: "100.00", revision: "a".repeat(64) }] };
function render(context: PieceworkContext, data = options) { stateIndex = refIndex = 0; return dialog({ context, options: data, onClose() { closes++; } }); }

test("N-row UI previews exact sums and a lost response locks and retries the same immutable request", async () => {
  const context: PieceworkContext = { mode: "create", projectId: "project", productId: "product", work: { id: "work", title: "Работа", unit: "м²" } };
  let tree = render(context); (button(tree, "Добавить исполнителя").onClick as () => void)();
  tree = render(context);
  const selects = nodes(tree).filter(node => node.props.placeholder === "Исполнитель");
  ["worker", "recipient", "manager"].forEach((id, index) => (selects[index].props.onChange as (value: string) => void)(id));
  tree = render(context);
  ["50", "30", "20"].forEach((value, index) => {
    tree = render(context);
    const input = nodes(tree).find(node => node.props.id === `piecework-percent-${index}`)!;
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
  });
  tree = render(context); assert.equal(button(tree, "Распределить").disabled, false); assert.match(text(tree), /500.*300.*200/);
  (button(tree, "Распределить").onClick as () => void)(); (button(tree, "Распределить").onClick as () => void)(); await finish;
  assert.equal(calls.length, 1); assert.equal(closes, 0);
  tree = render(context); assert.ok(nodes(tree).some(node => node.type === "fieldset" && node.props.disabled === true));
  assert.equal(button(tree, "Отмена").disabled, true); (tree.props as { onOpenChange: (open: boolean) => void }).onOpenChange(false); assert.equal(closes, 0);
  (button(tree, "Повторить тот же запрос").onClick as () => void)(); await finish;
  assert.equal(calls.length, 2); assert.strictEqual(calls[0], calls[1]); assert.equal(closes, 1); assert.equal(refreshes, 1);
  assert.deepEqual((calls[0] as { participants: unknown }).participants, [{ userId: "worker", percent: "50" }, { userId: "recipient", percent: "30" }, { userId: "manager", percent: "20" }]);
  assert.equal("estimateMinutes" in (calls[0] as object), false);
  assert.equal((calls[0] as { type: string }).type, "Производство");
  assert.equal("dueAt" in (calls[0] as object), false);
});

test("create draft starts with full volume and 50/50, and adds empty rows beyond the recipient count", () => {
  const context: PieceworkContext = { mode: "create", projectId: "project", productId: "product", work: { id: "work", title: "Работа", unit: "м²" } };
  const data = { ...options, recipients: options.recipients.slice(0, 2) };
  let tree = render(context, data);
  assert.equal(nodes(tree).find(node => node.props.remaining === "10.00")!.props.value, "10.00");
  assert.deepEqual(nodes(tree).filter(node => String(node.props.id).startsWith("piecework-percent-")).map(node => node.props.value), ["50", "50"]);
  assert.equal(nodes(tree).some(node => node.props.id === "piecework-type" || node.props.type === "date"), false);
  assert.doesNotMatch(text(tree), /Остаток копеек/);
  for (const count of [3, 4]) {
    assert.equal(button(tree, "Добавить исполнителя").disabled, false);
    (button(tree, "Добавить исполнителя").onClick as () => void)();
    tree = render(context, data);
    const rows = nodes(tree).filter(node => String(node.props.id).startsWith("piecework-percent-"));
    assert.equal(rows.length, count); assert.deepEqual(rows.map(node => node.props.value), ["50", "50", ...Array(count - 2).fill("")]);
  }
  assert.match(text(tree), /Нет свободного.*сотрудника/);
  assert.equal(button(tree, "Распределить").disabled, true);
});

test("percentage drafts reject non-numeric input and totals above 100, preserving decimal comma and valid submission", async () => {
  loseAck = false;
  const context: PieceworkContext = { mode: "create", projectId: "project", productId: "product", work: { id: "work", title: "Работа", unit: "м²" } };
  let tree = render(context);
  nodes(tree).filter(node => node.props.placeholder === "Исполнитель").forEach((node, index) => (node.props.onChange as (value: string) => void)(options.recipients[index].id));
  function change(index: number, value: string) {
    tree = render(context);
    (nodes(tree).find(node => node.props.id === `piecework-percent-${index}`)!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
    tree = render(context);
  }
  for (const value of ["abc", "1e2", "+50", "-50", "50.001"]) {
    change(0, value);
    assert.equal(nodes(tree).find(node => node.props.id === "piecework-percent-0")!.props.value, "50");
  }
  change(0, "51");
  assert.equal(nodes(tree).find(node => node.props.id === "piecework-percent-0")!.props.value, "50");
  assert.match(text(tree), /Сумма процентов не может превышать 100%/);
  change(0, "49.99"); assert.equal(button(tree, "Распределить").disabled, true);
  change(1, "50,01");
  assert.equal(nodes(tree).find(node => node.props.id === "piecework-percent-1")!.props.value, "50.01");
  assert.equal(button(tree, "Распределить").disabled, false);
  assert.doesNotMatch(text(tree), /Сумма процентов не может превышать/);
  (button(tree, "Распределить").onClick as () => void)(); await finish;
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0] as { participants: unknown }).participants, [{ userId: "worker", percent: "49.99" }, { userId: "recipient", percent: "50.01" }]);
});

test("transfer UI previews a percentage of the current share and submits its loaded revision", async () => {
  states.length = refs.length = calls.length = 0; closes = refreshes = 0; loseAck = false;
  const context: PieceworkContext = { mode: "transfer", productId: "product", taskId: "source", title: "Моя доля" };
  const data: PieceworkOptions = { ...options, transferable: true, source: { revision: 7, shareUnits: 500000, amount: "500.00", currency: "BYN" } };
  let tree = render(context, data);
  const select = nodes(tree).find(node => node.props.placeholder === "Выберите сотрудника")!;
  (select.props.onChange as (value: string) => void)("recipient");
  (nodes(tree).find(node => node.props.id === "piecework-transfer-percent")!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "20" } });
  tree = render(context, data); assert.match(text(tree), /Передаётся.*100.*остаётся.*400/);
  (button(tree, "Передать").onClick as () => void)(); await finish;
  assert.equal(calls.length, 1); assert.equal((calls[0] as { expectedRevision: number }).expectedRevision, 7); assert.equal((calls[0] as { percent: string }).percent, "20");
});
