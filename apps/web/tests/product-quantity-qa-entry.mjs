/** Executes only an explicitly scoped operation against a guarded runtime. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { prepareQuantityOwned, captureQuantityOwned, cleanupQuantityOwned } from "./product-quantity-owned.mjs";

const packet = JSON.parse(process.env.CRM_PRODUCT_QUANTITY_QA ?? "{}");
assert.ok(["prepare", "capture", "cleanup"].includes(packet.operation), "EXPLICIT_QA_OPERATION_REQUIRED");
assert.match(packet.statePath ?? "", /^.+product-quantity.+\.json$/);
const target = packet.target;
assert.ok(["local", "staging"].includes(target), "QA_TARGET_REQUIRED");
let databaseUrl;
if (target === "local") {
  const [container] = JSON.parse(execFileSync("docker", ["inspect", "pero_crm_pg"], { encoding: "utf8", windowsHide: true }));
  assert.equal(container.Id, "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5");
  assert.equal(container.State.Running, true);
  assert.ok(container.NetworkSettings.Ports["5432/tcp"].some((item) => item.HostIp === "127.0.0.1" && item.HostPort === "5433"));
  const env = Object.fromEntries(container.Config.Env.map((value) => { const at = value.indexOf("="); return [value.slice(0, at), value.slice(at + 1)]; }));
  assert.equal(env.POSTGRES_DB, "pero_crm"); assert.equal(env.POSTGRES_USER, "pero");
  const url = new URL("postgresql://127.0.0.1:5433/pero_crm"); url.username = "pero"; url.password = env.POSTGRES_PASSWORD; databaseUrl = url.href;
  assert.equal(resolve(packet.statePath), resolve(import.meta.dirname, "../../../.playwright-mcp/product-quantity/qa-local.json"));
} else {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, "db"); assert.equal(url.pathname, "/crm");
  assert.equal(process.env.S3_BUCKET, "pero-crm-staging");
  assert.match(packet.statePath, /^\/tmp\/product-quantity-qa-[a-f0-9-]{36}\.json$/);
  databaseUrl = url.href;
}
const db = new PrismaClient({ datasourceUrl: databaseUrl });
try {
  const applied = await db.$queryRawUnsafe('SELECT checksum FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL', "20261001120000_product_quantity");
  assert.equal(applied.length, 1, "QUANTITY_MIGRATION_REQUIRED");
  if (packet.operation === "prepare") {
    assert.ok(!existsSync(packet.statePath), "QA_PREPARE_ALREADY_ATTEMPTED");
    const state = await prepareQuantityOwned(db, target);
    writeFileSync(packet.statePath, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ status: "QA_PREPARED", runId: state.runId, marker: state.marker, ids: state.ids,
      number: state.number, credentials: state.credentials, manifestSha256: state.manifestSha256 }));
  } else {
    assert.ok(lstatSync(packet.statePath).isFile() && !lstatSync(packet.statePath).isSymbolicLink(), "QA_STATE_FILE_REQUIRED");
    const state = JSON.parse(readFileSync(packet.statePath, "utf8"));
    assert.equal(state.target, target);
    if (packet.operation === "cleanup") console.log(JSON.stringify(await cleanupQuantityOwned(db, state)));
    else {
      const captured = await captureQuantityOwned(db, state);
      writeFileSync(packet.statePath, JSON.stringify(captured), { mode: 0o600 });
      const products = await db.product.findMany({ where: { projectId: state.ids.project }, orderBy: { suffixInt: "asc" },
        select: { id: true, title: true, number: true, quantity: true, expectedPrice: true } });
      const works = await db.work.findMany({ where: { projectId: state.ids.project }, include: { tasks: {
        select: { id: true, status: true, quantity: true, allocationGroupId: true, shareAmount: true, shareUnits: true, assigneeId: true } } } });
      const materials = await db.projectMaterial.findMany({ where: { product: { projectId: state.ids.project } },
        select: { id: true, quantity: true, quantityPerUnit: true, issuedQty: true } });
      const payroll = await db.payrollEntry.findMany({ where: { projectId: state.ids.project }, select: { id: true, amount: true, userId: true, taskId: true } });
      const completions = await db.productPercentageCompletion.findMany({ where: { product: { projectId: state.ids.project } },
        select: { id: true, kind: true, state: true, priceSnapshot: true, ratePercentSnapshot: true, sourceFundExact: true, amount: true, projectAmount: true } });
      console.log(JSON.stringify({ status: "QA_CAPTURED_PRESERVED", manifestSha256: captured.manifestSha256,
        products, works, materials, payroll, completions, counts: Object.fromEntries(Object.entries(captured.owned).filter(([, rows]) => rows.length).map(([table, rows]) => [table, rows.length])) }));
    }
  }
} finally { await db.$disconnect(); }
