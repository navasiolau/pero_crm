import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { cashPlanSha256, cashQaSchemaTables, cashRawFingerprints } from "./cash-owned-fixtures.mjs";
import { assertCashRuntimeAttestation, cashSchemaDigest, createCashQaSqlAdapter } from "./cash-qa-adapter.mjs";

const target = { kind: "EXISTING_LOCAL", containerId: "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5",
  host: "127.0.0.1", port: 5433, database: "pero_crm" };
const tables = cashQaSchemaTables();
const ddl = { tables, relations: [], columns: [], constraints: [], indexes: [], triggers: [], triggerFunctions: [], policies: [], enums: [] };
const sqlSha256 = "bfa8d8a59b67ec027e67602a824a71eb98e473b57aad35e181eeaa1f852870dd";
function attestation() {
  return { source: "verified-runner", target, proofSha256: "a".repeat(64), schemaHash: cashSchemaDigest(ddl), sqlSha256,
    dbUser: "pero", database: "pero_crm", serverAddress: "172.18.0.2", serverPort: 5432,
    schemaTables: tables, optionalCompositionTables: [], verifiedAt: new Date().toISOString(),
    backup: { verified: true, archiveSha256: "b".repeat(64), tocSha256: "c".repeat(64), fullReadSha256: "d".repeat(64),
      targetKind: target.kind, database: target.database } };
}

function fakeDb(options: { unknownTable?: boolean; badDdl?: boolean; deleteRows?: Array<{ id: string }>;
  rows?: Record<string, string[]>; insertZeroOn?: string; waitingLock?: boolean } = {}) {
  const calls: string[] = [];
  const tx = {
    $queryRawUnsafe: async (sql: string) => {
      calls.push(sql);
      if (sql.includes("current_database()")) return [{ database: "pero_crm", username: "pero", address: "172.18.0.2", port: 5432, schema: "public" }];
      if (sql.includes("pg_catalog.pg_tables")) return [...tables.map((name) => ({ name })), ...(options.unknownTable ? [{ name: "Unknown" }] : [])];
      if (sql.includes('FROM public."_prisma_migrations"')) return [{ migration_name: "20260929120000_manager_cash_advances", checksum: sqlSha256,
        finished_at: new Date(), rolled_back_at: null }];
      if (sql.includes("information_schema.columns")) return options.badDdl ? [{ table_name: "User", column_name: "changed" }] : [];
      if (sql.includes("pg_advisory_xact_lock")) return [{ locked: 1 }];
      if (sql.includes("pg_backend_pid()")) return [{ pid: 4242 }];
      if (sql.includes("pg_catalog.pg_locks")) return options.waitingLock
        ? [{ pid: 4242, granted: false, wait_event_type: "Lock" }] : [];
      if (sql.startsWith("DELETE FROM")) return options.deleteRows ?? [];
      if (sql.includes("to_jsonb(t)::text")) {
        const table = /public\."([^"]+)"/.exec(sql)?.[1] ?? "";
        return (options.rows?.[table] ?? []).map((raw) => ({ raw }));
      }
      return [];
    },
    $executeRawUnsafe: async (sql: string) => { calls.push(sql); return options.insertZeroOn && sql.includes(options.insertZeroOn) ? 0 : 1; },
  };
  const client = { $transaction: async (operation: (dbTx: unknown) => Promise<unknown>, settings: object) => {
    calls.push(`TX:${JSON.stringify(settings)}`);
    return operation(tx);
  } };
  return { client, calls, tx };
}

function insertionPlan() {
  const runId = randomUUID(), marker = `QA-CASH ${runId}`, hash = "$argon2id$unit-test-only";
  const users = [true, false].map((active, i) => ({ id: randomUUID(), name: `${marker} ${i}`,
    email: `${runId}-${i}@qa.invalid`, roles: ["WORKER"], active, payScheme: "NONE", passwordHash: hash,
    passwordDigest: createHash("sha256").update(hash).digest("hex") }));
  const accounts = ["BYN", "USD"].map((currency) => ({ id: randomUUID(), name: `${marker} ${currency}`, currency, active: true }));
  const project = { id: randomUUID(), number: `QA-CASH-${runId}`, numberInt: -123,
    title: marker, clientId: "existing-client", managerId: "existing-manager", stage: "LEAD", currency: "BYN" };
  const payments = [0, 1].map((i) => ({ id: randomUUID(), projectId: project.id, cashAccountId: accounts[0].id,
    direction: "INCOME", amount: "1000.00", currency: "BYN", rate: "1.000000", rateDate: null,
    bynAmount: "1000.00", projectAmount: "1000.00", comment: `${marker} payment ${i}`, createdById: "existing-finance" }));
  const previous = new Date(); previous.setUTCMonth(previous.getUTCMonth() - 1);
  const accrual = { id: randomUUID(), userId: users[1].id, amount: "500.00", currency: "BYN", scheme: "PIECE",
    month: previous.toISOString().slice(0, 7), taskId: null, productId: null, settlementShareId: null, comment: `${marker} prior` };
  const rows = { User: [JSON.stringify({ id: "existing-manager", active: true, roles: ["MANAGER"] }),
    JSON.stringify({ id: "existing-finance", active: true, roles: ["ACCOUNTANT"] })],
    Client: [JSON.stringify({ id: "existing-client", name: "Client" })] };
  const fullRows = Object.fromEntries(tables.map((table) => [table, rows[table as keyof typeof rows] ?? []]));
  const plan = { format: "pero-cash-owned-qa/v1", runId, target, schema: { tables, hash: cashSchemaDigest(ddl), optionalCompositionTables: [] },
    migration: "20260929120000_manager_cash_advances", sqlSha256, baseline: cashRawFingerprints({ rows: fullRows }, tables),
    mode: "BYN_FALLBACK", project, users, accounts, payments, accrual,
    actors: { managerId: "existing-manager", financeId: "existing-finance", financeRecipientIds: ["existing-finance"] },
    requestIds: { advance: randomUUID(), salary: randomUUID(), usd: randomUUID(), delete: randomUUID() } };
  return { plan, rows: fullRows };
}
const approvalFor = (plan: ReturnType<typeof insertionPlan>["plan"]) => ({ source: "owner-reviewed", planSha256: cashPlanSha256(plan),
  sqlSha256, targetKind: target.kind });

test("attestation is fresh, target-bound and requires checksum plus backup proof before DB access", () => {
  const valid = attestation();
  assert.equal(assertCashRuntimeAttestation(target, valid, sqlSha256), valid);
  assert.throws(() => assertCashRuntimeAttestation(target, { ...valid, serverPort: 5433 }, sqlSha256), /ATTESTATION_INVALID/);
  assert.throws(() => assertCashRuntimeAttestation(target, { ...valid, verifiedAt: "2020-01-01T00:00:00.000Z" }, sqlSha256), /ATTESTATION_STALE/);
  assert.throws(() => assertCashRuntimeAttestation(target, { ...valid, backup: { ...valid.backup, verified: false } }, sqlSha256), /BACKUP_PROOF_REQUIRED/);
  const never = new Proxy({}, { get: () => { throw new Error("DB_TOUCHED"); } });
  assert.throws(() => createCashQaSqlAdapter({ prisma: never, target, attestation: { ...valid, schemaHash: "wrong" } }), /ATTESTATION_INVALID/);
});

test("read-only snapshot rechecks current database, catalog, DDL and migration checksum", async () => {
  const fake = fakeDb();
  const adapter = createCashQaSqlAdapter({ prisma: fake.client, target, attestation: attestation() });
  const snapshot = await adapter.readOnly((tx: { snapshot(): Promise<unknown> }) => tx.snapshot());
  assert.equal((snapshot as { schemaTables: string[] }).schemaTables.length, tables.length);
  assert.ok(fake.calls.indexOf("SET TRANSACTION READ ONLY") < fake.calls.indexOf("SELECT current_database() AS database, current_user AS username, inet_server_addr()::text AS address, inet_server_port() AS port, current_schema() AS schema"));
  assert.ok(fake.calls.some((sql) => sql.includes("to_jsonb(t)::text")));
  await assert.rejects(createCashQaSqlAdapter({ prisma: fakeDb({ unknownTable: true }).client, target, attestation: attestation() }).readOnly(async () => true), /UNKNOWN_SCHEMA_TABLES/);
  await assert.rejects(createCashQaSqlAdapter({ prisma: fakeDb({ badDdl: true }).client, target, attestation: attestation() }).readOnly(async () => true), /DDL_DIGEST_CHANGED/);
});

test("write transaction performs identity probe, advisory lock, all-table lock, then guarded business read", async () => {
  const fake = fakeDb();
  const { plan } = insertionPlan();
  const adapter = createCashQaSqlAdapter({ prisma: fake.client, target, attestation: attestation(), plan, writeAuthorization: approvalFor(plan) });
  await adapter.transaction((tx: { snapshot(): Promise<unknown> }) => tx.snapshot());
  const writeStart = fake.calls.findIndex((call) => call.includes('"isolationLevel":"ReadCommitted"'));
  const after = fake.calls.slice(writeStart);
  const identity = after.findIndex((call) => call.includes("current_database()"));
  const advisory = after.findIndex((call) => call.includes("pg_advisory_xact_lock(18435,55001)"));
  const lockTables = after.findIndex((call) => call.startsWith("LOCK TABLE"));
  const businessRead = after.findIndex((call) => call.includes("to_jsonb(t)::text"));
  assert.ok(writeStart >= 0 && identity >= 0 && identity < advisory && advisory < lockTables && lockTables < businessRead);
  assert.ok(after[lockTables].includes('public."Payout"') && after[lockTables].includes('public."User"'));
});

test("cleanup adapter rejects unapproved IDs and verifies exact DELETE RETURNING row IDs", async () => {
  const capture = { owned: { Payout: ["payoutowned123"] } };
  const fake = fakeDb({ deleteRows: [] });
  const { plan } = insertionPlan();
  const adapter = createCashQaSqlAdapter({ prisma: fake.client, target, attestation: attestation(), plan,
    approvedCapture: capture, writeAuthorization: approvalFor(plan) });
  await assert.rejects(adapter.transaction((tx: { deleteExact(table: string, ids: string[]): Promise<number> }) =>
    tx.deleteExact("Payout", ["foreign-id"])), /DELETE_IDS_FORBIDDEN/);
  await assert.rejects(adapter.transaction((tx: { deleteExact(table: string, ids: string[]): Promise<number> }) =>
    tx.deleteExact("Payout", ["payoutowned123"])), /EXACT_DELETE_COUNT_MISMATCH/);
  assert.equal(fake.calls.filter((sql) => sql.startsWith("DELETE FROM")).length, 1);
});

test("fixture insertion verifies actors/client and exact eight row counts under lock", async () => {
  const { plan, rows } = insertionPlan();
  const fake = fakeDb({ rows });
  const adapter = createCashQaSqlAdapter({ prisma: fake.client, target, attestation: attestation(), plan, writeAuthorization: approvalFor(plan) });
  await adapter.transaction((tx: { insertExactFixture(plan: unknown): Promise<void> }) => tx.insertExactFixture(plan));
  assert.equal(fake.calls.filter((sql) => sql.startsWith("INSERT INTO")).length, 8);
  const bad = fakeDb({ rows, insertZeroOn: 'INSERT INTO public."Payment"' });
  await assert.rejects(createCashQaSqlAdapter({ prisma: bad.client, target, attestation: attestation(), plan,
    writeAuthorization: approvalFor(plan) }).transaction(
    (tx: { insertExactFixture(plan: unknown): Promise<void> }) => tx.insertExactFixture(plan)), /INSERT_ROWCOUNT_MISMATCH/);
  const collisionRows = { ...rows, User: [...rows.User, JSON.stringify({ id: plan.users[0].id, active: true, roles: ["WORKER"] })] };
  const collision = fakeDb({ rows: collisionRows });
  await assert.rejects(createCashQaSqlAdapter({ prisma: collision.client, target, attestation: attestation(), plan,
    writeAuthorization: approvalFor(plan) }).transaction(
    (tx: { insertExactFixture(plan: unknown): Promise<void> }) => tx.insertExactFixture(plan)), /OWNED_ID_COLLISION/);
  assert.equal(collision.calls.some((sql) => sql.startsWith("INSERT INTO")), false);
});

test("two-connection lock proof rejects a fake database that lets both advisory acquisitions pass", async () => {
  const fake = fakeDb();
  const { plan } = insertionPlan();
  const adapter = createCashQaSqlAdapter({ prisma: fake.client, target, attestation: attestation(), plan, writeAuthorization: approvalFor(plan) });
  await assert.rejects(adapter.probeLockPair({ maxWaitMs: 100, pollIntervalMs: 5 }), /LOCK_NOT_EXCLUSIVE|LOCK_WAIT_NOT_OBSERVED/);
  assert.equal(fake.calls.some((sql) => sql.startsWith("INSERT INTO") || sql.startsWith("DELETE FROM")), false);
});

test("lock proof refuses mere delay when no ungranted pg_locks row exists for the waiter PID", async () => {
  const fake = fakeDb();
  const { plan } = insertionPlan();
  let gate = Promise.resolve();
  const serialized = { $transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
    const holder: { release?: () => void } = {};
    const tx = { ...fake.tx, $queryRawUnsafe: async (sql: string) => {
      if (!sql.includes("pg_advisory_xact_lock")) return fake.tx.$queryRawUnsafe(sql);
      const before = gate;
      gate = new Promise<void>((resolve) => { holder.release = resolve; });
      await before;
      return [{ locked: 1 }];
    } };
    try { return await operation(tx); } finally { holder.release?.(); }
  } };
  const adapter = createCashQaSqlAdapter({ prisma: serialized, target, attestation: attestation(), plan, writeAuthorization: approvalFor(plan) });
  await assert.rejects(adapter.probeLockPair({ maxWaitMs: 100, pollIntervalMs: 5 }), /LOCK_WAIT_NOT_OBSERVED/);
});

test("two-connection lock proof waits for the first holder without business writes", async () => {
  const fake = fakeDb({ waitingLock: true });
  const { plan } = insertionPlan();
  let gate = Promise.resolve();
  const serialized = { $transaction: async (operation: (tx: unknown) => Promise<unknown>, settings: object) => {
    fake.calls.push(`TX:${JSON.stringify(settings)}`);
    const holder: { release?: () => void } = {};
    const tx = { ...fake.tx, $queryRawUnsafe: async (sql: string) => {
      if (!sql.includes("pg_advisory_xact_lock")) return fake.tx.$queryRawUnsafe(sql);
      fake.calls.push(sql);
      const predecessor = gate;
      gate = new Promise<void>((resolve) => { holder.release = resolve; });
      await predecessor;
      return [{ locked: 1 }];
    } };
    try { return await operation(tx); } finally { holder.release?.(); }
  } };
  const adapter = createCashQaSqlAdapter({ prisma: serialized, target, attestation: attestation(), plan, writeAuthorization: approvalFor(plan) });
  assert.deepEqual(await adapter.probeLockPair(), { advisoryLock: "18435,55001", waiterPid: 4242, waited: true, writes: 0 });
  assert.equal(fake.calls.some((sql) => sql.startsWith("INSERT INTO") || sql.startsWith("DELETE FROM")), false);
});

test("write adapter refuses an unapproved plan before opening a connection", async () => {
  const { plan } = insertionPlan(), fake = fakeDb();
  const adapter = createCashQaSqlAdapter({ prisma: fake.client, target, attestation: attestation(), plan });
  await assert.rejects(adapter.transaction(async () => true), /WRITE_APPROVAL_REQUIRED/);
  assert.equal(fake.calls.length, 0);
});
