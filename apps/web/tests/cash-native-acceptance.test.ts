import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { cashPlanSha256, cashQaSchemaTables, cashRawFingerprints } from "./cash-owned-fixtures.mjs";
import { parseCashNativeArgs, runCashNativeAcceptance } from "./cash-native-acceptance";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function plan() {
  const runId = randomUUID(), tables = cashQaSchemaTables(), passwordHash = "$argon2id$unit-test-only";
  const users = [true, false].map((active, index) => ({ id: randomUUID(), name: `QA-CASH ${runId} ${index}`,
    email: `${runId}-${index}@qa.invalid`, roles: ["WORKER"], active, payScheme: "NONE", passwordHash,
    passwordDigest: sha(passwordHash) }));
  const accounts = ["BYN", "USD"].map((currency) => ({ id: randomUUID(), name: `QA-CASH ${runId} ${currency}`, currency, active: true }));
  const project = { id: randomUUID(), number: `QA-CASH-${runId}`, numberInt: -1, title: `QA-CASH ${runId}`,
    clientId: "existing-client", managerId: "existing-manager", stage: "LEAD", currency: "BYN" };
  const payments = [0, 1].map((index) => ({ id: randomUUID(), projectId: project.id, cashAccountId: accounts[0].id,
    direction: "INCOME", amount: "1000.00", currency: "BYN", rate: "1.000000", bynAmount: "1000.00",
    projectAmount: "1000.00", rateDate: null, createdById: "existing-finance", comment: `QA-CASH ${runId} ${index}` }));
  const previous = new Date(); previous.setUTCMonth(previous.getUTCMonth() - 1);
  const accrual = { id: randomUUID(), userId: users[1].id, amount: "500.00", currency: "BYN", scheme: "PIECE",
    month: previous.toISOString().slice(0, 7), taskId: null, productId: null, settlementShareId: null,
    comment: `QA-CASH ${runId} prior` };
  const empty = { rows: Object.fromEntries(tables.map((table) => [table, []])) };
  return { format: "pero-cash-owned-qa/v1", runId,
    target: { kind: "EXISTING_LOCAL", containerId: "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5",
      host: "127.0.0.1", port: 5433, database: "pero_crm" },
    schema: { tables, hash: "a".repeat(64), optionalCompositionTables: [] },
    migration: "20260929120000_manager_cash_advances", sqlSha256: "bfa8d8a59b67ec027e67602a824a71eb98e473b57aad35e181eeaa1f852870dd",
    baseline: cashRawFingerprints(empty, tables), mode: "BYN_FALLBACK", project, users, accounts, payments, accrual,
    actors: { managerId: "existing-manager", financeId: "existing-finance", financeRecipientIds: ["existing-finance"] },
    requestIds: { advance: randomUUID(), salary: randomUUID(), usd: randomUUID(), delete: randomUUID() } };
}

test("CLI and callable entrypoint remain dry-run with no Prisma/transport on import or default invocation", async () => {
  assert.deepEqual(parseCashNativeArgs([]), { mode: "dry-run" });
  assert.deepEqual(parseCashNativeArgs(["dry-run"]), { mode: "dry-run" });
  assert.throws(() => parseCashNativeArgs(["--execute", "production"]), /CASH_NATIVE_USAGE_INVALID/);
  assert.throws(() => parseCashNativeArgs(["--execute", "prepare", "retry"]), /CASH_NATIVE_USAGE_INVALID/);
  const forbidden = new Proxy({}, { get: () => { throw new Error("DB_OR_TRANSPORT_TOUCHED"); } });
  assert.equal((await runCashNativeAcceptance({ prisma: forbidden })).connectionOpened, false);
  const p = plan();
  assert.equal((await runCashNativeAcceptance({ plan: p, prisma: forbidden })).planHash, cashPlanSha256(p));
});

test("opt-in requires durable reviewed plan and injected runtime before constructing SQL adapter", async () => {
  const p = plan();
  const forbidden = new Proxy({}, { get: () => { throw new Error("DB_TOUCHED"); } });
  await assert.rejects(runCashNativeAcceptance({ args: ["--execute", "prepare"], plan: p, prisma: forbidden }), /DURABLE_APPROVED_PLAN_REQUIRED/);
  const hash = cashPlanSha256(p);
  const approval = { source: "owner-reviewed" as const, planSha256: hash, sqlSha256: p.sqlSha256, targetKind: p.target.kind };
  await assert.rejects(runCashNativeAcceptance({ args: ["--execute", "prepare"], plan: p, durablePlanSha256: hash,
    approval }), /INJECTED_RUNTIME_REQUIRED/);
});

test("approved plan reaches the adapter write-authorization seam before any live probe", async () => {
  const p = plan(), hash = cashPlanSha256(p);
  const approval = { source: "owner-reviewed" as const, planSha256: hash, sqlSha256: p.sqlSha256, targetKind: p.target.kind };
  const attestation = { source: "verified-runner", target: p.target, proofSha256: "b".repeat(64), schemaHash: p.schema.hash,
    sqlSha256: p.sqlSha256, dbUser: "pero", database: p.target.database, serverAddress: "172.18.0.2", serverPort: 5432,
    schemaTables: p.schema.tables, optionalCompositionTables: [], verifiedAt: new Date().toISOString(),
    backup: { verified: true, archiveSha256: "c".repeat(64), tocSha256: "d".repeat(64), fullReadSha256: "e".repeat(64),
      targetKind: p.target.kind, database: p.target.database } };
  const client = { $transaction: async () => { throw new Error("DB_TOUCHED"); } };
  await assert.rejects(runCashNativeAcceptance({ args: ["--execute", "lock-proof"], plan: p, durablePlanSha256: hash,
    approval, attestation, prisma: client }), /DB_TOUCHED/);
});
