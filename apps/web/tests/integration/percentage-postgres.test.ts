import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Prisma, type ProductPercentageKind } from "@prisma/client";
import { createPostgresFixture, rejectedSql, type PostgresRows } from "./postgres.fixture";
import { NO_ASSIGNEE_COMPLETION_REASON } from "../../src/server/product-percentage-pay/skip-reason";

let fixture: Awaited<ReturnType<typeof createPostgresFixture>>;
let core: typeof import("../../src/server/product-percentage-pay/core");
let direct: typeof import("../../src/server/product-percentage-pay/direct-completion");
let patch: typeof import("../../src/server/product-percentage-pay/patch-core");
let views: typeof import("../../src/server/product-percentage-pay/queries");
let statuses: typeof import("../../src/server/products/status-core");
let finance: typeof import("../../src/server/finance/queries");
before(async () => {
  fixture = await createPostgresFixture("percentage");
  [core, direct, patch, views, statuses, finance] = await Promise.all([
    import("../../src/server/product-percentage-pay/core"), import("../../src/server/product-percentage-pay/direct-completion"),
    import("../../src/server/product-percentage-pay/patch-core"), import("../../src/server/product-percentage-pay/queries"),
    import("../../src/server/products/status-core"), import("../../src/server/finance/queries"),
  ]);
});
after(async () => { if (fixture) try { await fixture.verifyProtected(); } finally { await fixture.dispose(); } });
const kinds = ["ENGINEERING", "ASSEMBLY", "INSTALLATION"] as const;
async function context(rows: PostgresRows) {
  const [manager, engineer, assembler, mounter] = await Promise.all([
    rows.user("manager", ["MANAGER"]), rows.user("engineer", ["ENGINEER"]), rows.user("assembler", ["WORKER"]), rows.user("mounter", ["MOUNTER"]),
  ]);
  const project = await rows.project("money", { stage: "CONTRACT", managerId: manager.id, currency: "BYN" });
  return { actor: { id: manager.id, name: manager.name, roles: manager.roles, source: "web" as const }, project,
    recipients: [engineer, assembler, mounter], assigned: { engineerId: engineer.id, assemblerId: assembler.id, mounterId: mounter.id } };
}
const snapshots = (tx: Prisma.TransactionClient, productId: string) => tx.productPercentageCompletion.findMany({ where: { productId }, include: { shares: true }, orderBy: { kind: "asc" } });

for (const vector of [
  { id: "fraction", price: "19986.00", quantity: 1, rates: ["5", "5", "5"], amounts: ["1000.00", "1000.00", "1000.00"] },
  { id: "tiny", price: "0.01", quantity: 1, rates: ["1", "1", "1"], amounts: ["1.00", "1.00", "1.00"] },
  { id: "batch", price: "1000.00", quantity: 3, rates: ["5", "4", "7"], amounts: ["50.00", "120.00", "210.00"] },
  { id: "zero", price: null, quantity: 3, rates: ["0", "0", "0"], amounts: ["0.00", "0.00", "0.00"] },
  { id: "zero-price", price: "0", quantity: 3, rates: ["5", "4", "7"], amounts: ["0.00", "0.00", "0.00"] },
  { id: "upper", price: "9999999999", quantity: 1, rates: ["15", "15", "15"], amounts: ["1500000000.00", "1500000000.00", "1500000000.00"] },
]) test(`percentage/ceil-matrix/${vector.id}`, async () => fixture.rollback(async (tx, rows) => {
  const c = await context(rows), product = await rows.product("item", c.project.id, { ...c.assigned, status: "DESIGN", expectedPrice: vector.price, quantity: vector.quantity });
  await tx.productPercentageConfig.createMany({ data: kinds.map((kind, index) => ({ productId: product.id, kind, ratePercent: vector.rates[index], revision: 1 })) });
  if (vector.id === "batch") {
    const work = await tx.work.create({ data: { projectId: c.project.id, productId: product.id, title: "Обычная уже оплаченная работа", quantity: "1", priceSnapshot: "10", total: "10", paymentKind: "LEGACY" } });
    const task = await tx.task.create({ data: { projectId: c.project.id, productId: product.id, workId: work.id, title: work.title, assigneeId: c.recipients[0].id, quantity: "1", status: "DONE" } });
    await tx.payrollEntry.create({ data: { userId: c.recipients[0].id, projectId: c.project.id, productId: product.id, taskId: task.id, workId: work.id, scheme: "PIECE", amount: "10", bynAmount: "10", currency: "BYN", month: "2000-01" } });
  }
  const draft = await views.getProductPercentageView(c.actor, product.id, tx);
  assert.deepEqual(kinds.map(kind => draft.sections[kind].total), vector.amounts);
  assert.ok(kinds.every(kind => draft.sections[kind].calculationVersion === 4));
  assert.equal((await statuses.changeProductStatusTransaction(tx, c.actor, product.id, "DONE")).ok, true);
  const frozen = await snapshots(tx, product.id), payroll = await tx.payrollEntry.findMany({ where: { productId: product.id }, orderBy: { id: "asc" } });
  for (const [index, kind] of kinds.entries()) {
    const saved = frozen.find(row => row.kind === kind)!;
    assert.equal(saved.state, "SETTLED"); assert.equal(saved.calculationVersion, 4); assert.equal(saved.quantitySnapshot, vector.quantity);
    assert.equal(saved.amount!.toFixed(2), vector.amounts[index]); assert.equal(saved.bynAmount!.toFixed(2), vector.amounts[index]);
    assert.equal(saved.projectAmount!.toFixed(2), vector.amounts[index]); assert.equal(saved.shares.length, 1);
    const paid = payroll.filter(row => row.percentageCompletionShareId === saved.shares[0].id);
    assert.equal(paid.length, vector.amounts[index] === "0.00" ? 0 : 1);
    if (paid.length) assert.equal(paid[0].amount.toFixed(2), vector.amounts[index]);
  }
  assert.equal(await tx.domainEvent.count({ where: { actor: c.actor.id, type: "payroll.accrued" } }), vector.amounts.filter(amount => amount !== "0.00").length);
  for (const status of ["DESIGN", "DONE", "DESIGN", "DONE"] as const)
    assert.equal((await statuses.changeProductStatusTransaction(tx, c.actor, product.id, status)).ok, true);
  assert.deepEqual(await snapshots(tx, product.id), frozen); assert.deepEqual(await tx.payrollEntry.findMany({ where: { productId: product.id }, orderBy: { id: "asc" } }), payroll);
}));

test("percentage/null-config-vs-zero-and-late-settlement", async () => fixture.rollback(async (tx, rows) => {
  const c = await context(rows);
  for (const rate of [undefined, null, "0"] as const) {
    const label = rate === undefined ? "missing" : rate === null ? "null" : "zero";
    const product = await rows.product(label, c.project.id, { ...c.assigned, status: "DESIGN", expectedPrice: "1000", quantity: 3 });
    if (rate !== undefined) await tx.productPercentageConfig.create({ data: { productId: product.id, kind: "ASSEMBLY", ratePercent: rate, revision: 1 } });
    assert.equal(await core.captureProductPercentageCompletion(tx, c.actor, product.id, "ASSEMBLY", "STORAGE"), rate === "0" ? "SETTLED" : "SKIPPED_ONCE");
    const saved = (await snapshots(tx, product.id))[0];
    assert.equal(saved.amount?.toFixed(2) ?? null, rate === "0" ? "0.00" : null);
    assert.equal(saved.ratePercentSnapshot?.toString() ?? null, rate === "0" ? "0" : null);
    assert.equal(saved.configRevision, rate === undefined ? null : 1);
    assert.equal(await tx.payrollEntry.count({ where: { productId: product.id } }), 0);
    await tx.productPercentageConfig.upsert({ where: { productId_kind: { productId: product.id, kind: "ASSEMBLY" } },
      create: { productId: product.id, kind: "ASSEMBLY", ratePercent: "5", revision: 2 }, update: { ratePercent: "5", revision: 2 } });
    if (rate !== "0") {
      assert.equal(await direct.settleSkippedPercentage(tx, c.actor, product.id, "ASSEMBLY", "STORAGE"), "SETTLED");
      assert.equal(await direct.settleSkippedPercentage(tx, c.actor, product.id, "ASSEMBLY", "STORAGE"), "SETTLED");
      assert.equal((await tx.payrollEntry.findFirstOrThrow({ where: { productId: product.id } })).amount.toFixed(2), "150.00");
      assert.equal(await tx.payrollEntry.count({ where: { productId: product.id } }), 1);
    }
  }
}));

test("percentage/permanent-unassigned-and-history-protected", async () => fixture.rollback(async (tx, rows) => {
  const c = await context(rows), product = await rows.product("unassigned", c.project.id, { status: "DESIGN", expectedPrice: null, quantity: 3 });
  await tx.productPercentageConfig.createMany({ data: kinds.map(kind => ({ productId: product.id, kind, ratePercent: "5" })) });
  for (const kind of kinds) assert.equal(await core.captureProductPercentageCompletion(tx, c.actor, product.id, kind, "DONE"), "SKIPPED_ONCE");
  const frozen = await snapshots(tx, product.id);
  assert.ok(frozen.every(row => row.reason === NO_ASSIGNEE_COMPLETION_REASON && row.recipientId === null && row.ratePercentSnapshot === null));
  await tx.product.update({ where: { id: product.id }, data: { ...c.assigned, expectedPrice: "500" } });
  for (const kind of kinds) assert.equal(await core.captureProductPercentageCompletion(tx, c.actor, product.id, kind, "DONE"), "SKIPPED_ONCE");
  assert.deepEqual(await snapshots(tx, product.id), frozen); assert.equal(await tx.payrollEntry.count({ where: { productId: product.id } }), 0);
  for (const status of ["PRODUCTION", "STORAGE", "INSTALLATION", "DONE"] as const) {
    const historical = await rows.product(`history-${status.toLowerCase()}`, c.project.id, { ...c.assigned, status, expectedPrice: "1000" });
    assert.equal(await core.captureProductPercentageCompletion(tx, c.actor, historical.id, "ENGINEERING", "DONE"), "LEGACY_PROTECTED");
    assert.equal(await tx.productPercentageCompletion.count({ where: { productId: historical.id } }), 0);
    assert.equal(await tx.payrollEntry.count({ where: { productId: historical.id } }), 0);
  }
  for (const mode of ["missing-price", "inactive", "role", "rate"] as const) {
    const recipient = await rows.user(`invalid-${mode}`, mode === "role" ? ["WORKER"] : ["ENGINEER"], { active: mode !== "inactive" });
    const invalid = await rows.product(`invalid-${mode}`, c.project.id, { status: "DESIGN", engineerId: recipient.id, expectedPrice: mode === "missing-price" ? null : "1000" });
    await tx.productPercentageConfig.create({ data: { productId: invalid.id, kind: "ENGINEERING", ratePercent: mode === "rate" ? "15.01" : "5" } });
    await assert.rejects(core.captureProductPercentageCompletion(tx, c.actor, invalid.id, "ENGINEERING", "PRODUCTION"), mode === "missing-price" ? /укажите цену/ : mode === "rate" ? /15/ : /активного.*инженер/i);
    assert.equal(await tx.productPercentageCompletion.count({ where: { productId: invalid.id } }), 0);
    assert.equal(await tx.payrollEntry.count({ where: { productId: invalid.id } }), 0);
  }
  const returned = await rows.product("returned-history", c.project.id, { ...c.assigned, status: "DESIGN", expectedPrice: "1000" });
  await tx.productStatusHistory.create({ data: { productId: returned.id, fromStatus: "DESIGN", toStatus: "DONE", changedById: c.actor.id } });
  assert.equal((await statuses.changeProductStatusTransaction(tx, c.actor, returned.id, "DONE")).ok, true);
  assert.equal(await tx.productPercentageCompletion.count({ where: { productId: returned.id } }), 0);
  assert.equal(await tx.payrollEntry.count({ where: { productId: returned.id } }), 0);
  const late = await rows.product("late-mounter-only", c.project.id, { status: "DESIGN", expectedPrice: "1000", quantity: 2 });
  await tx.productPercentageConfig.createMany({ data: kinds.map(kind => ({ productId: late.id, kind, ratePercent: "5" })) });
  for (const status of ["PRODUCTION", "STORAGE", "INSTALLATION"] as const) assert.equal((await statuses.changeProductStatusTransaction(tx, c.actor, late.id, status)).ok, true);
  const skipped = await snapshots(tx, late.id);
  assert.equal(skipped.length, 2); assert.ok(skipped.every(row => row.state === "SKIPPED_ONCE" && row.kind !== "INSTALLATION"));
  await tx.product.update({ where: { id: late.id }, data: { mounterId: c.recipients[2].id } });
  assert.equal((await statuses.changeProductStatusTransaction(tx, c.actor, late.id, "DONE")).ok, true);
  assert.equal((await tx.payrollEntry.findFirstOrThrow({ where: { productId: late.id } })).amount.toFixed(2), "100.00");
  assert.equal(await tx.payrollEntry.count({ where: { productId: late.id } }), 1);
  assert.deepEqual((await snapshots(tx, late.id)).filter(row => row.kind !== "INSTALLATION"), skipped);
}));

test("percentage/status-SKIPPED-patch-next-transition-settlement-adjustment-DONE", async () => fixture.rollback(async (tx, rows) => {
  const c = await context(rows), product = await rows.product("status-bridge", c.project.id, { ...c.assigned, status: "DESIGN", expectedPrice: "500", quantity: 3 });
  const first = await statuses.changeProductStatusTransaction(tx, c.actor, product.id, "PRODUCTION"); assert.equal(first.ok, true);
  const skipped = await tx.productPercentageCompletion.findUniqueOrThrow({ where: { productId_kind: { productId: product.id, kind: "ENGINEERING" } } });
  assert.equal(skipped.state, "SKIPPED_ONCE"); assert.equal(await tx.payrollEntry.count({ where: { productId: product.id } }), 0);
  const input = { productId: product.id, kind: "ENGINEERING" as const, field: "ratePercent" as const, value: "10", expectedValue: null, expectedRevision: 0, clientMutationId: randomUUID() };
  const changed = await patch.patchProductPercentageCore(c.actor, input, tx); assert.equal(changed.ok, true);
  assert.equal((await statuses.changeProductStatusTransaction(tx, c.actor, product.id, "DESIGN")).ok, true);
  assert.equal((await statuses.changeProductStatusTransaction(tx, c.actor, product.id, "PRODUCTION")).ok, true);
  const settled = await tx.productPercentageCompletion.findUniqueOrThrow({ where: { id: skipped.id }, include: { shares: true } });
  assert.equal(settled.state, "SETTLED"); assert.equal(settled.amount!.toFixed(2), "50.00"); assert.equal(settled.shares.length, 1);
  assert.equal(await tx.payrollEntry.count({ where: { productId: product.id } }), 1);
  const adjustment = await patch.patchProductPercentageCore(c.actor, { ...input, value: "11", expectedValue: "10", expectedRevision: 1, clientMutationId: randomUUID() }, tx);
  assert.equal(adjustment.ok, true); assert.equal(await tx.payrollEntry.count({ where: { productId: product.id } }), 2);
  assert.deepEqual(await tx.productPercentageCompletion.findUnique({ where: { id: skipped.id }, include: { shares: true } }), settled);
  assert.equal((await statuses.changeProductStatusTransaction(tx, c.actor, product.id, "DONE")).ok, true);
  const before = await snapshots(tx, product.id), entries = await tx.payrollEntry.findMany({ where: { productId: product.id }, orderBy: { id: "asc" } });
  const locked = await patch.patchProductPercentageCore(c.actor, { ...input, value: "12", expectedValue: "11", expectedRevision: 2, clientMutationId: randomUUID() }, tx);
  assert.equal(locked.ok, false); assert.deepEqual(await snapshots(tx, product.id), before);
  assert.deepEqual(await tx.payrollEntry.findMany({ where: { productId: product.id }, orderBy: { id: "asc" } }), entries);
}));

test("percentage/adjustments-immutable-cas-replay-and-native-constraints", async () => fixture.rollback(async (tx, rows) => {
  const c = await context(rows), product = await rows.product("adjusted", c.project.id, { ...c.assigned, status: "PRODUCTION", expectedPrice: "1000", quantity: 3 });
  await tx.productPercentageConfig.createMany({ data: kinds.map(kind => ({ productId: product.id, kind, ratePercent: "5", revision: 1 })) });
  const oldConfig = await tx.productPercentageConfig.findUniqueOrThrow({ where: { productId_kind: { productId: product.id, kind: "ENGINEERING" } } });
  const participant = await tx.productPercentageParticipant.create({ data: { configId: oldConfig.id, userId: c.recipients[0].id, shareUnits: 1000000 } });
  const invalidRate = await patch.patchProductPercentageCore(c.actor, { productId: product.id, kind: "ENGINEERING", field: "ratePercent", value: "15.01", expectedValue: "5", expectedRevision: 1, clientMutationId: randomUUID() }, tx);
  assert.equal(invalidRate.kind, "validation"); assert.deepEqual(await tx.productPercentageConfig.findUnique({ where: { id: oldConfig.id } }), oldConfig);
  const noOp = await patch.patchProductPercentageCore(c.actor, { productId: product.id, kind: "ENGINEERING", field: "ratePercent", value: "5", expectedValue: "5", expectedRevision: 1, clientMutationId: randomUUID() }, tx);
  assert.ok(noOp.ok && noOp.noOp); assert.deepEqual(await tx.productPercentageConfig.findUnique({ where: { id: oldConfig.id } }), oldConfig);
  for (const kind of kinds) await direct.captureDirectPercentage(tx, c.actor, product.id, kind, "INSTALLATION");
  const frozen = await snapshots(tx, product.id), originalPayroll = await tx.payrollEntry.findMany({ where: { productId: product.id }, orderBy: { id: "asc" } });
  const assemblyConfig = await tx.productPercentageConfig.findUniqueOrThrow({ where: { productId_kind: { productId: product.id, kind: "ASSEMBLY" } } });
  const replacement = await rows.user("replacement-assembler", ["MANAGER", "WORKER"]), inactive = await rows.user("inactive-assembler", ["WORKER"], { active: false });
  const assignment = { productId: product.id, kind: "ASSEMBLY" as const, field: "assigneeId" as const, value: replacement.id, expectedValue: c.recipients[1].id, expectedRevision: assemblyConfig.revision, clientMutationId: randomUUID() };
  for (const recipient of [inactive, c.recipients[2]]) {
    const denied = await patch.patchProductPercentageCore(c.actor, { ...assignment, value: recipient.id }, tx);
    assert.equal(denied.kind, "validation"); assert.deepEqual(await tx.productPercentageConfig.findUnique({ where: { id: assemblyConfig.id } }), assemblyConfig);
  }
  assert.equal((await patch.patchProductPercentageCore(c.actor, assignment, tx)).ok, true);
  assert.equal((await tx.product.findUniqueOrThrow({ where: { id: product.id } })).assemblerId, replacement.id);
  assert.deepEqual(await snapshots(tx, product.id), frozen); assert.deepEqual(await tx.payrollEntry.findMany({ where: { productId: product.id }, orderBy: { id: "asc" } }), originalPayroll);
  assert.equal((await patch.patchProductPercentageCore(c.actor, { ...assignment, value: c.recipients[1].id }, tx)).kind, "validation", "SAME_UUID_CHANGED_PAYLOAD_REFUSED");
  assert.equal((await patch.patchProductPercentageCore(c.actor, { ...assignment, value: c.recipients[1].id, expectedValue: replacement.id, expectedRevision: assemblyConfig.revision + 1, clientMutationId: randomUUID() }, tx)).ok, true);
  const patchRate = async (kind: ProductPercentageKind, value: string) => {
    const config = await tx.productPercentageConfig.findUniqueOrThrow({ where: { productId_kind: { productId: product.id, kind } } });
    const input = { productId: product.id, kind, field: "ratePercent" as const, value, expectedValue: config.ratePercent!.toString(), expectedRevision: config.revision, clientMutationId: randomUUID() };
    const notices: Parameters<typeof patch.patchProductPercentageCore>[3] = [];
    assert.equal((await patch.patchProductPercentageCore(c.actor, input, tx, notices)).ok, true);
    const saved = await tx.productPercentageAdjustment.findUniqueOrThrow({ where: { clientMutationId: input.clientMutationId } });
    const count = await tx.payrollEntry.count({ where: { productId: product.id } });
    const repeated = await patch.patchProductPercentageCore(c.actor, input, tx, []);
    assert.equal(repeated.ok, true); if (repeated.ok) assert.equal(repeated.repeated, true);
    assert.equal(await tx.payrollEntry.count({ where: { productId: product.id } }), count);
    const stale = await patch.patchProductPercentageCore(c.actor, { ...input, clientMutationId: randomUUID() }, tx, []);
    assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.kind, "conflict");
    return { notices, saved };
  };
  for (const step of [
    { rate: "6", totals: ["60.00", "180.00", "180.00"], dtoTotals: ["60", "180", "180"], deltas: ["10.00", "30.00", "30.00"], total: 420 },
    { rate: "4", totals: ["40.00", "120.00", "120.00"], dtoTotals: ["40", "120", "120"], deltas: ["-20.00", "-60.00", "-60.00"], total: 280 },
    { rate: "0", totals: ["0.00", "0.00", "0.00"], dtoTotals: ["0", "0", "0"], deltas: ["-40.00", "-120.00", "-120.00"], total: 0 },
  ]) {
    for (const [index, kind] of kinds.entries()) {
      // Монтажник читает изделие на установке; инженер — на производстве. ACL остаётся настоящим.
      await tx.product.update({ where: { id: product.id }, data: { status: kind === "INSTALLATION" ? "INSTALLATION" : "PRODUCTION" } });
      const { notices, saved } = await patchRate(kind, step.rate);
      assert.equal(saved.amount.toFixed(2), step.totals[index]); assert.equal(saved.delta.toFixed(2), step.deltas[index]); assert.equal(notices.length, 1);
      const employee = c.recipients[index], view = await views.getProductPercentageView({ id: employee.id, roles: employee.roles }, product.id, tx);
      const managerView = await views.getProductPercentageView(c.actor, product.id, tx);
      for (const total of [view.sections[kind].total, managerView.sections[kind].total]) {
        assert.notEqual(total, null); assert.ok(new Prisma.Decimal(total!).eq(step.totals[index]));
        assert.equal(total, step.dtoTotals[index]);
      }
      assert.equal((await tx.payrollEntry.aggregate({ where: { productId: product.id, userId: employee.id }, _sum: { amount: true } }))._sum.amount!.toFixed(2), step.totals[index]);
    }
    assert.equal((await finance.getProjectEconomics(c.project.id, tx))!.payrollTotal, step.total);
  }
  assert.deepEqual(await snapshots(tx, product.id), frozen);
  assert.deepEqual(await tx.productPercentageParticipant.findUnique({ where: { id: participant.id } }), participant);
  assert.deepEqual(await tx.payrollEntry.findMany({ where: { id: { in: originalPayroll.map(row => row.id) } }, orderBy: { id: "asc" } }), originalPayroll);
  await tx.product.update({ where: { id: product.id }, data: { expectedPrice: "1" } });
  await patchRate("ASSEMBLY", "1"); const count = await tx.payrollEntry.count({ where: { productId: product.id } });
  const zeroDelta = await patchRate("ASSEMBLY", "1.5");
  assert.equal(zeroDelta.saved.delta.toFixed(2), "0.00"); assert.equal(zeroDelta.notices.length, 0); assert.equal(await tx.payrollEntry.count({ where: { productId: product.id } }), count);
  const adjustment = await tx.productPercentageAdjustment.findFirstOrThrow({ where: { completionShareId: frozen[0].shares[0].id } });
  for (const operation of [
    () => tx.productPercentageCompletion.update({ where: { id: frozen[0].id }, data: { amount: "999" } }),
    () => tx.productPercentageCompletionShare.update({ where: { id: frozen[0].shares[0].id }, data: { shareUnits: 999999 } }),
    () => tx.productPercentageAdjustment.update({ where: { id: adjustment.id }, data: { amount: "999" } }),
    () => tx.payrollEntry.delete({ where: { id: originalPayroll[0].id } }),
  ]) await rejectedSql(tx, operation, /append-only|immutable/);
  const { id: _id, createdAt: _createdAt, ...duplicate } = originalPayroll[0]; void _id; void _createdAt;
  await rejectedSql(tx, () => tx.payrollEntry.create({ data: duplicate }), /Unique constraint/);
  await tx.product.update({ where: { id: product.id }, data: { expectedPrice: "1000" } });
  const failureMutation = randomUUID();
  await tx.productPercentageConfig.update({ where: { productId_kind: { productId: product.id, kind: "ENGINEERING" } }, data: { ratePercent: "5", revision: { increment: 1 } } });
  // Прямой writer создаёт adjustment с UUID, но не patch receipt: следующий patch падает на настоящей SQL unique после UPDATE ставки.
  await direct.adjustSettledPercentage(tx, c.actor, product.id, "ENGINEERING", "5", failureMutation);
  const configBefore = await tx.productPercentageConfig.findUniqueOrThrow({ where: { productId_kind: { productId: product.id, kind: "ENGINEERING" } } });
  const moneyBefore = await tx.payrollEntry.findMany({ where: { productId: product.id }, orderBy: { id: "asc" } });
  await rejectedSql(tx, () => patch.patchProductPercentageCore(c.actor, { productId: product.id, kind: "ENGINEERING", field: "ratePercent", value: "6", expectedValue: "5", expectedRevision: configBefore.revision, clientMutationId: failureMutation }, tx), /Unique constraint/);
  assert.deepEqual(await tx.productPercentageConfig.findUnique({ where: { id: configBefore.id } }), configBefore, "RATE_UPDATE_ROLLED_BACK_AFTER_SQL_FAILURE");
  assert.deepEqual(await tx.payrollEntry.findMany({ where: { productId: product.id }, orderBy: { id: "asc" } }), moneyBefore);
  await tx.product.update({ where: { id: product.id }, data: { status: "DONE" } });
  const blocked = await patch.patchProductPercentageCore(c.actor, { productId: product.id, kind: "ENGINEERING", field: "ratePercent", value: "6", expectedValue: "5", expectedRevision: configBefore.revision, clientMutationId: randomUUID() }, tx);
  assert.equal(blocked.ok, false); if (!blocked.ok) assert.equal(blocked.kind, "forbidden");
  assert.deepEqual(await tx.productPercentageConfig.findUnique({ where: { id: configBefore.id } }), configBefore);
  const hidden = await rows.product("hidden-patch", c.project.id, { status: "DRAFT" });
  const invisible = await patch.patchProductPercentageCore(c.actor, { productId: hidden.id, kind: "ASSEMBLY", field: "ratePercent", value: "5", expectedValue: null, expectedRevision: 9, clientMutationId: randomUUID() }, tx);
  assert.equal(invisible.kind, "not-found"); assert.equal("currentValue" in invisible || "currentRevision" in invisible, false);
  assert.equal(await tx.productPercentageConfig.count({ where: { productId: hidden.id } }), 0);
}));

test("percentage/historical-zero-without-recipient-first-adjustment", async () => fixture.rollback(async (tx, rows) => {
  const c = await context(rows), product = await rows.product("historical-zero", c.project.id, { status: "PRODUCTION", expectedPrice: "1000", quantity: 3 });
  const stamp = new Date("2026-09-30T00:00:00.000Z");
  await tx.productPercentageConfig.create({ data: { productId: product.id, kind: "ASSEMBLY", ratePercent: "0", revision: 1 } });
  const frozen = await tx.productPercentageCompletion.create({ data: { productId: product.id, kind: "ASSEMBLY", state: "SETTLED", calculationVersion: 4,
    completedAt: stamp, statusAtCompletion: "STORAGE", completedById: c.actor.id, quantitySnapshot: 3, totalSnapshot: "3000", priceSnapshot: "1000", ratePercentSnapshot: "0",
    productCurrency: "BYN", payrollCurrency: "BYN", productRateByn: "1", payrollRateByn: "1", productRateDate: stamp, payrollRateDate: stamp,
    amount: "0", bynAmount: "0", projectAmount: "0", sourceFundExact: "0", settledAt: stamp } });
  await tx.product.update({ where: { id: product.id }, data: { assemblerId: c.recipients[1].id } });
  const input = { productId: product.id, kind: "ASSEMBLY" as const, field: "ratePercent" as const, value: "5", expectedValue: "0", expectedRevision: 1, clientMutationId: randomUUID() };
  assert.equal((await patch.patchProductPercentageCore(c.actor, input, tx)).ok, true);
  assert.equal((await tx.payrollEntry.findFirstOrThrow({ where: { productId: product.id } })).amount.toFixed(2), "150.00");
  assert.deepEqual(await tx.productPercentageCompletion.findUnique({ where: { id: frozen.id } }), frozen);
  assert.equal((await patch.patchProductPercentageCore(c.actor, input, tx)).ok, true); assert.equal(await tx.payrollEntry.count({ where: { productId: product.id } }), 1);
}));
