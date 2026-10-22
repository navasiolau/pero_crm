import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { allocatePercentageShares, parsePercentageRate } from "../src/lib/product-percentage-pay";
import { decideProductPercentageStatus } from "../src/lib/product-percentage-status";
import { getProductPercentageView } from "../src/server/product-percentage-pay/queries";

test("нулевая ставка допустима, null не является нулём", () => {
  assert.equal(parsePercentageRate("0"), "0.00");
  assert.equal(parsePercentageRate(null), null);
  assert.throws(() => parsePercentageRate("100.01"));
  assert.throws(() => parsePercentageRate("1.001"));
});

test("прямые доли распределяют сумму один раз и сохраняют копейки", () => {
  const shares = allocatePercentageShares("10.01", [
    { userId: "a", shareUnits: 500000 },
    { userId: "b", shareUnits: 500000 },
  ]);
  assert.deepEqual(shares, [
    { userId: "a", shareUnits: 500000, amount: "5.01" },
    { userId: "b", shareUnits: 500000, amount: "5.00" },
  ]);
  assert.throws(() => allocatePercentageShares("10.00", [{ userId: "a", shareUnits: 999999 }]));
});

test("менеджер свободен; текущий инженер DESIGN↔PRODUCTION без модели", () => {
  const context = { from: "DESIGN" as const, to: "PRODUCTION" as const, assignedEngineer: true, participant: false, hasB3d: false, noModel: false };
  assert.equal(decideProductPercentageStatus(["MANAGER", "ENGINEER"], context).allowed, true);
  assert.equal(decideProductPercentageStatus(["MANAGER"],{...context,to:"RECLAMATION"}).allowed,false);
  assert.equal(decideProductPercentageStatus(["ENGINEER"], context).allowed, true);
  assert.equal(decideProductPercentageStatus(["ENGINEER"], { ...context, hasB3d: true }).allowed, true);
  assert.equal(decideProductPercentageStatus(["ENGINEER"], { ...context, noModel: true }).allowed, true);
  assert.equal(decideProductPercentageStatus(["ENGINEER"], { ...context, to: "DONE" }).allowed, false);
  assert.equal(decideProductPercentageStatus(["WORKER", "MOUNTER"], { ...context, hasB3d: true }).allowed, false);
});

test("SKIPPED editor показывает позднюю конфигурацию отдельно от frozen history", async () => {
  const database = {
    task: { findMany: async () => [] },
    productPercentageParticipant: { findMany: async () => [] },
    product: { findFirst: async () => ({ id: "p", quantity: 3, noModel: false, engineerId: "new", engineer: { name: "Новый",active: true,roles:["ENGINEER"] },
      expectedPrice: { toString: () => "500" }, project: { currency: "USD" }, files: [], works: [], stagePayPools: [],
      percentageConfigs: [{ kind: "ENGINEERING", revision: 1, ratePercent: { toString: () => "10" },
        participants: [{ userId: "new", shareUnits: 1000000, user: { name: "Новый" } }] }],
      percentageCompletions: [{ kind: "ENGINEERING", state: "SKIPPED_ONCE", completedAt: new Date("2026-09-29T10:00:00Z"),
        reason: "Не задана ставка", priceSnapshot: { toString: () => "100" }, ratePercentSnapshot: { toString: () => "5" },
        productCurrency: "BYN", payrollCurrency: "BYN", amount: null,
        shares: [{ userId: "old", userNameSnapshot: "Старый", shareUnits: 1000000, amount: null }] }] }) },
    user: { findMany: async () => [{ id: "new", name: "Новый" }] },
    payrollEntry: { findMany: async () => [] },
  } as unknown as Pick<PrismaClient, "product" | "task" | "productPercentageParticipant" | "user" | "payrollEntry">;
  const view = await getProductPercentageView({ id: "manager", roles: ["MANAGER"] }, "p", database);
  const section = view.sections.ENGINEERING;
  assert.equal(section.state, "SKIPPED_ONCE"); assert.equal(section.canManage, true); assert.equal(section.canTransfer, false);
  assert.equal(section.ratePercent, "10"); assert.equal(section.price, "500");
  assert.equal(section.productCurrency, "USD"); assert.equal(section.payrollCurrency, null); assert.equal(section.total, null);
  assert.equal(section.currentRatePercent,"10"); assert.equal(section.assignee?.userId,"new");
  assert.deepEqual(section.members.map((member) => [member.userId, member.shareUnits, member.amount]), [["old", 1000000, null]]);
  assert.equal(section.skippedSnapshot?.price, "100"); assert.equal(section.skippedSnapshot?.ratePercent, "5");
  assert.equal(section.skippedSnapshot?.productCurrency, "BYN");
  assert.deepEqual(section.skippedSnapshot?.members.map((member) => member.userId), ["old"]);
});
