import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TaskDetails } from "../src/lib/task-details";
const require = createRequire(import.meta.url);
let TaskDialog: typeof import("../src/components/task-dialog").TaskDialog;
function inject(name: string, exports: Record<string, unknown>) {
  const file = require.resolve(name), stub = new Module(file);
  stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub;
}
before(() => {
  (globalThis as unknown as { React: typeof React }).React = React;
  inject("next/navigation", { useRouter: () => ({ refresh() {} }) });
  inject("../src/server/tasks/actions", { deleteTask() { throw Error("NO_WRITES"); }, updateTask() { throw Error("NO_WRITES"); } });
  inject("../src/components/file-viewer", { useFileViewer: () => ({ open() {} }) });
  const host = ({ children }: { children: React.ReactNode }) => React.createElement("section", null, children);
  inject("../src/components/ui/dialog", Object.fromEntries(["Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"].map(name => [name, host])));
  TaskDialog = require("../src/components/task-dialog").TaskDialog;
});
const task: TaskDetails = { id: "t", title: "Раскрой детали", type: "Производство", status: "DONE", assigneeId: "u", assigneeName: "Исполнитель", dueAt: "2026-10-04", workId: "w", workTitle: "Раскрой детали", workTotal: "600", workPriceSnapshot: "200", quantity: "1", personalQuantity: "1", shareUnits: 2500, stageShareUnits: 5000, shareAmount: "999", shareCurrency: "USD", rewardAmount: "0.00", rewardCurrency: "BYN", rewardSource: "WORK_SNAPSHOT", requiresPhoto: false, dependencies: [], projectId: "j", projectNumber: "П-1", projectTitle: "Проект", productId: "p", productNumber: "П-1-1", productTitle: "Изделие", files: [], createdAt: "2026-10-01", doneAt: null, doneByName: null, createdByName: null };
test("actual task card renders server zero reward and one executor without shares or snapshot repricing", () => {
  const html = renderToStaticMarkup(React.createElement(TaskDialog, { task, workers: [], canEdit: false, open: true, onOpenChange() {} }));
  assert.match(html, /Вознаграждение/); assert.match(html, /0 BYN/); assert.match(html, /Исполнитель/); assert.match(html, /Раскрой детали/);
  assert.doesNotMatch(html, /Доля|доли|25%|50%|999|USD|Без денежного начисления|Разделить/);
});
