import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Role } from "../src/lib/roles";
import type { ManagedTrip, MoneyOptions, ProjectBudget, TripOptions } from "../src/components/logistics/types";
import { formatExactMoney } from "../src/lib/format";

Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
function stubModule(name: string, exports: unknown) {
  const filename = require.resolve(name), fixtureModule = new Module(filename);
  fixtureModule.filename = filename; fixtureModule.loaded = true; fixtureModule.exports = exports; require.cache[filename] = fixtureModule;
}
const tripId = "a1000000-0000-4000-8000-000000000001";
const document = { id: "a1000000-0000-4000-8000-000000000002", tripId, source: "logistics" as const,
  fileName: "ТТН-123.pdf", mimeType: "application/pdf", size: 50, stage: "ISSUED" as const,
  ttnNumber: "123", createdAt: "2026-10-10T09:00:00Z" };
const tripBase = {
  mode: "manage" as const, id: tripId, date: "2026-10-10", comment: "PRIVATE_COMMENT", revision: 2, ttnNotRequired: false,
  shares: [
    { id: "share-a", projectId: "project-a", projectNumber: "П-001", projectTitle: "PRIVATE_TITLE_A", percentBps: 4000 },
    { id: "share-b", projectId: "project-b", projectNumber: "П-002", projectTitle: "PRIVATE_TITLE_B", percentBps: 6000 },
  ],
  lines: [
    { id: "line-a", projectId: "project-a", kind: "PRODUCT" as const, productId: "product-a", materialId: null, nameSnapshot: "PRIVATE_MANIFEST_A", numberSnapshot: "П-001-1", unitSnapshot: "шт.", quantity: 2 },
    { id: "line-b", projectId: "project-b", kind: "PRODUCT" as const, productId: "product-b", materialId: null, nameSnapshot: "PRIVATE_MANIFEST_B", numberSnapshot: "П-002-1", unitSnapshot: "шт.", quantity: 3 },
  ],
  documents: [document],
};
const managed: ManagedTrip = {
  ...tripBase,
  money: { current: {
    id: "posting-1", tripId, tripRevision: 2, status: "ACTIVE", amount: "1000.00", currency: "BYN", ttnNotRequired: false,
    cashAccountId: "cash-1", cashAccountName: "PRIVATE_CASH", rate: "1.000000", rateDate: null,
    bynAmount: "1000.00", paidAt: "2026-10-10", createdAt: "2026-10-10T09:00:00Z", createdByName: "PRIVATE_OPERATOR",
    documentIds: [document.id],
    allocations: [
      { id: "allocation-a", projectId: "project-a", projectNumber: "П-001", percentBps: 4000, amount: "400.00", bynAmount: "400.00", paymentId: "payment-a" },
      { id: "allocation-b", projectId: "project-b", projectNumber: "П-002", percentBps: 6000, amount: "600.00", bynAmount: "600.00", paymentId: "payment-b" },
    ],
  }, history: [] },
};
const options: TripOptions = {
  projects: [
    { id: "project-a", number: "П-001", title: "PRIVATE_TITLE_A", products: [{ id: "product-a", number: "П-001-1", title: "PRIVATE_MANIFEST_A", quantity: 2 }] },
    { id: "project-b", number: "П-002", title: "PRIVATE_TITLE_B", products: [{ id: "product-b", number: "П-002-1", title: "PRIVATE_MANIFEST_B", quantity: 3 }] },
  ],
  materials: [{ id: "material-1", name: "PRIVATE_MATERIAL", unit: "шт." }],
};
const moneyOptions: MoneyOptions = {
  cashAccounts: [{ id: "cash-1", name: "PRIVATE_CASH", currency: "BYN", balance: 5000 }],
};
const budget: ProjectBudget = { currency: "BYN", deliveryBudget: 500, tripSpent: 400, spent: 400, remaining: 100, unavailableReason: null };
const documentTrip = { mode: "documents" as const, id: tripId, date: tripBase.date, ttnNotRequired: false,
  projects: [{ id: "project-a", number: "П-001" }, { id: "project-b", number: "П-002" }], documents: [document] };
const query = { query: "", page: 1, pageSize: 20, direction: "desc" as const };
let actorRoles: Role[] = ["PROCUREMENT"], listReads = 0, moneyReads = 0, optionsReads = 0;
stubModule("next/navigation", {
  usePathname: () => "/logistics", useRouter: () => ({ replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(), redirect: (path: string) => { throw new Error("REDIRECT:" + path); },
});
stubModule("../src/auth", { auth: async () => ({ user: { id: "actor", roles: actorRoles } }) });
const { canManageLogistics } = require("../src/lib/logistics-access") as typeof import("../src/lib/logistics-access");
const list = async () => {
  listReads += 1;
  return canManageLogistics(actorRoles)
    ? { mode: "manage" as const, rows: [tripBase], total: 1, query }
    : { mode: "documents" as const, rows: [documentTrip], total: 1, query };
};
stubModule("../src/server/logistics/queries", {
  listLogisticsTrips: list, getLogisticsProjectTrips: list, getLogisticsTrip: async () => tripBase,
  getLogisticsOptions: async () => { optionsReads += 1; return options; },
});
stubModule("../src/server/logistics/actions", { createLogisticsTrip: async () => { throw Error("UI render must not write"); }, updateLogisticsTrip: async () => { throw Error("UI render must not write"); } });
stubModule("../src/server/logistics/money-actions", {
  postLogisticsTrip: async () => { throw Error("UI render must not spend"); },
  correctLogisticsTripPosting: async () => { throw Error("UI render must not spend"); },
});
stubModule("../src/server/logistics/money-queries", {
  getLogisticsTripMoney: async () => { moneyReads += 1; return managed.money; },
  getLogisticsMoneyOptions: async () => { moneyReads += 1; return moneyOptions; },
  getLogisticsProjectBudget: async () => { moneyReads += 1; return budget; },
});
const { LogisticsWorkspace } = require("../src/components/logistics/workspace") as typeof import("../src/components/logistics/workspace");
const { LogisticsTripForm } = require("../src/components/logistics/trip-editor") as typeof import("../src/components/logistics/trip-editor");
const { LogisticsDocuments } = require("../src/components/logistics/documents") as typeof import("../src/components/logistics/documents");
const { loadLogisticsWorkspace } = require("../src/app/(app)/logistics/workspace-data") as typeof import("../src/app/(app)/logistics/workspace-data");
const { default: LogisticsPage } = require("../src/app/(app)/logistics/page") as typeof import("../src/app/(app)/logistics/page");
const { navItemsForRole } = require("../src/lib/nav") as typeof import("../src/lib/nav");
const { canAccessOperationalPath } = require("../src/lib/operational-access") as typeof import("../src/lib/operational-access");
const { previewAllocations } = require("../src/components/logistics/model") as typeof import("../src/components/logistics/model");

test("one shared trip renders once, preserves 40/60 project costs and gives accountant only documents while closing forbidden routes", async () => {
  const baseline = JSON.stringify({ managed, options, moneyOptions, budget });
  const globalData = await loadLogisticsWorkspace();
  assert.equal(globalData.mode, "manage");
  const globalHtml = renderToStaticMarkup(React.createElement(LogisticsWorkspace, { data: globalData }));
  const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(globalHtml)![1];
  assert.equal((body.match(/data-slot="table-row"/g) ?? []).length, 1);
  assert.match(globalHtml, /П-001/); assert.match(globalHtml, /П-002/);
  assert.ok(globalHtml.includes(formatExactMoney("1000.00", "BYN")));
  assert.match(globalHtml, /PRIVATE_MANIFEST_A/);

  for (const [projectId, expected] of [["project-a", "400.00"], ["project-b", "600.00"]]) {
    const data = await loadLogisticsWorkspace({}, projectId);
    const html = renderToStaticMarkup(React.createElement(LogisticsWorkspace, { data }));
    assert.equal(data.rows[0].id, tripId);
    assert.match(html, /Полная стоимость рейса/);
    assert.match(html, /Затраты проекта, BYN/);
    assert.ok(html.includes(formatExactMoney(expected, "BYN")));
    assert.ok(html.includes(formatExactMoney("1000.00", "BYN")));
  }
  assert.deepEqual([...previewAllocations("1000", [{ projectId: "project-a", percentBps: 4000 }, { projectId: "project-b", percentBps: 6000 }])], [["project-a", "400.00"], ["project-b", "600.00"]]);

  actorRoles = ["ACCOUNTANT"];
  const beforeMoney = moneyReads, beforeOptions = optionsReads;
  const docsData = await loadLogisticsWorkspace();
  assert.equal(docsData.mode, "documents");
  assert.equal(moneyReads, beforeMoney); assert.equal(optionsReads, beforeOptions);
  assert.ok(!("moneyOptions" in docsData));
  const documentsHtml = renderToStaticMarkup(React.createElement(LogisticsWorkspace, { data: docsData }));
  assert.doesNotMatch(documentsHtml, /PRIVATE_|Новый рейс|Полная стоимость|Списать из кассы|Отгрузка|Затраты проекта/);
  const fileHtml = renderToStaticMarkup(React.createElement(LogisticsDocuments, { documents: [document] }));
  assert.ok(fileHtml.includes("/api/logistics/documents/" + document.id));
  assert.ok(!fileHtml.includes("/api/files/" + document.id));
  assert.match(fileHtml, /Одна печать/);

  const unpaid = { ...managed, documents: [], money: { current: null, history: [] } };
  const formHtml = renderToStaticMarkup(React.createElement(LogisticsTripForm, { trip: unpaid, options, moneyOptions, onSaved: () => {}, onReload: () => {}, onBusyChange: () => {} }));
  assert.match(formHtml, /<button[^>]*disabled=""[^>]*>Списать из кассы<\/button>/);
  assert.match(formHtml, /multiple=""/);
  assert.match(formHtml, /Количество не ограничено/);
  assert.match(formHtml, /Подтверждаю, что на загружаемой ТТН есть выбранное количество печатей/);
  assert.equal(JSON.stringify({ managed, options, moneyOptions, budget }), baseline);

  for (const role of ["MANAGER", "ENGINEER", "WORKER", "MOUNTER"] as Role[]) {
    actorRoles = [role];
    const before = listReads;
    assert.equal(navItemsForRole(actorRoles).some(item => item.href === "/logistics"), false);
    assert.equal(canAccessOperationalPath(actorRoles, "/logistics"), false);
    assert.equal(canAccessOperationalPath(actorRoles, "/logistics/" + tripId), false);
    await assert.rejects(LogisticsPage({ searchParams: Promise.resolve({}) }), /REDIRECT:/);
    assert.equal(listReads, before);
  }
  for (const roles of [["PROCUREMENT"], ["ADMIN"], ["DIRECTOR"], ["ACCOUNTANT"], ["ACCOUNTANT", "PROCUREMENT"]] as Role[][]) {
    assert.equal(navItemsForRole(roles).some(item => item.href === "/logistics"), true);
    assert.equal(canAccessOperationalPath(roles, "/logistics"), true);
  }
  assert.equal(canManageLogistics(["ACCOUNTANT"]), false);
  assert.equal(canManageLogistics(["ACCOUNTANT", "PROCUREMENT"]), true);
});

test("article-free logistics UI enables a valid trip without setup", () => {
  const callbacks = { onSaved: () => {}, onReload: () => {}, onBusyChange: () => {} };
  const formHtml = renderToStaticMarkup(React.createElement(LogisticsTripForm, { trip: managed, options, moneyOptions, ...callbacks }));
  const correction = /<button\b([^>]*)>Исправить списание и состав рейса<\/button>/.exec(formHtml);
  assert.ok(correction, "A valid trip with cash, amount, shares and TTN must offer the cash action");
  assert.doesNotMatch(correction[1], /\bdisabled=/);
  assert.doesNotMatch(formHtml, /Статья:|статью логистики|настроить активную|администратор или директор/);
  const data = { mode: "manage" as const, rows: [managed], options, moneyOptions, query, total: 1,
    projectId: "project-a", budget, initialTrip: null };
  const workspaceHtml = renderToStaticMarkup(React.createElement(LogisticsWorkspace, { data }));
  assert.doesNotMatch(workspaceHtml, /Статья расходов логистики|Сохранить статью|расходы вне рейсов/);
  assert.match(workspaceHtml, /Потрачено/);
  assert.ok(workspaceHtml.includes(">400 BYN<"));
  assert.ok(workspaceHtml.includes(">100 BYN<"));
  assert.ok(workspaceHtml.includes(formatExactMoney("400.00", "BYN")));
  const missingTtn = { ...managed, documents: [] };
  const noTtnHtml = renderToStaticMarkup(React.createElement(LogisticsTripForm, { trip: missingTtn, options, moneyOptions, ...callbacks }));
  const blocked = /<button\b([^>]*)>Исправить списание и состав рейса<\/button>/.exec(noTtnHtml);
  assert.ok(blocked);
  assert.match(blocked[1], /\bdisabled=/);
  assert.deepEqual(Object.keys(moneyOptions), ["cashAccounts"]);
});

test("галочка разрешает списание и исправление без ТТН и объясняет состояние рейса", () => {
  const callbacks = { onSaved: () => {}, onReload: () => {}, onBusyChange: () => {} };
  const waived = { ...managed, ttnNotRequired: true, documents: [] };
  const html = renderToStaticMarkup(React.createElement(LogisticsTripForm, { trip: waived, options, moneyOptions, ...callbacks }));
  const correction = /<button\b([^>]*)>Исправить списание и состав рейса<\/button>/.exec(html)!;
  assert.ok(correction);
  assert.doesNotMatch(correction[1], /\bdisabled=/);
  assert.match(html, /Рейс можно провести без ТТН/);
  const data = { mode: "manage" as const, rows: [{ ...waived, money: { current: null, history: [] } }], options, moneyOptions,
    query, total: 1, budget: null, initialTrip: null };
  const workspace = renderToStaticMarkup(React.createElement(LogisticsWorkspace, { data }));
  assert.match(workspace, /ТТН не требуется/);
  assert.match(workspace, /Ожидает списания/);
  assert.doesNotMatch(workspace, /Нужна ТТН/);
});
