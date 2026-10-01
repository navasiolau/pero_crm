import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { DomainActor } from "../src/server/projects/core";
import { configureEngineeringPool, createEngineeringWorkCore, convertUnpaidWorkToEngineering,
  closeEngineeringStageCore, prepareEngineeringQuote } from "../src/server/product-stage-pay/core";
import { engineeringIntegrationFixture } from "./helpers/product-engineering-integration-fixture";

const manager: DomainActor = { id: "manager", name: "Manager", roles: ["MANAGER"], source: "web" };

test("first configure creates DRAFT with no works using actual Prisma create return shape", async () => {
  const f = engineeringIntegrationFixture();
  f.state().pools.length = 0;
  const result = await f.transaction((tx) => configureEngineeringPool(manager, { productId: "product", ratePercent: "5.00", workWeights: [], expectedPoolRevision: 0 }, tx));
  assert.equal(result.state, "DRAFT");
  assert.equal(f.state().pools.length, 1);
  assert.equal(f.state().pools[0].ratePercent, "5.00");
  assert.equal(f.state().pools[0].revision, 1);
});

test("new work creates one 100/100 physical and financial task with ordinary required task fields", async () => {
  const f = engineeringIntegrationFixture();
  const result = await f.transaction((tx) => createEngineeringWorkCore(manager, {
    productId: "product", title: "Чертёж шкафа", quantity: "5.00", assigneeId: "primary",
    dueAt: new Date("2026-10-10T00:00:00Z"), estimateMinutes: 120,
    poolWeights: [{ workId: "__new__", units: 1_000_000 }], expectedPoolRevision: 0,
  }, tx));
  const work = f.state().works.find((row) => row.id === result.workId)!;
  const task = f.state().tasks.find((row) => row.id === result.taskId)!;
  const group = f.state().groups.find((row) => row.id === task.allocationGroupId)!;
  assert.equal(work.priceSnapshot, null);
  assert.equal(work.total, null);
  assert.equal(work.poolWeightUnits, 1_000_000);
  assert.equal(task.type, "Проектирование");
  assert.equal(task.quantity, "5.00");
  assert.equal(task.shareUnits, 1_000_000);
  assert.equal(task.stageShareUnits, 1_000_000);
  assert.equal(task.shareAmount, null);
  assert.equal(task.estimateMinutes, 120);
  assert.equal((task.dueAt as Date).toISOString(), "2026-10-10T00:00:00.000Z");
  assert.equal(group.budgetSource, "STAGE_PREVIEW");
  assert.equal(group.budget, null);
  assert.equal(group.currency, null);
  assert.equal(f.state().pools[0].revision, 1);
});

test("new work rejects an inactive assignee before writing anything", async () => {
  const f = engineeringIntegrationFixture();
  f.state().users.find((row) => row.id === "primary")!.active = false;
  await assert.rejects(f.transaction((tx) => createEngineeringWorkCore(manager, {
    productId: "product", title: "Чертёж", quantity: "1.00", assigneeId: "primary", dueAt: new Date("2026-10-10"),
    estimateMinutes: 30, poolWeights: [{ workId: "__new__", units: 1_000_000 }], expectedPoolRevision: 0,
  }, tx)), /активного/);
  assert.deepEqual(f.writes, []);
});

function legacyTwoTaskFixture() {
  const f = engineeringIntegrationFixture();
  const now = new Date("2026-09-01T00:00:00Z");
  f.state().works.push({ id: "legacy", projectId: "project", productId: "product", paymentKind: "LEGACY", stagePayPoolId: null,
    poolWeightUnits: null, title: "Работа", quantity: "5.00", priceSnapshot: "10.00", total: "50.00", createdAt: now });
  f.state().groups.push({ id: "old-group", workId: "legacy", quantity: "2.00", budget: "20.00", currency: "BYN", budgetSource: "TASK_FIXED" });
  f.state().tasks.push({ id: "task-a", workId: "legacy", projectId: "project", productId: "product", title: "A", status: "DONE",
    assigneeId: "primary", quantity: "2.00", shareUnits: 1_000_000, shareAmount: "20.00", stageShareUnits: null,
    allocationGroupId: "old-group", splitRevision: 0, executorShare: "1", doneAt: now, createdAt: now });
  f.state().tasks.push({ id: "task-b", workId: "legacy", projectId: "project", productId: "product", title: "B", status: "DONE",
    assigneeId: "second", quantity: "3.00", shareUnits: null, shareAmount: null, stageShareUnits: null,
    allocationGroupId: null, splitRevision: 0, executorShare: "1", doneAt: now, createdAt: new Date("2026-09-02T00:00:00Z") });
  f.state().times.push({ id: "time", taskId: "task-a", minutes: 45 });
  f.state().files.push({ id: "file", taskId: "task-b", fileName: "drawing.pdf" });
  f.state().dependencies.push({ id: "dependency", taskId: "task-b", dependsOnId: "task-a" });
  return f;
}

test("conversion maps 2/3 physical quantity to 80/20 finance without changing legacy snapshots or facts", async () => {
  const f = legacyTwoTaskFixture();
  const before = structuredClone({ work: f.state().works[0], tasks: f.state().tasks, groups: f.state().groups,
    times: f.state().times, files: f.state().files, dependencies: f.state().dependencies });
  const input = { workId: "legacy", poolId: "pool", poolWeights: [{ workId: "legacy", units: 1_000_000 }],
    taskShares: [{ taskId: "task-a", units: 800_000, expectedRevision: 0 }, { taskId: "task-b", units: 200_000, expectedRevision: 0 }],
    expectedPoolRevision: 0, requestId: randomUUID() };
  const receipt = await f.transaction((tx) => convertUnpaidWorkToEngineering(manager, input, tx));
  assert.equal(receipt.id, f.state().conversions[0].id);
  assert.equal(f.state().works[0].paymentKind, "ENGINEERING");
  assert.equal(f.state().works[0].stagePayPoolId, "pool");
  assert.equal(f.state().works[0].poolWeightUnits, 1_000_000);
  assert.deepEqual(f.state().tasks.map((task) => task.stageShareUnits), [800_000, 200_000]);
  for (const [index, task] of f.state().tasks.entries()) {
    const original = before.tasks[index];
    for (const key of ["id", "workId", "projectId", "productId", "status", "assigneeId", "quantity", "shareUnits", "shareAmount", "allocationGroupId", "executorShare", "doneAt"])
      assert.deepEqual(task[key], original[key], `${key} for ${task.id}`);
  }
  for (const key of ["quantity", "priceSnapshot", "total", "title", "projectId", "productId"]) assert.deepEqual(f.state().works[0][key], before.work[key]);
  assert.deepEqual(f.state().groups, before.groups);
  assert.deepEqual(f.state().times, before.times);
  assert.deepEqual(f.state().files, before.files);
  assert.deepEqual(f.state().dependencies, before.dependencies);
  assert.equal((receipt.sourceSnapshot as { work: { priceSnapshot: string } }).work.priceSnapshot, "10.00");
  assert.deepEqual((receipt.targetShares as { taskId: string; units: number }[]).map((row) => row.units), [800_000, 200_000]);
  assert.equal(f.state().pools[0].revision, 1);
  const writeCount = f.writes.length;
  const replay = await f.transaction((tx) => convertUnpaidWorkToEngineering(manager, { ...input, taskShares: [...input.taskShares].reverse() }, tx));
  assert.equal(replay.id, receipt.id);
  assert.equal(f.writes.length, writeCount);
  await assert.rejects(f.transaction((tx) => convertUnpaidWorkToEngineering(manager, { ...input, taskShares: input.taskShares.map((row) => ({ ...row, units: 500_000 })) }, tx)), /уже использован/);
});

async function readyToClose() {
  const f = legacyTwoTaskFixture();
  await f.transaction((tx) => convertUnpaidWorkToEngineering(manager, { workId: "legacy", poolId: "pool", poolWeights: [{ workId: "legacy", units: 1_000_000 }],
    taskShares: [{ taskId: "task-a", units: 800_000, expectedRevision: 0 }, { taskId: "task-b", units: 200_000, expectedRevision: 0 }],
    expectedPoolRevision: 0, requestId: randomUUID() }, tx));
  f.writes.length = 0;
  return f;
}

test("two competing close requests settle once and replay the original receipt after status advances", async () => {
  const f = await readyToClose();
  const quote = await prepareEngineeringQuote("product", f.db);
  const input = { productId: "product", expectedPoolRevision: 1, requestId: randomUUID() };
  const [first, replay] = await Promise.all([
    f.transaction((tx) => closeEngineeringStageCore(manager, input, quote, tx)),
    f.transaction((tx) => closeEngineeringStageCore(manager, input, null, tx)),
  ]);
  assert.equal(first.repeated, false);
  assert.equal(replay.repeated, true);
  assert.equal(replay.settlementId, first.settlementId);
  assert.equal(f.state().settlements.length, 1);
  assert.equal(f.state().shares.length, 2);
  assert.equal(f.state().payroll.length, 2);
  assert.equal(f.state().history.length, 1);
  assert.deepEqual(f.state().logs.map((row) => row.action).sort(), ["engineering.close", "status"]);
  assert.deepEqual(f.state().events.map((row) => row.type).sort(), ["payroll.accrued", "payroll.accrued", "product.engineeringSettled", "product.statusChanged"]);
  assert.deepEqual(f.state().events.filter((row) => row.type === "payroll.accrued").map((row) => (row.payload as { amount: number }).amount).sort((a, b) => a - b), [5, 20]);
  assert.equal(f.state().product.status, "PRODUCTION");
  assert.deepEqual(f.state().shares.map((row) => row.amount), ["20.00", "5.00"]);
  assert.equal(f.state().settlements[0].amount, "25.00");
  assert.deepEqual(f.state().payroll.map((row) => row.amount), ["20.00", "5.00"]);
  assert.ok(f.state().payroll.every((row) => row.currency === "BYN" && row.projectCurrency === "BYN"));
  await assert.rejects(f.transaction((tx) => closeEngineeringStageCore(manager, { ...input, requestId: randomUUID() }, quote, tx)), /проектирован|изменились/i);
  assert.equal(f.state().settlements.length, 1);
});

test("failure after shares, payroll, or history rolls back settlement and every dependent write", async () => {
  for (const failAt of ["share.create", "payroll.create", "history.create"]) {
    const f = await readyToClose();
    const quote = await prepareEngineeringQuote("product", f.db);
    const before = structuredClone(f.state());
    f.failAt(failAt);
    await assert.rejects(f.transaction((tx) => closeEngineeringStageCore(manager,
      { productId: "product", expectedPoolRevision: 1, requestId: randomUUID() }, quote, tx)), new RegExp(`Injected ${failAt.replace(".", "\\.")}`));
    assert.deepEqual(f.state(), before, failAt);
  }
});

test("changes to price, rate, project currency, task revision, or status invalidate prepared quote", async () => {
  for (const mutation of ["price", "rate", "currency", "revision", "status"] as const) {
    const f = await readyToClose();
    const quote = await prepareEngineeringQuote("product", f.db);
    if (mutation === "price") f.state().product.expectedPrice = "600.00";
    if (mutation === "rate") f.state().pools[0].ratePercent = "6.00";
    if (mutation === "currency") f.state().project.currency = "USD";
    if (mutation === "revision") f.state().tasks[0].splitRevision = 5;
    if (mutation === "status") f.state().tasks[1].status = "IN_PROGRESS";
    const before = structuredClone(f.state());
    await assert.rejects(f.transaction((tx) => closeEngineeringStageCore(manager,
      { productId: "product", expectedPoolRevision: 1, requestId: randomUUID() }, quote, tx)), /изменились|расчёт|курс|BYN/);
    assert.deepEqual(f.state(), before, mutation);
    assert.deepEqual(f.writes, [], mutation);
  }
});
