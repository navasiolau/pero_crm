// Native PostgreSQL probes: an instrumented domain bundle, never whole-app acceptance.
// Every write is inside one transaction that unconditionally aborts.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { existsSync } from "node:fs";
let phase = "target_guard";
import { PrismaClient } from "@prisma/client";
import { createProjectCore } from "../src/server/projects/core.ts";
import { createPaymentCore } from "../src/server/payments/core.ts";
import { getProjectEconomics } from "../src/server/finance/queries.ts";
import { getMyPayroll, currentMonth } from "../src/server/payroll/queries.ts";

function targetGuard() {
 const target = process.env.CRM_BYN_NATIVE_TARGET;
 const raw = process.env.DATABASE_URL;
 assert.ok(raw, "DATABASE_URL_REQUIRED");
 const url = new URL(raw);
 assert.equal(url.protocol, "postgresql:");
 if (target === "local") {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "LOCAL_HOST_MISMATCH_STOP");
  assert.equal(url.port, "5433"); assert.equal(url.pathname, "/pero_crm");
 } else if (target === "staging") {
  // W07 must first verify the outer crm-staging host, exact image/revision,
  // mounts and networks. This probe verifies its own Docker execution context.
  assert.ok(existsSync("/.dockerenv") && /^[a-f0-9]{12,64}$/.test(hostname()), "STAGING_DOCKER_CONTEXT_MISMATCH_STOP");
  assert.equal(url.hostname, "db"); assert.equal(url.port || "5432", "5432"); assert.equal(url.pathname, "/crm");
  assert.equal(process.env.S3_BUCKET, "pero-crm-staging", "STAGING_BUCKET_MISMATCH_STOP");
 } else throw new Error("EXPLICIT_LOCAL_OR_STAGING_TARGET_REQUIRED");
 assert.ok(!url.searchParams.has("schema") || url.searchParams.get("schema") === "public", "SCHEMA_MISMATCH_STOP");
 return target;
}
const tables = ["Project", "ProjectStageHistory", "Payment", "PayrollEntry", "Payout", "CashAccount", "ChangeLog", "DomainEvent", "Notification"];
async function fingerprint(db) {
 const result = {};
 for (const table of tables) {
  const rows = await db.$queryRawUnsafe(`SELECT count(*)::text AS count, md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text), '')) AS hash FROM "${table}" t`);
  result[table] = rows[0];
 }
 return result;
}
async function main() {
 const target = targetGuard(); // Before client construction/connection.
 const db = new PrismaClient();
 const checks = [];
 const marker = `QA-BYN-${randomUUID()}`;
 const rollback = new Error("EXPECTED_BYN_NATIVE_ROLLBACK");
 try {
  phase = "initial_fingerprint";
  const before = await fingerprint(db);
  await assert.rejects(db.$transaction(async tx => {
   globalThis.__crmBynTx = tx;
   await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
   await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
   const user = await tx.user.findFirst({where:{active:true,roles:{has:"ADMIN"}},select:{id:true,name:true,roles:true}});
   const client = await tx.client.findFirst({select:{id:true}});
   assert.ok(user && client, "EXISTING_ADMIN_AND_CLIENT_REQUIRED");
   const actor = {...user,source:"api"};
   phase = "foreign_project_rejection";
   const start = await fingerprint(tx);
   const foreign = await createProjectCore(actor,{title:marker,clientId:client.id,currency:"USD"});
   assert.equal(foreign.ok,false); assert.match(foreign.error,/BYN/);
   assert.deepEqual(await fingerprint(tx),start); checks.push("foreign_project_rejected_before_any_write");
   phase = "create_BYN_project";
   const created = await createProjectCore(actor,{title:marker,clientId:client.id});
   assert.equal(created.ok,true); assert.equal((await tx.project.findUniqueOrThrow({where:{id:created.id}})).currency,"BYN");
   checks.push("omitted_currency_persists_BYN_with_real_audit");
   const cash = await tx.cashAccount.create({data:{id:marker,name:marker,currency:"USD"}});
   phase = "physical_USD_payment";
   const payment = await createPaymentCore(actor,{projectId:created.id,direction:"INCOME",amount:100,currency:"USD",cashAccountId:cash.id,rate:3,rateDate:"2026-10-01"});
   assert.equal(payment.ok,true,payment.error);
   const saved = await tx.payment.findFirstOrThrow({where:{projectId:created.id}});
   assert.equal(saved.amount.toString(),"100"); assert.equal(saved.currency,"USD"); assert.equal(saved.bynAmount.toString(),"300");
   await tx.payment.update({where:{id:saved.id},data:{projectAmount:100}});
   let economics = await getProjectEconomics(created.id);
   assert.equal(economics.paidTotal,300); assert.equal(economics.margin,300); checks.push("USD100_rate3_savedBYN300_not_legacyProjectAmount100");
   phase = "legacy_foreign_project_rejection";
   await tx.project.update({where:{id:created.id},data:{currency:"USD"}});
   const deniedBefore = await fingerprint(tx);
   const denied = await createPaymentCore(actor,{projectId:created.id,direction:"INCOME",amount:1,currency:"USD",cashAccountId:cash.id});
   assert.equal(denied.ok,false); assert.match(denied.error,/BYN/); assert.deepEqual(await fingerprint(tx),deniedBefore);
   checks.push("legacy_foreign_project_rejects_before_FX_or_write");
   await tx.project.update({where:{id:created.id},data:{currency:"BYN"}});
   const month=currentMonth();
   phase = "historical_payroll_read";
   await tx.payrollEntry.create({data:{id:`${marker}-zero`,userId:user.id,projectId:created.id,amount:0,currency:"BYN",scheme:"PIECE",month}});
   economics=await getProjectEconomics(created.id); assert.equal(economics.payrollTotal,0);
   await tx.payrollEntry.create({data:{id:marker,userId:user.id,projectId:created.id,amount:10,currency:"USD",scheme:"PIECE",month}});
   economics=await getProjectEconomics(created.id); assert.equal(economics.payrollTotal,null); assert.equal(economics.margin,null); assert.equal(economics.paidTotal,300);
   checks.push("foreign_payroll_unknown_only_dependent_economics_zero_distinguished");
   phase = "historical_payout_read";
   await tx.payout.create({data:{id:marker,userId:user.id,amount:10,month,createdById:user.id}});
   const payroll=await getMyPayroll(user.id,month);
   assert.equal(payroll.paid,null); assert.equal(payroll.debt,null);
   const history=payroll.payouts.find(row=>row.id===marker); assert.equal(history.amount,10); assert.equal(history.payrollCurrency,null); assert.equal(history.bynAmount,null);
   assert.equal(payroll.entries.find(row=>row.id===marker).currency,"USD");
   checks.push("legacy_payout_unknown_preserves_original_history");
   phase = "physical_half_cent";
   const precision=await createPaymentCore(actor,{projectId:created.id,direction:"INCOME",amount:0.05,currency:"USD",cashAccountId:cash.id,rate:0.7,rateDate:"2026-10-01",comment:`${marker}-precision`});
   assert.equal(precision.ok,true,precision.error);
   const precisionRow=await tx.payment.findFirstOrThrow({where:{projectId:created.id,comment:`${marker}-precision`}});
   assert.equal(precisionRow.amount.toString(),"0.05");
   assert.equal(precisionRow.bynAmount.toString(),"0.04");
   checks.push("physical_half_cent_rounds_UP_to_fixed_BYN004");
   phase = "expected_rollback";
   throw rollback;
  }, { timeout:60000,maxWait:10000}), error=>error===rollback);
  globalThis.__crmBynTx=undefined;
  phase = "rollback_fingerprint";
  assert.deepEqual(await fingerprint(db),before,"ROLLBACK_OR_CONCURRENT_CHANGE_MISMATCH_STOP");
  console.log(JSON.stringify({kind:"crm-byn-native-acceptance",target,checks,rollbackVerified:true,tables:before,scope:"instrumented domain cores with real PostgreSQL; external delivery/cache stubbed; browser and compiled deployment not tested"}));
 } finally { globalThis.__crmBynTx=undefined; await db.$disconnect(); }
}
main().catch(()=>{console.error(JSON.stringify({kind:"crm-byn-native-failure",code:"NATIVE_PROBE_STOP",phase}));process.exitCode=1;});
