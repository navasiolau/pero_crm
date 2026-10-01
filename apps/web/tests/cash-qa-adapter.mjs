/** Injected Prisma adapter for an existing, runner-attested cash QA target. No client or I/O on import. */
import { createHash } from "node:crypto";
import { assertCashQaTarget, canonical, cashPlanSha256, cashQaSchemaTables, cashRawFingerprints,
  validateCashQaPlan } from "./cash-owned-fixtures.mjs";

const HASH = /^[0-9a-f]{64}$/i;
const CLEANUP = new Set(["Notification", "ChangeLog", "DomainEvent", "Payout", "PayrollEntry", "Payment", "CashAccount", "Project", "User"]);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const same = (a, b) => canonical(a) === canonical(b);
const sorted = (items) => [...items].sort();

export class CashSqlStop extends Error { constructor(code) { super(code); this.name = "CashSqlStop"; this.code = code; } }
function check(value, code) { if (!value) throw new CashSqlStop(code); }

export function assertCashRuntimeAttestation(target, attestation, expectedSqlSha256, now = new Date()) {
  assertCashQaTarget(target);
  check(attestation?.source === "verified-runner" && same(attestation.target, target) &&
    HASH.test(attestation.proofSha256 ?? "") && HASH.test(attestation.schemaHash ?? "") &&
    HASH.test(attestation.sqlSha256 ?? "") && attestation.sqlSha256.toLowerCase() === expectedSqlSha256?.toLowerCase() &&
    typeof attestation.dbUser === "string" && attestation.dbUser.length > 0 &&
    typeof attestation.serverAddress === "string" && attestation.serverAddress.length > 0 &&
    attestation.serverPort === 5432 && attestation.database === target.database &&
    same(sorted(attestation.schemaTables ?? []), cashQaSchemaTables(attestation.optionalCompositionTables ?? [])),
  "ATTESTATION_INVALID");
  const age = now.getTime() - Date.parse(attestation.verifiedAt ?? "");
  check(Number.isFinite(age) && age >= 0 && age <= 120000, "ATTESTATION_STALE");
  check(attestation.backup?.verified === true && HASH.test(attestation.backup.archiveSha256 ?? "") &&
    HASH.test(attestation.backup.tocSha256 ?? "") && HASH.test(attestation.backup.fullReadSha256 ?? "") &&
    attestation.backup.targetKind === target.kind && attestation.backup.database === target.database,
  "BACKUP_PROOF_REQUIRED");
  return attestation;
}

/** Hash ordered catalog, columns, constraints, indexes, triggers/functions and enums, not a guessed schema version. */
export function cashSchemaDigest(ddl) {
  check(ddl && ["tables", "relations", "columns", "constraints", "indexes", "triggers", "triggerFunctions", "policies", "enums"]
    .every((key) => Array.isArray(ddl[key])),
    "DDL_RECORDS_INVALID");
  return sha(canonical(ddl) + "\n");
}

const IDENTITY_SQL = "SELECT current_database() AS database, current_user AS username, inet_server_addr()::text AS address, inet_server_port() AS port, current_schema() AS schema";
const TABLES_SQL = "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename";
const MIGRATIONS_SQL = 'SELECT migration_name, checksum, finished_at, rolled_back_at FROM public."_prisma_migrations" ORDER BY migration_name';
const DDL_SQL = Object.freeze({
  relations: "SELECT cls.relname AS name,cls.relkind AS kind,cls.relpersistence AS persistence,cls.relrowsecurity AS rls,cls.relforcerowsecurity AS force_rls,cls.reloptions AS options FROM pg_catalog.pg_class cls JOIN pg_catalog.pg_namespace ns ON ns.oid=cls.relnamespace WHERE ns.nspname='public' AND cls.relkind IN ('r','p') AND cls.relname <> '_prisma_migrations' ORDER BY cls.relname",
  columns: "SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name <> '_prisma_migrations' ORDER BY table_name,ordinal_position",
  constraints: "SELECT cls.relname AS table_name,c.conname AS name,c.contype AS type,c.convalidated AS validated,pg_get_constraintdef(c.oid,true) AS definition FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class cls ON cls.oid=c.conrelid JOIN pg_catalog.pg_namespace ns ON ns.oid=cls.relnamespace WHERE ns.nspname='public' AND cls.relname <> '_prisma_migrations' ORDER BY cls.relname,c.conname",
  indexes: "SELECT tablename AS table_name,indexname AS name,indexdef AS definition FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename,indexname",
  triggers: "SELECT cls.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class cls ON cls.oid=t.tgrelid JOIN pg_catalog.pg_namespace ns ON ns.oid=cls.relnamespace WHERE ns.nspname='public' AND NOT t.tgisinternal AND cls.relname <> '_prisma_migrations' ORDER BY cls.relname,t.tgname",
  triggerFunctions: "SELECT DISTINCT p.proname AS name,pg_get_functiondef(p.oid) AS definition FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_trigger t ON t.tgfoid=p.oid JOIN pg_catalog.pg_class cls ON cls.oid=t.tgrelid JOIN pg_catalog.pg_namespace ns ON ns.oid=cls.relnamespace WHERE ns.nspname='public' AND cls.relname <> '_prisma_migrations' AND NOT t.tgisinternal ORDER BY p.proname,pg_get_functiondef(p.oid)",
  policies: "SELECT tablename AS table_name,policyname AS name,permissive,roles,cmd,qual,with_check FROM pg_catalog.pg_policies WHERE schemaname='public' ORDER BY tablename,policyname",
  enums: "SELECT typ.typname AS type,e.enumlabel AS label,e.enumsortorder AS ordinal FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type typ ON typ.oid=e.enumtypid JOIN pg_catalog.pg_namespace ns ON ns.oid=typ.typnamespace WHERE ns.nspname='public' ORDER BY typ.typname,e.enumsortorder",
});

async function readCatalog(tx) {
  const foundTables = (await tx.$queryRawUnsafe(TABLES_SQL)).map((row) => row.name);
  const ddl = { tables: foundTables };
  for (const [key, sql] of Object.entries(DDL_SQL)) ddl[key] = await tx.$queryRawUnsafe(sql);
  const migrations = await tx.$queryRawUnsafe(MIGRATIONS_SQL);
  return { foundTables, schemaHash: cashSchemaDigest(ddl), migrations };
}

function assertMigration(migrations, sqlHash) {
  const required = migrations.filter((row) => row.migration_name === "20260929120000_manager_cash_advances");
  check(required.length === 1 && required[0].finished_at !== null && required[0].rolled_back_at === null &&
    required[0].checksum?.toLowerCase() === sqlHash.toLowerCase() &&
    migrations.every((row) => row.finished_at !== null || row.rolled_back_at !== null), "MIGRATION_LEDGER_MISMATCH");
}

/** Runner preflight before attestation creation; never chooses a DB or opens a connection itself. */
export async function probeCashQaDatabase(prisma, target, sqlHash) {
  assertCashQaTarget(target);
  check(prisma && typeof prisma.$transaction === "function" && HASH.test(sqlHash ?? ""), "PROBE_INPUT_INVALID");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const found = await tx.$queryRawUnsafe(IDENTITY_SQL);
    check(found.length === 1 && found[0].database === target.database && found[0].schema === "public" &&
      typeof found[0].username === "string" && found[0].username.length > 0 &&
      typeof found[0].address === "string" && found[0].address.length > 0 && Number(found[0].port) === 5432,
    "DATABASE_IDENTITY_MISMATCH");
    const catalog = await readCatalog(tx);
    const optional = catalog.foundTables.filter((name) => !cashQaSchemaTables().includes(name));
    check(same(sorted(catalog.foundTables), cashQaSchemaTables(optional)), "UNKNOWN_SCHEMA_TABLES");
    assertMigration(catalog.migrations, sqlHash);
    return { database: found[0].database, dbUser: found[0].username, serverAddress: found[0].address,
      serverPort: Number(found[0].port), schemaTables: sorted(catalog.foundTables),
      optionalCompositionTables: optional, schemaHash: catalog.schemaHash, sqlSha256: sqlHash.toLowerCase() };
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 120000 });
}

function planIds(plan) {
  return [plan.project.id, ...plan.users.map((u) => u.id), ...plan.accounts.map((a) => a.id),
    ...plan.payments.map((p) => p.id), plan.accrual.id];
}

/** @param {{prisma: any, target: any, attestation: any, plan?: any, approvedCapture?: any,
 * writeAuthorization?: any, now?: () => Date}} input */
export function createCashQaSqlAdapter({ prisma, target, attestation, plan = null, approvedCapture = null,
  writeAuthorization = null, now = () => new Date() }) {
  if (plan) { validateCashQaPlan(plan); check(same(plan.target, target), "PLAN_TARGET_MISMATCH"); }
  const sqlHash = plan?.sqlSha256 ?? attestation?.sqlSha256;
  assertCashRuntimeAttestation(target, attestation, sqlHash, now());
  check(prisma && typeof prisma.$transaction === "function", "PRISMA_CLIENT_REQUIRED");
  const tables = cashQaSchemaTables(attestation.optionalCompositionTables ?? []);
  check(!plan || (same(plan.schema.tables, tables) && plan.schema.hash === attestation.schemaHash), "PLAN_SCHEMA_MISMATCH");
  const allowedDeletes = approvedCapture?.owned ?? {};

  function requireWriteAuthorization() {
    check(plan && writeAuthorization?.source === "owner-reviewed" &&
      writeAuthorization.planSha256 === cashPlanSha256(plan) &&
      writeAuthorization.sqlSha256?.toLowerCase() === sqlHash.toLowerCase() &&
      writeAuthorization.targetKind === target.kind, "WRITE_APPROVAL_REQUIRED");
  }

  async function identity(tx) {
    const found = await tx.$queryRawUnsafe(IDENTITY_SQL);
    check(found.length === 1 && found[0].database === target.database && found[0].username === attestation.dbUser &&
      found[0].address === attestation.serverAddress && Number(found[0].port) === attestation.serverPort &&
      found[0].schema === "public", "DATABASE_IDENTITY_MISMATCH");
    return found[0];
  }

  async function guard(tx) {
    await identity(tx);
    const catalog = await readCatalog(tx);
    check(same(catalog.foundTables, tables), "UNKNOWN_SCHEMA_TABLES");
    check(catalog.schemaHash === attestation.schemaHash, "DDL_DIGEST_CHANGED");
    assertMigration(catalog.migrations, sqlHash);
    return catalog;
  }

  async function snapshot(tx) {
    const rows = {};
    for (const table of tables) {
      const result = await tx.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS raw FROM public."${table}" AS t`);
      check(Array.isArray(result) && result.every((row) => typeof row.raw === "string"), "RAW_SNAPSHOT_INVALID");
      rows[table] = result.map((row) => row.raw);
    }
    return { schemaTables: tables, schemaHash: attestation.schemaHash,
      fingerprintTargetKind: target.kind, rows };
  }

  async function assertFixtureReferences(tx) {
    check(plan, "PLAN_REQUIRED_FOR_INSERT");
    const before = await snapshot(tx);
    const occupied = new Set(planIds(plan));
    for (const raws of Object.values(before.rows)) {
      for (const raw of raws) check(!occupied.has(JSON.parse(raw).id), "OWNED_ID_COLLISION");
    }
    check(same(cashRawFingerprints(before, tables), plan.baseline), "FOREIGN_FINGERPRINT_DRIFT");
    const users = before.rows.User.map((raw) => JSON.parse(raw));
    const projects = before.rows.Project.map((raw) => JSON.parse(raw));
    const clients = before.rows.Client.map((raw) => JSON.parse(raw));
    check(plan.users.every((user) => !users.some((row) => row.email === user.email)) &&
      !projects.some((row) => row.number === plan.project.number || row.numberInt === plan.project.numberInt), "QA_NATURAL_KEY_COLLISION");
    const manager = users.find((user) => user.id === plan.actors.managerId);
    const finance = users.find((user) => user.id === plan.actors.financeId);
    check(manager?.active === true && Array.isArray(manager.roles) && manager.roles.some((role) => ["ADMIN", "DIRECTOR", "MANAGER"].includes(role)) &&
      finance?.active === true && Array.isArray(finance.roles) && finance.roles.some((role) => ["ADMIN", "DIRECTOR", "ACCOUNTANT"].includes(role)) &&
      clients.some((client) => client.id === plan.project.clientId && typeof client.name === "string" && client.name.length > 0),
    "ACTOR_OR_CLIENT_CHANGED");
  }

  async function insertOne(tx, sql, values) {
    check(await tx.$executeRawUnsafe(sql, ...values) === 1, "INSERT_ROWCOUNT_MISMATCH");
  }

  async function insertExactFixture(tx, candidate) {
    check(plan && same(candidate, plan), "PLAN_REQUIRED_FOR_INSERT");
    await assertFixtureReferences(tx);
    for (const user of plan.users) await insertOne(tx,
      'INSERT INTO public."User" (id,email,name,"passwordHash",roles,"payScheme",active,"updatedAt") VALUES ($1,$2,$3,$4,ARRAY[\'WORKER\']::public."Role"[],\'NONE\'::public."PayScheme",$5,now())',
      [user.id, user.email, user.name, user.passwordHash, user.active]);
    for (const account of plan.accounts) await insertOne(tx,
      'INSERT INTO public."CashAccount" (id,name,currency,active,"updatedAt") VALUES ($1,$2,$3,true,now())',
      [account.id, account.name, account.currency]);
    await insertOne(tx,
      'INSERT INTO public."Project" (id,number,"numberInt",title,stage,currency,"managerId","clientId","createdById","updatedAt") VALUES ($1,$2,$3,$4,\'LEAD\'::public."ProjectStage",\'BYN\',$5,$6,$5,now())',
      [plan.project.id, plan.project.number, plan.project.numberInt, plan.project.title, plan.actors.managerId, plan.project.clientId]);
    for (const payment of plan.payments) await insertOne(tx,
      'INSERT INTO public."Payment" (id,"projectId",direction,amount,currency,rate,"rateDate","bynAmount","projectAmount","cashAccountId",comment,"createdById") VALUES ($1,$2,\'INCOME\'::public."PaymentDirection",$3::numeric,$4,$5::numeric,$6::timestamp,$7::numeric,$8::numeric,$9,$10,$11)',
      [payment.id, payment.projectId, payment.amount, payment.currency, payment.rate,
        payment.rateDate ? `${payment.rateDate}T12:00:00.000Z` : null, payment.bynAmount, payment.projectAmount,
        payment.cashAccountId, payment.comment, plan.actors.financeId]);
    await insertOne(tx,
      'INSERT INTO public."PayrollEntry" (id,"userId",amount,currency,scheme,month,comment,"taskId","productId","settlementShareId") VALUES ($1,$2,$3::numeric,\'BYN\',\'PIECE\',$4,$5,NULL,NULL,NULL)',
      [plan.accrual.id, plan.accrual.userId, plan.accrual.amount, plan.accrual.month, plan.accrual.comment]);
  }

  async function deleteExact(tx, table, ids) {
    check(CLEANUP.has(table) && approvedCapture && Array.isArray(ids) && ids.length > 0 &&
      new Set(ids).size === ids.length && ids.every((id) => (allowedDeletes[table] ?? []).includes(id)), "DELETE_IDS_FORBIDDEN");
    const deleted = await tx.$queryRawUnsafe(`DELETE FROM public."${table}" WHERE id = ANY($1::text[]) RETURNING id`, ids);
    check(Array.isArray(deleted) && same(sorted(deleted.map((row) => row.id)), sorted(ids)), "EXACT_DELETE_COUNT_MISMATCH");
    return deleted.length;
  }

  function wrapped(tx, writable) {
    return { snapshot: () => snapshot(tx), prismaTx: tx,
      ...(writable ? { insertExactFixture: (candidate) => insertExactFixture(tx, candidate),
        deleteExact: (table, ids) => deleteExact(tx, table, ids), prismaTx: tx } : {}) };
  }

  async function readOnly(operation) {
    assertCashRuntimeAttestation(target, attestation, sqlHash, now());
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
      await guard(tx);
      return operation(wrapped(tx, false));
    }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 120000 });
  }

  async function transaction(operation) {
    requireWriteAuthorization();
    assertCashRuntimeAttestation(target, attestation, sqlHash, now());
    await readOnly(async () => true); // independent identity/schema preflight before any lock on a pooled connection
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
      await identity(tx); // first statement on this connection; avoid locking an unexpected host
      await tx.$queryRawUnsafe("SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)");
      await tx.$executeRawUnsafe(`LOCK TABLE ${tables.map((table) => `public."${table}"`).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
      await guard(tx); // recheck under both locks before any business read/write
      return operation(wrapped(tx, true));
    }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 120000 });
  }

  async function rollbackOnly(operation) {
    const sentinel = new CashSqlStop("INTENTIONAL_ROLLBACK");
    let result;
    try {
      await transaction(async (tx) => { result = await operation(tx); throw sentinel; });
    } catch (error) {
      if (error === sentinel) return result;
      throw error;
    }
    throw new CashSqlStop("ROLLBACK_NOT_OBSERVED");
  }

  async function probeLockPair({ maxWaitMs = 3000, pollIntervalMs = 50 } = {}) {
    requireWriteAuthorization();
    assertCashRuntimeAttestation(target, attestation, sqlHash, now());
    check(Number.isInteger(maxWaitMs) && maxWaitMs >= 50 && maxWaitMs <= 5000 &&
      Number.isInteger(pollIntervalMs) && pollIntervalMs >= 5 && pollIntervalMs <= 250, "LOCK_PROBE_BOUNDS_INVALID");
    await readOnly(async () => true);
    let heldResolve, pidResolve, releaseResolve;
    const held = new Promise((resolve) => { heldResolve = resolve; });
    const pidReady = new Promise((resolve) => { pidResolve = resolve; });
    const release = new Promise((resolve) => { releaseResolve = resolve; });
    const lockSql = "SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)";
    const waitSql = "SELECT l.pid,l.granted,a.wait_event_type FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid WHERE l.pid=$1 AND l.locktype='advisory' AND l.classid=18435 AND l.objid=55001 AND l.objsubid=2 AND l.granted=false AND a.wait_event_type='Lock'";
    const options = { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 };
    const first = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      await identity(tx);
      await tx.$queryRawUnsafe(lockSql);
      heldResolve(tx);
      await release;
    }, options);
    let second = null;
    try {
      const holder = await Promise.race([held, first.then(() => { throw new CashSqlStop("FIRST_LOCK_NOT_HELD"); })]);
      let secondAcquired = false;
      second = prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
        await identity(tx);
        const pids = await tx.$queryRawUnsafe("SELECT pg_backend_pid() AS pid");
        check(pids.length === 1 && Number.isInteger(pids[0].pid), "WAITER_PID_UNKNOWN");
        pidResolve(pids[0].pid);
        await tx.$queryRawUnsafe(lockSql);
        secondAcquired = true;
      }, options);
      const waiterPid = await Promise.race([pidReady, second.then(() => { throw new CashSqlStop("WAITER_EXITED_BEFORE_PID"); })]);
      const deadline = Date.now() + maxWaitMs;
      let observed = false;
      while (Date.now() < deadline && !observed) {
        check(!secondAcquired, "LOCK_NOT_EXCLUSIVE");
        const locks = await holder.$queryRawUnsafe(waitSql, waiterPid);
        observed = locks.length === 1 && locks[0].pid === waiterPid && locks[0].granted === false &&
          locks[0].wait_event_type === "Lock";
        if (!observed) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      check(observed && !secondAcquired, "LOCK_WAIT_NOT_OBSERVED");
      releaseResolve();
      await Promise.all([first, second]);
      check(secondAcquired, "SECOND_LOCK_NOT_ACQUIRED");
      return { advisoryLock: "18435,55001", waiterPid, waited: true, writes: 0 };
    } finally {
      releaseResolve?.();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
  }

  return { readOnly, transaction, rollbackOnly, probeLockPair, target, schemaTables: tables, schemaHash: attestation.schemaHash };
}
