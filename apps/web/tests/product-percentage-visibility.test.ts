import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, Module } from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { getProductPercentageView } from "../src/server/product-percentage-pay/queries";
import type { ProductPercentageSectionView } from "../src/lib/product-percentage-view";

type ViewReader = Parameters<typeof getProductPercentageView>[2];

// Прогноз DRAFT считается без назначенного: нужны только ставка и цена.
test("прогноз DRAFT виден до назначения по ставке и цене", async () => {
  const product = { id: "p", quantity: 3, expectedPrice: "1000", project: { currency: "BYN" }, noModel: false, files: [], stagePayPools: [], percentageCompletions: [], engineerId: null, engineer: null, assemblerId: null, assembler: null, mounterId: null, mounter: null, percentageConfigs: [{ kind: "ENGINEERING", ratePercent: "5", revision: 1 }, { kind: "ASSEMBLY", ratePercent: "4", revision: 1 }, { kind: "INSTALLATION", ratePercent: "1.25", revision: 1 }] };
  const db = { task: { findMany: async () => [] }, productPercentageParticipant: { findMany: async () => [] }, product: { findFirst: async () => product }, user: { findMany: async () => [] }, payrollEntry: { findMany: async () => [] } } as unknown as ViewReader;
  const view = await getProductPercentageView({ id: "manager", roles: ["MANAGER"] }, "p", db);
  // v4 округляет вверх до целого: 1000×3×1.25% = 37.5 → 38.00.
  assert.deepEqual(Object.values(view.sections).map((s) => s.total), ["50.00", "120.00", "38.00"]);
});

// Поле видит только свою сумму и имена, проценты скрыты; менеджер видит всё.
test("поле не видит %, но видит свою сумму и имена; менеджер видит всё", async () => {
  const product = { id: "p", quantity: 3, expectedPrice: "1000", project: { currency: "BYN" }, noModel: false, files: [], stagePayPools: [], percentageCompletions: [], engineerId: "eng", engineer: { name: "Инженер", active: true, roles: ["ENGINEER"] }, assemblerId: "worker1", assembler: { name: "Сборщик", active: true, roles: ["WORKER"] }, mounterId: null, mounter: null, percentageConfigs: [{ kind: "ENGINEERING", ratePercent: "5", revision: 1 }, { kind: "ASSEMBLY", ratePercent: "4", revision: 1 }, { kind: "INSTALLATION", ratePercent: "7", revision: 1 }] };
  const db = { task: { findMany: async () => [] }, productPercentageParticipant: { findMany: async () => [] }, product: { findFirst: async () => product }, user: { findMany: async () => [] }, payrollEntry: { findMany: async () => [] } } as unknown as ViewReader;
  const field = await getProductPercentageView({ id: "worker1", roles: ["WORKER"] }, "p", db);
  const assembly = field.sections.ASSEMBLY;
  assert.equal(assembly.ratePercent, null);
  assert.equal(assembly.unitPrice, null);
  assert.equal(assembly.productTotal, null);
  assert.deepEqual(assembly.members.map((m) => [m.userId, m.amount]), [["worker1", "120.00"]]);
  assert.equal(assembly.total, "120.00");
  assert.equal(assembly.assignee?.name, "Сборщик");
  // Чужая назначенная секция скрыта (total null), прогноз неназначенной виден, ставка скрыта везде.
  const eng = field.sections.ENGINEERING;
  assert.equal(eng.ratePercent, null);
  assert.deepEqual(eng.members, []);
  assert.equal(eng.total, null);
  assert.equal(eng.assignee?.name, "Инженер");
  const forecast = field.sections.INSTALLATION;
  assert.equal(forecast.assignee, null);
  assert.equal(forecast.total, "210.00");
  const manager = await getProductPercentageView({ id: "manager", roles: ["MANAGER"] }, "p", db as unknown as Pick<PrismaClient, "product" | "task" | "productPercentageParticipant" | "user" | "payrollEntry">);
  assert.equal(manager.sections.ASSEMBLY.ratePercent, "4");
  assert.equal(manager.sections.ASSEMBLY.total, "120.00");
});

// Карточка: строка своей суммы всегда, % только для canViewAll, подсветка null менеджеру.
const customRequire = createRequire(import.meta.url);
function inject(name: string, exp: Record<string, unknown>) {
  const file = customRequire.resolve(name);
  const stub = new Module(file);
  (stub as unknown as { filename: string }).filename = file;
  (stub as unknown as { loaded: boolean }).loaded = true;
  stub.exports = exp;
  (customRequire.cache as unknown as Record<string, Module>)[file] = stub;
}
inject("../src/auth", { auth: async () => ({ user: { id: "viewer", roles: ["MANAGER"] } }) });
inject("next/navigation", { redirect() { throw Error("DENIED"); }, useRouter: () => ({ refresh() { throw Error("REFRESH"); } }) });
inject("../src/components/product-inline-provider", { useOptionalProductInline: () => null });
inject("../src/lib/independent-product-percentage-action", { invokeProductPercentagePatch() { throw Error("WRITE"); } });
inject("../src/server/product-percentage-pay/actions", { retryProductPercentageAction() { throw Error("WRITE"); } });
(globalThis as unknown as { React: typeof React }).React = React;
const { SinglePercentageRow } = customRequire("../src/app/(app)/products/[id]/product-percentage-panel") as typeof import("../src/app/(app)/products/[id]/product-percentage-panel");
function sectionFixture(overrides: Partial<ProductPercentageSectionView> = {}): ProductPercentageSectionView {
  return { kind: "ASSEMBLY", state: "DRAFT", hasConfiguration: true, ratePercent: "4", currentRatePercent: "4", price: "1000.00", unitPrice: "1000.00", quantity: 3, calculationVersion: 4, productCurrency: "BYN", payrollCurrency: null, total: "120.00", members: [{ userId: "worker1", name: "Сборщик", shareUnits: 1000000, amount: "120.00" }], revision: 1, canManage: false, canTransfer: false, ownMember: { userId: "worker1", name: "Сборщик", shareUnits: 1000000, amount: "120.00" }, legacyPaidSummary: null, skippedSnapshot: null, transferCandidates: [], assignee: { userId: "worker1", name: "Сборщик", active: true, eligible: true }, ...overrides };
}
test("поле видит сумму без %, менеджер видит % и подсветку null", () => {
  const fieldHtml = renderToStaticMarkup(React.createElement(SinglePercentageRow, { productId: "p", kind: "ASSEMBLY", section: { ...sectionFixture(), ratePercent: null, currentRatePercent: null, price: null, unitPrice: null, productTotal: null }, canManage: false, canViewAll: false, candidates: [] }));
  assert.match(fieldHtml, /Сумма:/);
  assert.match(fieldHtml, /120/);
  assert.doesNotMatch(fieldHtml, /Процент/);
  const managerHtml = renderToStaticMarkup(React.createElement(SinglePercentageRow, { productId: "p", kind: "ASSEMBLY", section: sectionFixture(), canManage: true, canViewAll: true, candidates: [] }));
  assert.match(managerHtml, /Процент/);
  assert.match(managerHtml, /Сумма:/);
  const nullRateHtml = renderToStaticMarkup(React.createElement(SinglePercentageRow, { productId: "p", kind: "ASSEMBLY", section: sectionFixture({ ratePercent: null, currentRatePercent: null, total: null, members: [], ownMember: null }), canManage: true, canViewAll: true, candidates: [] }));
  assert.match(nullRateHtml, /Ставка не задана/);
  assert.match(nullRateHtml, /Сумма: —/);
  // Поле не видит чужую назначенную сумму даже при просочившемся total: только «—», без цифр.
  const strangerHtml = renderToStaticMarkup(React.createElement(SinglePercentageRow, { productId: "p", kind: "INSTALLATION", section: sectionFixture({ kind: "INSTALLATION", ratePercent: null, currentRatePercent: null, price: null, unitPrice: null, productTotal: null, total: "98.00", members: [], ownMember: null, assignee: { userId: "other", name: "Чужой", active: true, eligible: true } }), canManage: false, canViewAll: false, candidates: [] }));
  assert.match(strangerHtml, /Сумма: —/);
  assert.doesNotMatch(strangerHtml, /98/);
  assert.doesNotMatch(strangerHtml, /Процент/);
});
