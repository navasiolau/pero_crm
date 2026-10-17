import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type Role } from "@prisma/client";
import { guardedModuleCache } from "./helpers/guarded-module-cache";

test("material action preserves warehouse ACL/gate, returns canonical option and rolls catalog/audit back together", async () => {
  const actor = { id: "actor179", name: "Снабженец", roles: ["PROCUREMENT"] as Role[] };
  let phase = "ACTIVE", failAudit = false, transactions = 0, reads = 0;
  const materials: Prisma.MaterialUncheckedCreateInput[] = [], audits: Prisma.ChangeLogCreateInput[] = [];
  const units = [{ id: "piece", name: "шт" }, { id: "square", name: "м²" }];
  const categories = [{ id: "active", name: "Категория", active: true }, { id: "inactive", name: "Архив", active: false }];
  const tx = {
    $queryRaw: async () => { reads++; return [{ phase }]; },
    materialUnit: { findUnique: async ({ where }: { where: { id: string } }) => { reads++; return units.find(unit => unit.id === where.id) ?? null; }, findMany: async () => { reads++; return units; } },
    materialCategory: { findUnique: async ({ where }: { where: { id: string } }) => { reads++; return categories.find(category => category.id === where.id) ?? null; }, findMany: async () => { reads++; return categories.filter(category => category.active).map(({ id, name }) => ({ id, name })); } },
    material: { create: async ({ data }: { data: Prisma.MaterialUncheckedCreateInput }) => { materials.push(data); return { ...data, id: `material-${materials.length}`, purchasePrice: new Prisma.Decimal(0), measurementUnit: units.find(unit => unit.id === data.unitId) }; } },
    changeLog: { create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { if (failAudit) throw Error("AUDIT_FAILURE"); audits.push(data); return data; } },
  };
  const db = { ...tx, $transaction: async <T>(operation: (databaseTx: typeof tx) => Promise<T>) => {
    transactions++; const before = { materials: materials.length, audits: audits.length };
    try { return await operation(tx); } catch (error) { materials.length = before.materials; audits.length = before.audits; throw error; }
  } };
  const scope = guardedModuleCache(import.meta.url, { targets: ["../src/server/warehouse/actions", "../src/server/warehouse/material-create-options"], prisma: db,
    allowedOverrides: ["../src/auth", "next/cache", "../src/server/warehouse/revalidate"], overrides: {
      "../src/auth": { auth: async () => ({ user: actor }) }, "next/cache": { revalidatePath: () => {} }, "../src/server/warehouse/revalidate": { revalidateWarehouse: async () => {} },
    } });
  try {
    const actions = scope.load<typeof import("../src/server/warehouse/actions")>("../src/server/warehouse/actions");
    const { loadMaterialCreateOptions } = scope.load<typeof import("../src/server/warehouse/material-create-options")>("../src/server/warehouse/material-create-options");
    const saved = await actions.addMaterial({ name: "  Новый материал  ", sku: "  SKU  ", unitId: "square", categoryId: "active", minStock: 0.125, comment: "  Примечание  " });
    assert.deepEqual(saved, { ok: true, material: { id: "material-1", name: "Новый материал", unit: "м²", sku: "SKU", stock: 0 } });
    assert.equal(materials[0].purchasePrice, 0); assert.equal(materials[0].minStock, 0.125); assert.equal(materials[0].comment, "Примечание"); assert.equal(audits.length, 1);
    for (const roles of [["ACCOUNTANT"], ["ENGINEER"], ["WORKER"], []] as Role[][]) {
      actor.roles = roles; const before = { transactions, reads };
      await assert.rejects(actions.addMaterial({ name: "Запрещено", unitId: "piece" }), /прав/);
      assert.deepEqual({ transactions, reads }, before); assert.equal(await loadMaterialCreateOptions(actor), undefined); assert.equal(reads, before.reads);
    }
    for (const roles of [["ADMIN"], ["DIRECTOR"], ["MANAGER"], ["PROCUREMENT"], ["ACCOUNTANT", "PROCUREMENT"]] as Role[][]) {
      actor.roles = roles; const options = await loadMaterialCreateOptions(actor);
      assert.deepEqual(options, { units, categories: [{ id: "active", name: "Категория" }] });
      assert.equal((await actions.addMaterial({ name: "Разрешено", unitId: "piece" })).ok, true);
    }
    const before = { materials: materials.length, audits: audits.length };
    for (const input of [{ name: " ", unitId: "piece" }, { name: "Материал", unitId: "missing" }, { name: "Материал", unitId: "piece", categoryId: "inactive" }, { name: "Материал", unitId: "piece", minStock: -1 }, { name: "Материал", unitId: "piece", purchasePrice: 500 }]) {
      assert.equal((await actions.addMaterial(input)).ok, false);
    }
    failAudit = true; assert.equal((await actions.addMaterial({ name: "Откат", unitId: "piece" })).ok, false);
    assert.deepEqual({ materials: materials.length, audits: audits.length }, before);
    failAudit = false; phase = "FROZEN"; assert.equal((await actions.addMaterial({ name: "Во время заморозки", unitId: "piece" })).ok, false);
    phase = "VERIFYING"; assert.equal((await actions.addMaterial({ name: "До приёмки", unitId: "piece" })).ok, false);
    assert.deepEqual({ materials: materials.length, audits: audits.length }, before);
    // Неописанные Payment/Payout/StockMovement/WarehouseBalance delegates запрещены fixture guard.
  } finally { scope.restore(); }
});
