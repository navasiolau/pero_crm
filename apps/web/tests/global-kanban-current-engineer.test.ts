import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, Module } from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProductStatus, Role } from "@prisma/client";

const require = createRequire(import.meta.url);
function inject(name: string, exports: Record<string, unknown>) {
  const file = require.resolve(name), stub = new Module(file);
  stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub;
}
const componentReact = { ...React, useTransition: () => [false, (callback: () => unknown) => { callback(); }] };
inject("react", componentReact);
let onDragEnd: ((event: { active: { id: string }; over: { id: ProductStatus } }) => Promise<void> | void) | undefined;
let writes: { productId: string; toStatus: ProductStatus }[] = [];
let refreshes = 0;
inject("next/navigation", { useRouter: () => ({ push() {}, refresh() { refreshes++; } }) });
inject("../src/lib/list-params", { useListParams: () => ({ query: "view=kanban" }) });
inject("../src/server/products/actions", {
  createProduct() { throw Error("UNEXPECTED_CREATE_FORBIDDEN"); },
  async changeProductStatus(productId: string, toStatus: ProductStatus) { writes.push({ productId, toStatus }); return { ok: true }; },
});
inject("@dnd-kit/core", {
  DndContext: (props: { children: React.ReactNode; onDragEnd: typeof onDragEnd }) => { onDragEnd = props.onDragEnd; return props.children; },
  DragOverlay: () => null, PointerSensor: () => null,
  useDraggable: () => ({ attributes: {}, listeners: {}, setActivatorNodeRef() {}, setNodeRef() {}, transform: null, isDragging: false }),
  useDroppable: () => ({ setNodeRef() {}, isOver: false }), useSensors: () => [], useSensor: () => ({}),
});
(globalThis as unknown as { React: typeof React }).React = componentReact as typeof React;
const { ProductsKanban } = require("../src/app/(app)/products/products-kanban") as typeof import("../src/app/(app)/products/products-kanban");
const { ProductsTab } = require("../src/app/(app)/projects/[id]/products-tab") as typeof import("../src/app/(app)/projects/[id]/products-tab");
const product = {
  id: "qa-product", number: "128.1", title: "Контрольное изделие", kind: null,
  status: "PRODUCTION" as ProductStatus, statusChangedAt: new Date(0).toISOString(), expectedPrice: null, quantity: 1,
  currency: "BYN", projectId: "qa-project", projectStage: "CONTRACT" as const,
  projectNumber: "128", projectTitle: "Контрольный проект", clientId: "qa-client", clientName: "Контрольный клиент",
  engineerId: "current-engineer", engineerName: "Инженер", isEngineeringParticipant: false, hasB3d: false, noModel: false, sketchFile: null,
};
function render(component: typeof ProductsKanban | typeof ProductsTab, actorId: string, participant: boolean, roles: Role[] = ["ENGINEER"], status: ProductStatus = "PRODUCTION") {
  writes = []; refreshes = 0; onDragEnd = undefined;
  return renderToStaticMarkup(React.createElement(component as React.ComponentType<Record<string, unknown>>, {
    projectId: product.projectId, projectStage: product.projectStage, currency: product.currency,
    initialProducts: [{ ...product, status, isEngineeringParticipant: participant }], canManage: roles.includes("MANAGER"),
    actorUserId: actorId, actorRoles: roles, showAmount: false, engineerOptions: [],
  }));
}

for (const [name, component] of [["глобальная доска", ProductsKanban], ["доска проекта", ProductsTab]] as const) {
  test(`${name}: текущее назначение даёт возврат без прежнего участия`, async () => {
    assert.equal(render(component, "current-engineer", false).includes("Перетащить"), true);
    assert.ok(onDragEnd);
    await onDragEnd({ active: { id: product.id }, over: { id: "DESIGN" } });
    assert.deepEqual(writes, [{ productId: product.id, toStatus: "DESIGN" }]);
    assert.equal(refreshes, 1);
  });
  test(`${name}: прежний участник без назначения не получает инженерный drag`, async () => {
    assert.equal(render(component, "former-engineer", true, ["ENGINEER", "WORKER"]).includes("Перетащить"), false);
    assert.ok(onDragEnd);
    await onDragEnd({ active: { id: product.id }, over: { id: "DESIGN" } });
    assert.deepEqual(writes, []);
    assert.equal(refreshes, 0);
  });
  test(`${name}: отсутствующий актор и поздние этапы не расширяют право`, () => {
    assert.equal(render(component, "", true).includes("Перетащить"), false);
    for (const status of ["STORAGE", "INSTALLATION", "DONE", "RECLAMATION"] as ProductStatus[]) {
      assert.equal(render(component, "current-engineer", true, ["ENGINEER"], status).includes("Перетащить"), false);
    }
  });
  test(`${name}: совмещённый менеджер сохраняет собственный grant`, () => {
    assert.equal(render(component, "other-manager", false, ["MANAGER", "ENGINEER"]).includes("Перетащить"), true);
  });
}
