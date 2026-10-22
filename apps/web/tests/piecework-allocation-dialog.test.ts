import assert from "node:assert/strict";
import { before, test } from "node:test";
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
