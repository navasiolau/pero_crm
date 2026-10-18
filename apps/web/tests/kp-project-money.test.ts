import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Prisma, type Role } from "@prisma/client";
import { patchProjectCore, getProjectPricingProjection, updateProjectFieldsCore } from "../src/server/projects/project-field-core";
import { getProjectEconomics } from "../src/server/finance/queries";
import { projectMoneyForRoles } from "../src/lib/product-financial-access";
import type { TaskTransaction } from "../src/server/tasks/transaction";

const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER"] as Role[], source: "web" as const };
const split = { servicesTotal: null, delivery: "10.00", unloading: "20.00", installation: "30.00" };
function fixture() {
  const project = { id: "p", title: "Заказ", clientId: "c", managerId: null, address: null, stage: "LEAD", currency: "BYN", initialPrice: null,
    servicesTotal: null as string | null, delivery: "10.00" as string | null, unloading: "20.00" as string | null, installation: "30.00" as string | null, proposalRoundingAdjustment: "-0.01" };
  const updates: object[] = [], logs: Record<string, unknown>[] = [], events: unknown[] = [];
  const tx = { $queryRaw: async () => [{ pricingVersion: "42" }],
    project: { findUnique: async () => ({ ...project }), update: async ({ data }: { data: object }) => { updates.push(data); return Object.assign(project, data); } },
    product: { findMany: async () => [{ quantity: 3, expectedPrice: new Prisma.Decimal("1.00") }] },
    changeLog: { findUnique: async ({ where }: { where: { id: string } }) => logs.find(log => log.id === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { logs.push(data); return data; } },
    domainEvent: { create: async ({ data }: { data: unknown }) => { events.push(data); return data; } },
  };
  const transaction: TaskTransaction = async run => run(tx as unknown as Prisma.TransactionClient);
  return { project, updates, logs, events, transaction };
}

test("реальное сохранение услуги меняет режим одной записью, возвращает полный итог и повторяет receipt", async () => {
  const f = fixture();
  const input = { projectId: "p", field: "servicesTotal" as const, value: "80.00", expectedValue: null, expectedServices: split, clientMutationId: randomUUID() };
  const saved = await patchProjectCore(actor, input, f.transaction);
  assert.equal(saved.kind, "saved");
  assert.deepEqual(f.updates[0], { servicesTotal: "80.00", delivery: null, unloading: null, installation: null });
  assert.equal(saved.kind === "saved" && saved.derived?.expectedTotalBYN, "82.99");
  assert.equal(saved.kind === "saved" && saved.derived?.proposalRoundingAdjustment, "-0.01");
  const repeated = await patchProjectCore(actor, input, f.transaction);
  assert.equal(repeated.kind === "saved" && repeated.repeated, true);
  assert.equal(f.updates.length, 1);
  assert.equal(f.logs.length, 1);
  assert.equal(f.events.length, 1);
  const projection = await getProjectPricingProjection(actor, "p", f.transaction);
  assert.equal(projection?.servicesTotal, "80.00");
  assert.equal(projection?.expectedTotalBYN, "82.99");
});

test("конкурентная смена услуги отклоняется до записи, legacy-клиент обязан подтвердить переключаемый режим", async () => {
  const f = fixture();
  f.project.installation = "31.00";
  const result = await patchProjectCore(actor, { projectId: "p", field: "servicesTotal", value: "80.00", expectedValue: null,
    expectedServices: split, clientMutationId: randomUUID() }, f.transaction);
  assert.equal(result.kind, "conflict");
  assert.deepEqual(f.updates, []);
  f.project.servicesTotal = "100.00"; f.project.delivery = null; f.project.unloading = null; f.project.installation = null;
  const stale = await updateProjectFieldsCore(actor, "p", { delivery: "10.00", baseline: { delivery: null } }, f.transaction);
  assert.equal(stale.ok, false);
  assert.deepEqual(f.updates, []);
  const fresh = await updateProjectFieldsCore(actor, "p", { delivery: "10.00", baseline: { servicesTotal: "100.00", delivery: null, unloading: null, installation: null } }, f.transaction);
  assert.equal(fresh.ok, true);
  assert.equal(f.project.servicesTotal, null);
  assert.equal(f.project.delivery, "10.00");
});

test("серверная проекция скрывает новые денежные поля от производственных ролей", () => {
  const project = { id: "p", initialPrice: "3.00", ...split, servicesTotal: "100.00", proposalRoundingAdjustment: "-0.01" };
  for (const roles of [["WORKER"], ["ENGINEER"], ["MOUNTER"], []] as Role[][]) {
    const masked = projectMoneyForRoles(project, roles);
    assert.equal(masked.servicesTotal, null);
    assert.equal(masked.proposalRoundingAdjustment, null);
    assert.equal(masked.id, "p");
  }
  for (const roles of [["MANAGER"], ["ACCOUNTANT"], ["ADMIN"], ["DIRECTOR"]] as Role[][]) assert.equal(projectMoneyForRoles(project, roles).servicesTotal, "100.00");
});

test("экономика считает только активный состав, сохраняя расходы и начисления скрытых изделий", async () => {
  let selected: unknown;
  const products = [{ expectedPrice: new Prisma.Decimal(1), quantity: 3, deletedAt: null },
    { expectedPrice: new Prisma.Decimal(200), quantity: 1, deletedAt: new Date("2026-10-18T10:00:00Z") }];
  const db = { project: { findUnique: async (input: { select: { products: { where?: { deletedAt?: unknown } } } }) => {
    selected = input;
    const activeOnly = input.select.products.where?.deletedAt === null;
    return { id: "p", currency: "BYN", servicesTotal: new Prisma.Decimal("100"),
      delivery: null, unloading: null, installation: null, proposalRoundingAdjustment: new Prisma.Decimal("-0.01"),
      products: products.filter(product => !activeOnly || product.deletedAt === null) }; } },
    payment: { findMany: async () => [] }, stockMovement: { findMany: async (input: { where: { product: object } }) => {
      assert.deepEqual(input.where.product, { projectId: "p" });
      return [{ type: "EXPENSE", totalByn: new Prisma.Decimal("5") }];
    } }, productStageSettlement: { findMany: async () => [] },
    payrollEntry: { findMany: async () => [{ amount: new Prisma.Decimal("7"), currency: "BYN", bynAmount: new Prisma.Decimal("7") }] },
    productPercentageCompletion: { findMany: async () => [] },
  } as unknown as Parameters<typeof getProjectEconomics>[1];
  const result = await getProjectEconomics("p", db);
  assert.equal(result?.expectedPrice, 102.99);
  assert.equal(result?.payrollTotal, 7);
  assert.equal(result?.expensesTotal, 5);
  assert.equal(result?.marginAtFullPrice, 90.99);
  assert.deepEqual((selected as { select: { servicesTotal: boolean; proposalRoundingAdjustment: boolean } }).select.servicesTotal, true);
  assert.equal((selected as { select: { proposalRoundingAdjustment: boolean } }).select.proposalRoundingAdjustment, true);
});
