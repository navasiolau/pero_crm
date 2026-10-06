import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, Module } from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { getProductPercentageView } from "../src/server/product-percentage-pay/queries";
import type { ProductPercentageSectionView } from "../src/lib/product-percentage-view";

type ViewReader = Parameters<typeof getProductPercentageView>[2];

test("DONE закрывает поля процента и получателя уже в серверной проекции",async()=>{
 const product={id:"p",status:"DONE",quantity:3,expectedPrice:"1000",project:{currency:"BYN"},noModel:false,files:[],stagePayPools:[],percentageCompletions:[],engineerId:null,engineer:null,assemblerId:null,assembler:null,mounterId:null,mounter:null,percentageConfigs:[]};
 const db={task:{findMany:async()=>[]},productPercentageParticipant:{findMany:async()=>[]},product:{findFirst:async()=>product},user:{findMany:async()=>[]},payrollEntry:{findMany:async()=>[]}} as unknown as ViewReader;
 assert.ok(Object.values((await getProductPercentageView({id:"m",roles:["MANAGER"]},"p",db)).sections).every(section=>section.canManage===false));
});

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
  // Неназначенный этап поле не видит в суммах вообще (прогноз только менеджерам).
  const forecast = field.sections.INSTALLATION;
  assert.equal(forecast.assignee, null);
  assert.equal(forecast.total, null);
  const manager = await getProductPercentageView({ id: "manager", roles: ["MANAGER"] }, "p", db as unknown as Pick<PrismaClient, "product" | "task" | "productPercentageParticipant" | "user" | "payrollEntry">);
  assert.equal(manager.sections.ASSEMBLY.ratePercent, "4");
  assert.equal(manager.sections.ASSEMBLY.total, "120.00");
});

// Пропущенное начисление с заданной позже ставкой: прогноз виден назначенному при любом статусе.
test("пропущенный этап показывает прогноз назначенному независимо от статуса", async () => {
  const skipped = { kind: "ASSEMBLY", state: "SKIPPED_ONCE", completedAt: new Date(0), reason: "no-rate", priceSnapshot: null, ratePercentSnapshot: null, productCurrency: "BYN", payrollCurrency: null, calculationVersion: 4, shares: [] };
  const product = { id: "p", quantity: 3, expectedPrice: "1000", project: { currency: "BYN" }, noModel: false, files: [], stagePayPools: [], percentageCompletions: [skipped], engineerId: null, engineer: null, assemblerId: "worker1", assembler: { name: "Сборщик", active: true, roles: ["WORKER"] }, mounterId: null, mounter: null, percentageConfigs: [{ kind: "ASSEMBLY", ratePercent: "4", revision: 2 }] };
  const db = { task: { findMany: async () => [] }, productPercentageParticipant: { findMany: async () => [] }, product: { findFirst: async () => product }, user: { findMany: async () => [] }, payrollEntry: { findMany: async () => [] } } as unknown as ViewReader;
  const field = await getProductPercentageView({ id: "worker1", roles: ["WORKER"] }, "p", db);
  assert.equal(field.sections.ASSEMBLY.total, "120.00");
  assert.deepEqual(field.sections.ASSEMBLY.members.map((m) => [m.userId, m.amount]), [["worker1", "120.00"]]);
  const stranger = await getProductPercentageView({ id: "other", roles: ["WORKER"] }, "p", db);
  assert.equal(stranger.sections.ASSEMBLY.total, null);
  assert.deepEqual(stranger.sections.ASSEMBLY.members, []);
});

// Завершённый этап: своя доля видна при любом статусе, чужая скрыта.
test("закрытый этап показывает свою долю назначенному", async () => {
  const done = { kind: "ASSEMBLY", state: "SETTLED", completedAt: new Date(0), reason: null, priceSnapshot: "1000", ratePercentSnapshot: "4", productCurrency: "BYN", payrollCurrency: "BYN", calculationVersion: 4, amount: "120.00", shares: [{ userId: "worker1", userNameSnapshot: "Сборщик", shareUnits: 1000000, amount: "120.00" }] };
  const product = { id: "p", quantity: 3, expectedPrice: "1000", project: { currency: "BYN" }, noModel: false, files: [], stagePayPools: [], percentageCompletions: [done], engineerId: null, engineer: null, assemblerId: "worker1", assembler: { name: "Сборщик", active: true, roles: ["WORKER"] }, mounterId: null, mounter: null, percentageConfigs: [{ kind: "ASSEMBLY", ratePercent: "4", revision: 1 }] };
  const db = { task: { findMany: async () => [] }, productPercentageParticipant: { findMany: async () => [] }, product: { findFirst: async () => product }, user: { findMany: async () => [] }, payrollEntry: { findMany: async () => [] } } as unknown as ViewReader;
  const field = await getProductPercentageView({ id: "worker1", roles: ["WORKER"] }, "p", db);
  assert.equal(field.sections.ASSEMBLY.total, "120.00");
  const stranger = await getProductPercentageView({ id: "other", roles: ["WORKER"] }, "p", db);
  assert.equal(stranger.sections.ASSEMBLY.total, null);
});

// Пропущенное начисление с пустой долей: назначенный видит прогноз, чужой — ничего.
test("пустая доля пропущенного показывает прогноз только своему назначенному", async () => {
  const skipped = { kind: "ENGINEERING", state: "SKIPPED_ONCE", completedAt: new Date(0), reason: "no-rate", priceSnapshot: null, ratePercentSnapshot: null, productCurrency: "BYN", payrollCurrency: null, calculationVersion: 4, shares: [{ userId: "eng", userNameSnapshot: "Инженер", shareUnits: 1000000, amount: null }] };
  const product = { id: "p", quantity: 2, expectedPrice: "500", project: { currency: "BYN" }, noModel: false, files: [], stagePayPools: [], percentageCompletions: [skipped], engineerId: "eng", engineer: { name: "Инженер", active: true, roles: ["ENGINEER"] }, assemblerId: null, assembler: null, mounterId: null, mounter: null, percentageConfigs: [{ kind: "ENGINEERING", ratePercent: "2", revision: 2 }] };
  const db = { task: { findMany: async () => [] }, productPercentageParticipant: { findMany: async () => [] }, product: { findFirst: async () => product }, user: { findMany: async () => [] }, payrollEntry: { findMany: async () => [] } } as unknown as ViewReader;
  const field = await getProductPercentageView({ id: "eng", roles: ["ENGINEER"] }, "p", db);
  // 500×1×2% = 10.00 (инженерный этап считается от штуки).
  assert.equal(field.sections.ENGINEERING.total, "10.00");
  const stranger = await getProductPercentageView({ id: "other", roles: ["ENGINEER"] }, "p", db);
  assert.equal(stranger.sections.ENGINEERING.total, null);
});
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
test("поле видит строки без %, менеджер видит карточки и подсветку null", () => {
  const fieldHtml = renderToStaticMarkup(React.createElement(SinglePercentageRow, { productId: "p", kind: "ASSEMBLY", section: { ...sectionFixture(), ratePercent: null, currentRatePercent: null, price: null, unitPrice: null, productTotal: null }, canManage: false, canViewAll: false, candidates: [] }));
  assert.match(fieldHtml, /Сборщик:/);
  assert.match(fieldHtml, /Сборщик;/);
  assert.match(fieldHtml, /Оплата:/);
  assert.match(fieldHtml, /120/);
  assert.doesNotMatch(fieldHtml, /Процент/);
  assert.doesNotMatch(fieldHtml, /увеличить на/);
  assert.doesNotMatch(fieldHtml, /<select/);
  // Чужая строка: только имя, без оплаты и без %.
  const strangerHtml = renderToStaticMarkup(React.createElement(SinglePercentageRow, { productId: "p", kind: "INSTALLATION", section: sectionFixture({ kind: "INSTALLATION", ratePercent: null, currentRatePercent: null, price: null, unitPrice: null, productTotal: null, total: null, members: [], ownMember: null, assignee: { userId: "other", name: "Чужой", active: true, eligible: true } }), canManage: false, canViewAll: false, candidates: [] }));
  assert.match(strangerHtml, /Чужой/);
  assert.doesNotMatch(strangerHtml, /Оплата/);
  assert.doesNotMatch(strangerHtml, /Процент/);
  const managerHtml = renderToStaticMarkup(React.createElement(SinglePercentageRow, { productId: "p", kind: "ASSEMBLY", section: sectionFixture(), canManage: true, canViewAll: true, candidates: [] }));
  assert.match(managerHtml, /Процент/);
  assert.match(managerHtml, /Сумма:/);
  const nullRateHtml = renderToStaticMarkup(React.createElement(SinglePercentageRow, { productId: "p", kind: "ASSEMBLY", section: sectionFixture({ ratePercent: null, currentRatePercent: null, total: null, members: [], ownMember: null }), canManage: true, canViewAll: true, candidates: [] }));
  assert.match(nullRateHtml, /Ставка не задана/);
  assert.match(nullRateHtml, /Сумма: —/);
});
