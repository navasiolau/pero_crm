/** Read-only legacy coverage and rolled-back native lock acceptance. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";
import { productLineTotal } from "../src/lib/product-quantity";
import { lockProductRow, recalculateQuantity } from "../src/server/products/quantity-core";
import { lockMaterialProduct } from "../src/server/warehouse/norm-core";

async function main() {
process.env.CRM_LOCAL_CONTAINER_ID = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const db = new PrismaClient({ datasourceUrl: existingLocalCrmDatabaseUrl() });
const directory = resolve(import.meta.dirname, "../../../.playwright-mcp/product-quantity");
const state = JSON.parse(readFileSync(resolve(directory, "qa-local.json"), "utf8"));
const rollback = new Error("OWNED_RACE_ROLLBACK");
try {
  const all = await db.product.findMany({ select: { id: true, quantity: true, expectedPrice: true, initialPrice: true } });
  for (const product of all) {
    productLineTotal(product.expectedPrice, product.quantity);
    productLineTotal(product.initialPrice, product.quantity);
  }
  const [negative] = await db.$queryRaw<{ stock: string }[]>`SELECT count(*)::text AS stock FROM "StockMovement" WHERE quantity < 0`;
  assert.equal(negative.stock, "0", "UNSUPPORTED_NEGATIVE_MOVEMENT");
  const qaActor = await db.user.findFirstOrThrow({ where: { active: true, roles: { hasSome: ["ADMIN", "DIRECTOR"] } }, select: { id: true, roles: true } });
  const batch = await db.product.findFirstOrThrow({ where: { projectId: state.ids.project, id: { not: state.ids.control } } });
  const line = await db.projectMaterial.findFirstOrThrow({ where: { productId: batch.id } });
  const baseline = JSON.stringify(await db.product.findUnique({ where: { id: batch.id },
    include: { works: { include: { tasks: true } }, projectMaterials: true } }));
  let held!: () => void; const holderReady = new Promise<void>((done) => { held = done; });
  let release!: () => void; const releaseHolder = new Promise<void>((done) => { release = done; });
  let competitorFinished = false;
  const holder = db.$transaction(async (tx) => {
    await lockMaterialProduct(tx, line.id, qaActor);
    await tx.projectMaterial.update({ where: { id: line.id }, data: { issuedQty: "18" } });
    const before = await tx.work.findMany({ where: { productId: batch.id } });
    await assert.rejects(() => recalculateQuantity(tx, batch, 4), /Петли/);
    assert.equal(JSON.stringify(await tx.work.findMany({ where: { productId: batch.id } })), JSON.stringify(before), "NO_PARTIAL_WORK_UPDATES");
    held(); await releaseHolder; throw rollback;
  }, { timeout: 15000 }).catch((error) => { if (error !== rollback) throw error; });
  await holderReady;
  const competitor = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
    await lockProductRow(tx, batch.id);
    const current = await tx.product.findUniqueOrThrow({ where: { id: batch.id } });
    await recalculateQuantity(tx, current, 4);
    competitorFinished = true; throw rollback;
  }, { timeout: 15000 }).catch((error) => { if (error !== rollback) throw error; });
  await new Promise((done) => setTimeout(done, 250));
  assert.equal(competitorFinished, false, "COMPETITOR_MUST_WAIT_FOR_PRODUCT_LOCK");
  release(); await Promise.all([holder, competitor]);
  assert.equal(competitorFinished, true);
  assert.equal(JSON.stringify(await db.product.findUnique({ where: { id: batch.id },
    include: { works: { include: { tasks: true } }, projectMaterials: true } })), baseline, "RACE_ROLLBACK_PRESERVATION");
  const receipt = { status: "LOCAL_DB_READONLY_AND_LOCK_RACE_PASS", productsValidated: all.length,
    lockWaitProved: true, issueReductionRejected: true, partialWrites: false, bothTransactionsRolledBack: true };
  writeFileSync(resolve(directory, "db-local-receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally { await db.$disconnect(); }

}
main().catch((error) => { console.error("LOCAL_QUANTITY_DB_STOP", error.message); process.exitCode = 1; });
