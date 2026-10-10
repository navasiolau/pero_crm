import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma, ProductStatus } from "@prisma/client";
import { changeProductStatusTransaction } from "../src/server/products/status-core";
import { patchProductPercentageCore } from "../src/server/product-percentage-pay/patch-core";
import { settleSkippedPercentage } from "../src/server/product-percentage-pay/direct-completion";
import { NO_ASSIGNEE_COMPLETION_REASON } from "../src/server/product-percentage-pay/skip-reason";
import { getProjectEconomics } from "../src/server/finance/queries";

export async function optionalAssigneesCounts(db: Pick<Prisma.TransactionClient, "user" | "client" | "project" | "product" | "productPercentageCompletion" | "productPercentageCompletionShare" | "payrollEntry">) {
  const [users, clients, projects, products, completions, shares, payroll] = await Promise.all([
    db.user.count(), db.client.count(), db.project.count(), db.product.count(), db.productPercentageCompletion.count(),
    db.productPercentageCompletionShare.count(), db.payrollEntry.count(),
  ]);
  return { users, clients, projects, products, completions, shares, payroll };
}

/** Caller проверяет local/staging цель и всегда откатывает внешнюю транзакцию. */
export async function runOptionalAssigneesAcceptance(tx: Prisma.TransactionClient) {
  const originalCounts = await optionalAssigneesCounts(tx);
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
  const marker = `qa126-${randomUUID()}`;
  const users = await Promise.all((["MANAGER", "ENGINEER", "WORKER", "MOUNTER"] as const).map(role => tx.user.create({
    data: { name: marker, email: `${marker}-${role}@invalid.local`, passwordHash: "qa-login-disabled", roles: [role] },
  })));
  const [manager, engineer, assembler, mounter] = users;
  const actor = { id: manager.id, name: manager.name, roles: manager.roles, source: "web" as const };
  const client = await tx.client.create({ data: { name: marker, phone: "QA126" } });
  const numberInt = ((await tx.project.aggregate({ _max: { numberInt: true } }))._max.numberInt ?? 0) + 1;
  const project = await tx.project.create({ data: { number: String(numberInt), numberInt, title: marker, clientId: client.id,
    managerId: manager.id, currency: "BYN" } });
  const create = async (suffix: number, assignedEngineer = false) => {
    const product = await tx.product.create({ data: { projectId: project.id, number: `${numberInt}.${suffix}`, suffixInt: suffix,
      title: marker, status: "DESIGN", quantity: 2, expectedPrice: null, ...(assignedEngineer ? { engineerId: engineer.id } : {}) } });
    await tx.productPercentageConfig.createMany({ data: (["ENGINEERING", "ASSEMBLY", "INSTALLATION"] as const).map(kind => ({
      productId: product.id, kind, ratePercent: assignedEngineer && kind === "ENGINEERING" ? null : "5", revision: 1,
    })) });
    return product;
  };
  const transition = async (productId: string, status: ProductStatus) => {
    const result = await changeProductStatusTransaction(tx, actor, productId, status);
    assert.equal(result.ok, true, "ALLOWED_STATUS_MUST_SAVE");
    assert.equal((await tx.product.findUniqueOrThrow({ where: { id: productId } })).status, status);
    return result;
  };
  const assignments = async (productId: string) => {
    for (const [kind, value] of [["ENGINEERING", engineer.id], ["ASSEMBLY", assembler.id], ["INSTALLATION", mounter.id]] as const) {
      const config = await tx.productPercentageConfig.findUniqueOrThrow({ where: { productId_kind: { productId, kind } } });
      const result = await patchProductPercentageCore(actor, { productId, kind, field: "assigneeId", value,
        expectedValue: null, expectedRevision: config.revision, clientMutationId: randomUUID() }, tx);
      assert.equal(result.ok, true);
    }
  };
  const include = { shares: true } as const;
  const snapshots = (productId: string) => tx.productPercentageCompletion.findMany({ where: { productId }, include, orderBy: { kind: "asc" } });

  // Все три назначения отсутствуют, даже заданный процент не требует цены для пропуска.
  const without = await create(1);
  const denied = await changeProductStatusTransaction(tx, { id: assembler.id, name: assembler.name, roles: assembler.roles, source: "web" }, without.id, "PRODUCTION");
  assert.equal(denied.ok, false); assert.equal((await tx.product.findUniqueOrThrow({ where: { id: without.id } })).status, "DESIGN");
  for (const status of ["PRODUCTION", "STORAGE", "INSTALLATION", "DONE"] as const) await transition(without.id, status);
  const noRecipient = await snapshots(without.id);
  assert.equal(noRecipient.length, 3);
  assert.ok(noRecipient.every(row => row.state === "SKIPPED_ONCE" && row.reason === NO_ASSIGNEE_COMPLETION_REASON &&
    row.recipientId === null && row.ratePercentSnapshot === null && row.amount === null && row.bynAmount === null &&
    row.projectAmount === null && row.shares.length === 0));
  assert.equal(await tx.payrollEntry.count({ where: { productId: without.id } }), 0);
  await tx.product.update({ where: { id: without.id }, data: { expectedPrice: "1000" } });
  await transition(without.id, "DONE");
  assert.deepEqual(await snapshots(without.id), noRecipient);

  // Без предсборки: инженера/сборщика назначают после пропуска, монтажника — до DONE.
  const onsite = await create(2);
  for (const status of ["PRODUCTION", "STORAGE", "INSTALLATION"] as const) await transition(onsite.id, status);
  const permanent = await snapshots(onsite.id);
  assert.equal(permanent.length, 2);
  await tx.product.update({ where: { id: onsite.id }, data: { expectedPrice: "1000" } });
  await assignments(onsite.id);
  for (const kind of ["ENGINEERING", "ASSEMBLY"] as const) assert.equal(await settleSkippedPercentage(tx, actor, onsite.id, kind, "INSTALLATION"), "SKIPPED_ONCE");
  await transition(onsite.id, "DONE");
  const earned = await tx.payrollEntry.findMany({ where: { productId: onsite.id } });
  assert.equal(earned.length, 1); assert.equal(earned[0].userId, mounter.id);
  assert.equal(earned[0].scheme, "PRODUCT_PERCENT_INSTALLATION"); assert.equal(earned[0].amount.toFixed(2), "100.00");
  assert.deepEqual((await snapshots(onsite.id)).filter(row => row.kind !== "INSTALLATION"), permanent);
  const actual = await snapshots(onsite.id);
  await transition(onsite.id, "DONE"); await transition(onsite.id, "INSTALLATION"); await transition(onsite.id, "DONE");
  assert.equal(await tx.payrollEntry.count({ where: { productId: onsite.id } }), 1);
  assert.deepEqual(await snapshots(onsite.id), actual);

  // SQL запрещает превратить новый постоянный пропуск в начисление.
  await tx.$executeRawUnsafe("SAVEPOINT qa126_immutable");
  try {
    const skippedAssembly = permanent.find(row => row.kind === "ASSEMBLY")!;
    const settledAt = new Date();
    // Остальные поля образуют допустимый v4 SETTLED: отказывать должна именно причина пропуска.
    await assert.rejects(tx.productPercentageCompletion.update({ where: { id: skippedAssembly.id }, data: {
      state: "SETTLED", priceSnapshot: "1000", quantitySnapshot: 2, totalSnapshot: "2000", ratePercentSnapshot: "5",
      recipientId: assembler.id, sourceFundExact: "100", amount: "100", bynAmount: "100", projectAmount: "100",
      productRateByn: "1", payrollRateByn: "1", productRateDate: settledAt, payrollRateDate: settledAt, settledAt,
    } }), /immutable/);
  } finally {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT qa126_immutable");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT qa126_immutable");
  }

  // Старый пропуск ставки у назначенного исполнителя продолжает поздний расчёт.
  const late = await create(3, true);
  await transition(late.id, "PRODUCTION");
  const beforeLate = await tx.productPercentageCompletion.findUniqueOrThrow({ where: { productId_kind: { productId: late.id, kind: "ENGINEERING" } } });
  assert.equal(beforeLate.state, "SKIPPED_ONCE"); assert.notEqual(beforeLate.reason, NO_ASSIGNEE_COMPLETION_REASON);
  await tx.product.update({ where: { id: late.id }, data: { expectedPrice: "500" } });
  const lateConfig = await tx.productPercentageConfig.findUniqueOrThrow({ where: { productId_kind: { productId: late.id, kind: "ENGINEERING" } } });
  assert.equal((await patchProductPercentageCore(actor, { productId: late.id, kind: "ENGINEERING", field: "ratePercent", value: "5",
    expectedValue: null, expectedRevision: lateConfig.revision, clientMutationId: randomUUID() }, tx)).ok, true);
  await transition(late.id, "DESIGN"); await transition(late.id, "PRODUCTION");
  const latePayroll = await tx.payrollEntry.findMany({ where: { productId: late.id } });
  assert.equal(latePayroll.length, 1); assert.equal(latePayroll[0].userId, engineer.id); assert.equal(latePayroll[0].amount.toFixed(2), "25.00");
  await transition(late.id, "PRODUCTION"); assert.equal(await tx.payrollEntry.count({ where: { productId: late.id } }), 1);
  assert.equal((await getProjectEconomics(project.id, tx))!.payrollTotal, 125);
  assert.equal(await tx.productPercentageAdjustment.count({ where: { completionShare: { completion: { productId: { in: [without.id, onsite.id, late.id] } } } } }), 0);
  return { originalCounts };
}
