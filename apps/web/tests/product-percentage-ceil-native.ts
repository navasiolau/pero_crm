import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient, type Prisma, type ProductPercentageKind } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";
import { changeProductStatusTransaction } from "../src/server/products/status-core";
import { getProductPercentageView } from "../src/server/product-percentage-pay/queries";
import { singleProductPercentagePreview } from "../src/lib/single-product-percentage-ui";

const db = new PrismaClient({ datasourceUrl: existingLocalCrmDatabaseUrl() });
const abort = new Error("QA77_FORCED_ROLLBACK");
const checks: string[] = [];
const fetchBefore = globalThis.fetch;
let outbound = 0;
globalThis.fetch = async () => { outbound++; throw new Error("QA77_EXTERNAL_REQUEST_FORBIDDEN"); };

async function fingerprint() {
  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const rows: Record<string, unknown> = {};
  for (const { tablename } of tables) {
    assert.match(tablename, /^[A-Za-z_][A-Za-z0-9_]*$/);
    rows[tablename] = await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text),'')) AS hash FROM "${tablename}" t`);
  }
  const schema = await db.$queryRawUnsafe("SELECT md5(COALESCE(string_agg(pg_get_constraintdef(c.oid),'' ORDER BY t.relname,c.conname),'')) AS hash FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'");
  return { rows, schema };
}

async function rejected(tx: Prisma.TransactionClient, operation: () => Promise<unknown>) {
  await tx.$executeRawUnsafe("SAVEPOINT qa77_invalid");
  try { await assert.rejects(operation); }
  finally {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT qa77_invalid");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT qa77_invalid");
  }
}

async function main() {
try {
  const before = await fingerprint();
  await assert.rejects(db.$transaction(async tx => {
    // Только новая проверка задачи77 внутри той же откатываемой транзакции.
    // Остальные незапущенные local migrations не применяются.
    const sql = readFileSync(require.resolve("../prisma/migrations/20261005120000_product_percentage_ceil_accrual/migration.sql"), "utf8");
    const statements = sql.slice(sql.indexOf("BEGIN;") + 6, sql.lastIndexOf("COMMIT;")).split(";").map(value => value.trim()).filter(Boolean);
    assert.equal(statements.length, 2);
    assert.ok(statements.every(value => value.startsWith('ALTER TABLE "ProductPercentageCompletion"')));
    for (const statement of statements) await tx.$executeRawUnsafe(statement);

    const tag = randomUUID();
    const users = await Promise.all((["MANAGER", "ENGINEER", "WORKER", "MOUNTER"] as const).map(role =>
      tx.user.create({ data: { name: `Проверка77 ${role}`, email: `qa77-${tag}-${role}@example.invalid`, passwordHash: "QA77_NOT_A_LOGIN", roles: [role] } })));
    const [manager, engineer, assembler, mounter] = users;
    const actor = { id: manager.id, name: manager.name, roles: manager.roles, source: "web" as const };
    const client = await tx.client.create({ data: { name: "Проверка77", phone: "QA77" } });
    const numberInt = (await tx.project.aggregate({ _max: { numberInt: true } }))._max.numberInt! + 1;
    const project = await tx.project.create({ data: { title: "Проверка77 с откатом", number: String(numberInt), numberInt, clientId: client.id, managerId: manager.id, currency: "BYN" } });
    let suffix = 0;
    const createProduct = (price: string | null, quantity = 1) => {
      suffix++;
      return tx.product.create({ data: { projectId: project.id, number: `${numberInt}.${suffix}`, suffixInt: suffix, title: "Проверка77", expectedPrice: price, quantity, engineerId: engineer.id, assemblerId: assembler.id, mounterId: mounter.id } });
    };
    const kinds: ProductPercentageKind[] = ["ENGINEERING", "ASSEMBLY", "INSTALLATION"];
    for (const scenario of [
      { price: "19986.00", quantity: 1, rates: ["5", "5", "5"], amounts: ["1000.00", "1000.00", "1000.00"] },
      { price: "0.01", quantity: 1, rates: ["1", "1", "1"], amounts: ["1.00", "1.00", "1.00"] },
      { price: "1000", quantity: 3, rates: ["5", "4", "7"], amounts: ["50.00", "120.00", "210.00"] },
      { price: null, quantity: 3, rates: ["0", "0", "0"], amounts: ["0.00", "0.00", "0.00"] },
    ]) {
      const product = await createProduct(scenario.price, scenario.quantity);
      for (const [index, kind] of kinds.entries()) await tx.productPercentageConfig.create({ data: { productId: product.id, kind, ratePercent: scenario.rates[index] } });
      const draft = await getProductPercentageView(actor, product.id, tx);
      for (const [index, kind] of kinds.entries()) {
        const section = draft.sections[kind];
        assert.equal(section.calculationVersion, 4);
        assert.equal(section.total, scenario.amounts[index]);
        assert.equal(singleProductPercentagePreview({ state: section.state, kind, version: 4, unitPrice: section.unitPrice ?? null, quantity: section.quantity ?? null, rate: section.ratePercent, frozenTotal: section.total, recipientEligible: true }), scenario.amounts[index]);
      }
      assert.ok((await changeProductStatusTransaction(tx, actor, product.id, "DONE")).ok);
      const completions = await tx.productPercentageCompletion.findMany({ where: { productId: product.id }, include: { shares: { include: { payrollEntry: true } } } });
      for (const [index, kind] of kinds.entries()) {
        const completion = completions.find(row => row.kind === kind)!;
        assert.equal(completion.calculationVersion, 4);
        assert.equal(completion.amount!.toFixed(2), scenario.amounts[index]);
        assert.equal(completion.bynAmount!.toFixed(2), scenario.amounts[index]);
        assert.equal(completion.projectAmount!.toFixed(2), scenario.amounts[index]);
        if (scenario.amounts[index] !== "0.00") assert.equal(completion.shares[0].payrollEntry!.amount.toFixed(2), scenario.amounts[index]);
      }
      const paidBefore = await tx.payrollEntry.findMany({ where: { productId: product.id }, orderBy: { id: "asc" } });
      assert.ok((await changeProductStatusTransaction(tx, actor, product.id, "DESIGN")).ok);
      assert.ok((await changeProductStatusTransaction(tx, actor, product.id, "DONE")).ok);
      assert.deepEqual(await tx.payrollEntry.findMany({ where: { productId: product.id }, orderBy: { id: "asc" } }), paidBefore);
    }
    checks.push("actual_core_query_preview_and_payroll_match_for_three_roles_fraction_tiny_batch_zero_replay");

    const probe = await createProduct("999.30");
    const now = new Date();
    const valid = { productId: probe.id, kind: "ENGINEERING" as const, state: "SETTLED" as const, statusAtCompletion: "PRODUCTION" as const, calculationVersion: 4,
      quantitySnapshot: 1, priceSnapshot: "999.30", totalSnapshot: "999.30", ratePercentSnapshot: "100", recipientId: engineer.id,
      productCurrency: "BYN", payrollCurrency: "BYN", productRateByn: 1, payrollRateByn: 1, productRateDate: now, payrollRateDate: now,
      sourceFundExact: "999.30", amount: "1000.00", bynAmount: "1000.00", projectAmount: "1000.00", settledAt: now };
    for (const bad of [
      { amount: "999.30", bynAmount: "999.30", projectAmount: "999.30" }, { amount: "1001.00", bynAmount: "1001.00", projectAmount: "1001.00" },
      { quantitySnapshot: 0 }, { totalSnapshot: "1998.60" }, { recipientId: null },
    ]) await rejected(tx, () => tx.productPercentageCompletion.create({ data: { ...valid, ...bad } }));
    const snapshot = await tx.productPercentageCompletion.create({ data: valid });
    await rejected(tx, () => tx.productPercentageCompletion.update({ where: { id: snapshot.id }, data: { priceSnapshot: "1000" } }));
    checks.push("actual_v4_ceil_and_unchanged_immutable_trigger_reject_invalid_rows");

    for (const version of [1, 2, 3]) {
      const prior = await createProduct("999.30");
      await tx.product.update({ where: { id: prior.id }, data: { status: "PRODUCTION" } });
      const old = await tx.productPercentageCompletion.create({ data: version === 1
        ? { productId: prior.id, kind: "ENGINEERING", state: "LEGACY_PROTECTED", statusAtCompletion: "PRODUCTION", calculationVersion: 1, priceSnapshot: "999.30", productCurrency: "BYN" }
        : { ...valid, productId: prior.id, calculationVersion: version, amount: "999.30", bynAmount: "999.30", projectAmount: "999.30" } });
      await tx.product.update({ where: { id: prior.id }, data: { expectedPrice: "1", quantity: 3 } });
      assert.ok((await changeProductStatusTransaction(tx, actor, prior.id, "DESIGN")).ok);
      assert.ok((await changeProductStatusTransaction(tx, actor, prior.id, "PRODUCTION")).ok);
      assert.deepEqual(await tx.productPercentageCompletion.findUnique({ where: { id: old.id } }), old);
    }
    checks.push("historical_v1_v2_v3_constraints_and_snapshots_preserved");

    const overflow = await createProduct("8333333332.51",8);
    await tx.product.update({where:{id:overflow.id},data:{status:"PRODUCTION"}});
    await tx.productPercentageConfig.create({ data: { productId: overflow.id, kind: "ASSEMBLY", ratePercent: "15" } });
    await assert.rejects(changeProductStatusTransaction(tx, actor, overflow.id, "STORAGE"), /превышает допустимую/);
    assert.equal(await tx.productPercentageCompletion.count({ where: { productId: overflow.id } }), 0);
    checks.push("rounded_overflow_rejected_before_database_writes");
    throw abort;
  }, { timeout: 120000, maxWait: 10000 }), error => error === abort);
  assert.deepEqual(await fingerprint(), before);
  assert.equal(outbound, 0);
  console.log(JSON.stringify({ status: "PASS", target: "existing_local_pero_crm_5433", checks, migrationAppliedInsideRollback: true, schemaRestored: true, allOriginalRowsMatch: true, persistedRows: 0, outbound }));
} finally {
  globalThis.fetch = fetchBefore;
  await db.$disconnect();
}

}
main().catch(error => { console.error(error); process.exitCode=1; });
