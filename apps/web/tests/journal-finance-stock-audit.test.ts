import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { createHash } from "node:crypto";
import test from "node:test";
import { Prisma, type Role } from "@prisma/client";
import { createMaterialInTransaction } from "../src/server/warehouse/material-core";
import { saveProductPercentageDefaults } from "../src/server/product-percentage-defaults/core";
import { EMPTY_DEFAULTS } from "../src/server/product-percentage-defaults/contracts";

type AuditRow = Record<string, unknown>;
type Presentation = {
  entity: { label: string };
  contexts: { kind: string; id: string }[];
  changes: { path: string; before: unknown; after: unknown }[];
};
const actor = { id: "audit-manager", name: "Менеджер", roles: ["ADMIN"] as Role[], source: "web" as const };
const presentation = (row: AuditRow) => {
  assert.ok(row.presentation && typeof row.presentation === "object", "Событие должно иметь полное представление");
  return row.presentation as Presentation;
};

test("создание материала сохраняет комментарий и все настройки, не меняя прежний raw audit", async () => {
  const rows: AuditRow[] = [];
  const comment = "Полное описание материала ".repeat(40);
  const tx = {
    materialUnit: { findUnique: async () => ({ id: "unit", name: "м²" }) },
    materialCategory: { findUnique: async () => ({ id: "category", name: "Плиты", active: true }) },
    material: { create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "material", ...data, measurementUnit: { name: "м²" } }) },
    changeLog: { create: async ({ data }: { data: AuditRow }) => { rows.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  const result = await createMaterialInTransaction(actor, { name: "ЛДСП", sku: "П-01", unitId: "unit", categoryId: "category", minStock: 7, comment }, tx);
  assert.ok(result.ok);
  assert.deepEqual(rows[0].newValue, { name: "ЛДСП", sku: "П-01", unitId: "unit", unit: "м²", purchasePrice: 0 });
  const view = presentation(rows[0]);
  assert.equal(view.entity.label, "Материал ЛДСП");
  assert.deepEqual(view.contexts, []);
  const values = new Map(view.changes.map(change => [change.path, change.after]));
  assert.equal(values.get("comment"), comment.trim());
  assert.equal(values.get("categoryId"), "Плиты");
  assert.equal(String(values.get("minStock")), "7");
});

test("настройка процентов сравнивает ставки, сохраняя квитанцию и повтор без второго события", async () => {
  const rows = new Map<string, AuditRow>();
  let stored: string | null = null;
  const input = { clientMutationId: "e4b53c15-858e-4415-8a26-6a3f3df278fd", expectedRevision: 0,
    expectedRates: EMPTY_DEFAULTS.rates, rates: { ENGINEERING: "2.00", ASSEMBLY: "3.00", INSTALLATION: "4.00" } };
  const tx = {
    orgSetting: { findUnique: async () => stored ? { value: stored } : null,
      upsert: async ({ create }: { create: { value: string } }) => { stored = create.value; return { value: stored }; } },
    changeLog: { findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
      create: async ({ data }: { data: AuditRow & { id: string } }) => { rows.set(data.id, data); return data; } },
  } as unknown as Prisma.TransactionClient;
  const result = await saveProductPercentageDefaults(actor, input, tx);
  assert.ok(result.ok);
  const row = [...rows.values()][0];
  assert.deepEqual(row.oldValue, EMPTY_DEFAULTS);
  assert.deepEqual(row.newValue, { fingerprint: createHash("sha256").update(JSON.stringify({ rates: input.rates,
    expectedRates: input.expectedRates, expectedRevision: input.expectedRevision, clientMutationId: input.clientMutationId })).digest("hex"), result });
  const view = presentation(row);
  assert.ok(view.changes.some(change => change.path === "rates.ENGINEERING" && change.before === null && change.after === "2.00"));
  const repeated = await saveProductPercentageDefaults(actor, input, tx);
  assert.ok(repeated.ok && repeated.repeated);
  assert.equal(rows.size, 1);
});

test("ошибка аудита создания кассы откатывает саму кассу", async () => {
  const require = createRequire(import.meta.url);
  function inject(specifier: string, exports: Record<string, unknown>) {
    const filename = require.resolve(specifier), stub = new Module(filename);
    stub.filename = filename; stub.loaded = true; stub.exports = exports; require.cache[filename] = stub;
  }
  let accounts: AuditRow[] = [];
  const tx = {
    cashAccount: { create: async ({ data }: { data: AuditRow }) => { const row = { id: "cash", ...data }; accounts.push(row); return row; } },
    changeLog: { create: async () => { throw Error("audit-unavailable"); } },
  } as unknown as Prisma.TransactionClient;
  inject("../src/server/require-role", { requireFinance: async () => ({ user: actor }), requireRole: async () => ({ user: actor }) });
  inject("../src/server/tasks/transaction", { withTaskTransaction: async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    const before = [...accounts];
    try { return await operation(tx); } catch (error) { accounts = before; throw error; }
  } });
  inject("../src/server/plugins/changelog", { writeChangeLog: async () => { throw Error("audit-unavailable"); } });
  inject("next/cache", { revalidatePath: () => undefined });
  const { addCashAccount } = require("../src/server/finance/actions") as typeof import("../src/server/finance/actions");
  await assert.rejects(addCashAccount({ name: "Касса", currency: "BYN", comment: "Первичная касса" }), /audit-unavailable/);
  assert.equal(accounts.length, 0);
});

test("расценка сохраняет категорию и откатывает изменение при отказе аудита", async () => {
  const require = createRequire(import.meta.url);
  function inject(specifier: string, exports: Record<string, unknown>) {
    const filename = require.resolve(specifier), stub = new Module(filename);
    stub.filename = filename; stub.loaded = true; stub.exports = exports; require.cache[filename] = stub;
  }
  let item = { id: "price", name: "Присадка", price: new Prisma.Decimal(5), unit: "отв", category: "Сверление", active: true };
  let auditFails = true;
  const rows: AuditRow[] = [];
  const tx = {
    priceItem: { findUnique: async () => item,
      update: async ({ data }: { data: Partial<typeof item> }) => { item = { ...item, ...data, price: new Prisma.Decimal(data.price ?? item.price) }; return item; } },
    changeLog: { create: async ({ data }: { data: AuditRow }) => { if (auditFails) throw Error("price-audit-failed"); rows.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  inject("../src/auth", { auth: async () => ({ user: actor }) });
  inject("../src/server/tasks/transaction", { withTaskTransaction: async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    const before = { ...item }, rowCount = rows.length;
    try { return await operation(tx); } catch (error) { item = before; rows.length = rowCount; throw error; }
  } });
  inject("next/cache", { revalidatePath: () => undefined });
  const { updatePriceItem, togglePriceItem } = require("../src/server/prices/actions") as typeof import("../src/server/prices/actions");
  const change = { name: item.name, unit: item.unit, price: 7.5, category: "Сложная присадка" };
  await assert.rejects(updatePriceItem(item.id, change), /price-audit-failed/);
  assert.equal(item.price.toString(), "5"); assert.equal(item.category, "Сверление"); assert.equal(rows.length, 0);
  auditFails = false;
  assert.ok((await updatePriceItem(item.id, change)).ok);
  const view = presentation(rows[0]);
  assert.ok(view.changes.some(field => field.path === "category" && field.before === "Сверление" && field.after === "Сложная присадка"));
  assert.equal(item.price.toString(), "7.5");
  await togglePriceItem(item.id, true);
  assert.equal(rows.length, 1, "Повтор сохранённой активности не создаёт ложного изменения");
  await togglePriceItem(item.id, false);
  assert.equal(rows.length, 2); assert.equal(item.active, false);
});
