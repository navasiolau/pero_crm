import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, Module } from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
function inject(path: string, exports: Record<string, unknown>) {
  const file = require.resolve(path), stub = new Module(file);
  stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub;
}
inject("next/navigation", { useRouter: () => ({ push() { throw Error("SSR_MUTATION_FORBIDDEN"); }, refresh() { throw Error("SSR_MUTATION_FORBIDDEN"); } }) });
inject("../src/server/products/actions", { createProduct() { throw Error("SSR_MUTATION_FORBIDDEN"); }, changeProductStatus() { throw Error("SSR_MUTATION_FORBIDDEN"); } });
inject("../src/lib/list-params", { useListParams: () => ({ query: "" }) });
(globalThis as unknown as { React: typeof React }).React = React;
const { ProductsTab } = require("../src/app/(app)/projects/[id]/products-tab") as typeof import("../src/app/(app)/projects/[id]/products-tab");
const { ProductsKanban } = require("../src/app/(app)/products/products-kanban") as typeof import("../src/app/(app)/products/products-kanban");
const product = {
  id: "p", number: "111.1", title: "Черновой шкаф", kind: null, status: "DRAFT" as const,
  statusChangedAt: new Date().toISOString(), expectedPrice: "10.01", quantity: 1, currency: "BYN",
  projectId: "project", projectStage: "ESTIMATE" as const, projectNumber: "111", projectTitle: "Заказ",
  clientId: "client", clientName: "Клиент", engineerName: null, engineerId: null,
  isEngineeringParticipant: false, hasB3d: false, noModel: false, sketchFile: null,
};
function check(html: string, canDrag: boolean) {
  const draft = html.indexOf(">Черновики<"), prep = html.indexOf(">Подготовка<"), card = html.indexOf("Черновой шкаф");
  assert.ok(draft >= 0 && prep > draft, "draft column precedes preparation");
  assert.ok(card > draft && card < prep, "draft product belongs to first column");
  assert.equal(html.includes("Перетащить"), canDrag, "draft drag follows project stage");
}
test("project and global boards place early drafts first and disable their management drag", () => {
  check(renderToStaticMarkup(React.createElement(ProductsTab, {
    projectId: "project", projectStage: "ESTIMATE", currency: "BYN", initialProducts: [product],
    canManage: true, actorRoles: ["ADMIN"], actorUserId: "manager", showAmount: true, engineerOptions: [],
  })), false);
  check(renderToStaticMarkup(React.createElement(ProductsKanban, {
    initialProducts: [product], canManage: true, actorRoles: ["ADMIN"], showAmount: true,
  })), false);
});
test("active project retains normal management drag for an explicitly restored draft", () => {
  check(renderToStaticMarkup(React.createElement(ProductsKanban, {
    initialProducts: [{ ...product, projectStage: "CONTRACT" }], canManage: true, actorRoles: ["ADMIN"], showAmount: true,
  })), true);
});
test("all non-admin/director roles render both boards from preparation and cannot expose stale drafts", () => {
  const prepared = { ...product, id: "prep", number: "111.2", title: "Подтверждённый шкаф", status: "PREPARATION" as const };
  for (const actorRoles of [["MANAGER"], ["MANAGER", "ENGINEER"], ["ENGINEER"], ["WORKER"], ["MOUNTER"], ["PROCUREMENT"], ["ACCOUNTANT"]] as import("@prisma/client").Role[][]) {
    for (const component of [ProductsTab, ProductsKanban]) {
      const html = renderToStaticMarkup(React.createElement(component as React.ComponentType<Record<string, unknown>>, {
        projectId: "project", projectStage: "ESTIMATE", currency: "BYN", initialProducts: [product, prepared],
        canManage: actorRoles.includes("MANAGER"), actorRoles, actorUserId: "manager", showAmount: true, engineerOptions: [],
      }));
      assert.equal(html.includes(">Черновики<"), false, actorRoles.join("+"));
      assert.equal(html.includes("Черновой шкаф"), false, actorRoles.join("+"));
      assert.ok(html.includes(">Подготовка<") && html.includes("Подтверждённый шкаф"));
      if (component === ProductsTab) assert.ok(html.includes("1 позиция"), "stale hidden draft cannot change the visible count");
    }
  }
});
