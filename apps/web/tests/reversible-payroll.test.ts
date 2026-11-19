import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { effectivePercentageAmount } from "../src/server/product-percentage-pay/effective-amount";
import { payrollAccrualReversal, payrollCompensationCommand } from "../src/server/payroll/accrual-reversal";
import { payoutVisibilityCommand, payoutVisibilityReversal } from "../src/server/payroll/payout-reversal";
import type { PayrollEntry, Payout } from "@prisma/client";

const D = (value: string) => new Prisma.Decimal(value);
const actor = { id: "director", name: "Ди", roles: ["DIRECTOR" as const], source: "web" as const };
const context = (tx: Prisma.TransactionClient, entityId: string) => ({ tx, actor, entityId, entryId: "original", reversalId: "undo" });

test("перерасчёт процента использует эффективную сумму после компенсации и нового доначисления", () => {
  assert.equal(effectivePercentageAmount({ amount: "100", adjustments: [
    { amount: "140", delta: "40" }, { amount: "130", delta: "30", payrollEntry: { compensations: [{ amount: "-30" }] } },
  ] }), "140.00");
  assert.equal(effectivePercentageAmount({ amount: "100", payrollEntry: { compensations: [{ amount: "-100" }] } }), "0.00");
});

test("групповое восстановление проверяет всю сумму кассы и долга до первой записи", async () => {
  const cashAccountId = "cash";
  const payout = (id: string): Payout => ({ id, userId: "user", kind: "SALARY", month: "2020-01",
    amount: D("30"), bynAmount: D("30"), cashAmount: D("30"), cashAccountId, payrollCurrency: "BYN", cashCurrency: "BYN",
    cashRate: D("1"), payrollRate: D("1"), cashRateDate: null, payrollRateDate: null, deletedAt: new Date(),
    deletedById: "previous", lastActionId: "batch-delete", batchId: "batch", createdById: "original-actor", createdAt: new Date(), comment: null });
  const rows = [payout("p1"), payout("p2")].map(row => ({ ...row, user: { name: "Сотрудник", active: true },
    cashAccount: { name: "Касса", active: true, currency: "BYN" } }));
  let available = D("59"), debt = D("59"), writes = 0;
  const tx = {
    payout: { findMany: async (input: { where: unknown }) => "batchId" in (input.where as object) ? rows : [],
      aggregate: async () => ({ _sum: { cashAmount: null } }), updateMany: async () => { writes++; return { count: 1 }; } },
    payment: { groupBy: async () => [{ direction: "INCOME", _sum: { amount: available } }],
      aggregate: async (input: { where: { direction: string } }) => ({ _sum: { bynAmount: input.where.direction === "INCOME" ? available : null } }) },
    payrollEntry: { findMany: async () => [{ amount: debt, currency: "BYN", bynAmount: debt }] },
  } as unknown as Prisma.TransactionClient;
  const command = payoutVisibilityCommand(rows, true, undefined, "batch");
  const handler = payoutVisibilityReversal.read(command.data)!;
  await assert.rejects(handler.apply(context(tx, "batch")), /средств в выбранной кассе/);
  available = D("60");
  await assert.rejects(handler.apply(context(tx, "batch")), /долг/);
  assert.equal(writes, 0);
  debt = D("60");
  await handler.apply(context(tx, "batch"));
  assert.equal(writes, 2);
});

test("отмена сдельного начисления создаёт компенсацию и сохраняет исходный факт", async () => {
  const original: PayrollEntry = { id: "entry", userId: "worker", taskId: "task", workId: "work", productId: null,
    projectId: "project", scheme: "PIECE", month: "2020-01", amount: D("50"), bynAmount: D("50"), currency: "BYN",
    projectCurrency: null, projectAmount: null, settlementShareId: null, percentageCompletionShareId: null, percentageAdjustmentId: null,
    compensatesId: null, compensationActionId: null, compensationRevision: null, comment: "Работа", createdAt: new Date() };
  let hasPayout = true, writes: unknown[] = [];
  const tx = {
    payrollEntry: { findMany: async (args: { where: { id?: object } }) => args.where.id
      ? [{ ...original, _count: { compensations: writes.length } }] : [original],
      createMany: async (input: { data: unknown[] }) => { writes = [...writes, ...input.data]; return { count: input.data.length }; } },
    payout: { count: async () => hasPayout ? 1 : 0, findMany: async () => [{ amount: D("40"), payrollCurrency: "BYN", bynAmount: D("40") }] },
  } as unknown as Prisma.TransactionClient;
  const initial = payrollCompensationCommand(original.id, [original]);
  const handler = payrollAccrualReversal.read(initial.data)!;
  await assert.rejects(handler.apply(context(tx, original.id)), /проведённой выплаты/);
  assert.deepEqual(writes, []);
  hasPayout = false;
  const reversed = await handler.apply(context(tx, original.id));
  const undone = writes[0] as { amount: Prisma.Decimal; month: string; compensatesId: string };
  assert.deepEqual([undone.amount.toFixed(2), undone.month, undone.compensatesId], ["-50.00", "2020-01", original.id]);
  await payrollAccrualReversal.read(reversed.reversal.data)!.apply(context(tx, original.id));
  assert.equal((writes[1] as typeof undone).amount.toFixed(2), "50.00");
  assert.equal(original.amount.toFixed(2), "50.00");
});
