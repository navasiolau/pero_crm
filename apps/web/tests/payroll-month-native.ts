import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";
import { payrollMonthRange, payrollMonth } from "../src/lib/payroll-month";
import { sumHistoricalByn } from "../src/lib/history-byn";
import type { PayrollReadModel } from "../src/server/payroll/summary-read-model";
import { nativeAcceptanceBinding, nativeDatabaseIdentity, type NativeDeclaration } from "./helpers/native-acceptance-target";
import { nativeSnapshot, verifiedRollback, type OwnedRowKeys } from "./helpers/native-acceptance-snapshot";

const protectedTables = ["CashAccount", "Payment", "PayrollEntry", "Payout", "ChangeLog", "DomainEvent"] as const;
type Fingerprint = Record<string, { count: string; digest: string }[]>;
async function fingerprint(database: PrismaClient | Prisma.TransactionClient): Promise<Fingerprint> {
  const result: Fingerprint = {};
  for (const table of protectedTables)
    result[table] = await database.$queryRawUnsafe(`SELECT count(*)::text AS count, md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY id), '')) AS digest FROM "${table}" t`);
  return result;
}

export async function runPayrollMonthNative(database: PrismaClient) {
  const [identity] = await database.$queryRaw<{ database: string; username: string }[]>`SELECT current_database() AS database, current_user AS username`;
  assert.deepEqual(identity, { database: "pero_crm", username: "pero" }, "PAYROLL131_DATABASE_IDENTITY_GUARD");
  const { issuePayoutCore } = await import("../src/server/payroll/cash-core");
  const { getMonthTurnover } = await import("../src/server/payroll/queries");
  const columns = await database.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Payment'`;
  for (const name of ["id", "paidAt", "bynAmount", "cashAccountId", "deletionId", "logisticsAllocationId"])
    assert.ok(columns.some((column) => column.column_name === name), "PAYROLL131_SCHEMA_GUARD:" + name);
  const before = await fingerprint(database);
  const [historicalAnomalies] = await database.$queryRaw<{ payroll: string; payouts: string }[]>`
    SELECT (SELECT count(*)::text FROM "PayrollEntry" WHERE month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR month LIKE '0000-%') AS payroll,
           (SELECT count(*)::text FROM "Payout" WHERE month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR month LIKE '0000-%') AS payouts`;
  const marker = "qa131-" + randomUUID();
  const rollback = new Error("PAYROLL131_EXPECTED_ROLLBACK");
  let boundaryChecks = 0, invalidChecks = 0;
  let originalFailure: unknown, rollbackFailure: unknown;
  try {
    await database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
      assert.deepEqual(await fingerprint(tx), before, "PAYROLL131_BASELINE_DRIFT");
      const day = new Date().toISOString().slice(0, 10);
      const rate = { currency: "BYN" as const, rate: "1.000000", date: day };
      const rates = { asOf: day, cash: rate, payroll: rate };
      for (const month of ["2025-13", "2026-00", "0000-01", "2026-1", "2026-01\n"]) {
        await assert.rejects(issuePayoutCore({ id: marker, name: "QA131", roles: ["ACCOUNTANT"], source: "web" },
          { kind: "SALARY", userId: marker, cashAccountId: marker, cashAmount: "1.00", expectedCashCurrency: "BYN", requestId: randomUUID(), month }, rates, tx), /месяц/);
        await assert.rejects(getMonthTurnover(month, tx), /месяц/);
        invalidChecks += 1;
      }
      assert.deepEqual(await fingerprint(tx), before, "PAYROLL131_INVALID_INPUT_WROTE_DATA");
      await tx.cashAccount.create({ data: { id: marker, name: "QA131 rollback-only", currency: "BYN" } });
      for (const month of ["2024-02", "2026-01", "2014-10", "1981-03", "1981-04"]) {
        const { start, end } = payrollMonthRange(month);
        const points = [start.getTime() - 1, start.getTime(), end.getTime() - 1, end.getTime()];
        const ids = points.map((_, index) => `${marker}-${month}-${index}`);
        for (const [index, instant] of points.entries()) {
          const amount = index === 1 ? "1.01" : index === 2 ? "3.21" : "99.00";
          await tx.payment.create({ data: { id: `${marker}-${month}-${index}`, cashAccountId: marker,
            direction: "INCOME", amount, currency: "BYN", rate: 1, bynAmount: amount,
            paidAt: new Date(instant), comment: marker } });
        }
        const control = await tx.payment.aggregate({ where: { id: { in: ids }, cashAccountId: marker, direction: "INCOME", paidAt: { gte: start, lt: end } }, _sum: { bynAmount: true }, _count: { _all: true } });
        assert.equal(control._sum.bynAmount!.toFixed(2), "4.22"); assert.equal(control._count._all, 2);
        const payment = new Proxy(tx.payment, { get(delegate, key) {
          if (key === "aggregate") return (args: Prisma.PaymentAggregateArgs) => delegate.aggregate({ ...args, where: { ...args.where, cashAccountId: marker, id: { in: ids } } });
          return Reflect.get(delegate, key);
        } });
        const turnoverBefore = await getMonthTurnover(month, { payment });
        assert.deepEqual(turnoverBefore, { total: 4.22, paymentsCount: 2, currency: "BYN" });
        boundaryChecks += 1;
      }
      throw rollback;
    }, { maxWait: 5_000, timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    throw new Error("PAYROLL131_ROLLBACK_MISSING");
  } catch (error) {
    if (error !== rollback) originalFailure = error;
  } finally {
    try {
      assert.deepEqual(await fingerprint(database), before, "PAYROLL131_POST_ROLLBACK_DATA_DRIFT");
      assert.equal(await database.payment.count({ where: { comment: marker } }), 0, "PAYROLL131_FIXTURE_PERSISTED");
      assert.equal(await database.cashAccount.count({ where: { id: marker } }), 0, "PAYROLL131_ACCOUNT_PERSISTED");
    } catch (error) { rollbackFailure = error; }
  }
  if (rollbackFailure) throw new AggregateError([originalFailure, rollbackFailure].filter((error) => error !== undefined), "PAYROLL131_ROLLBACK_NOT_CONFIRMED_STOP");
  if (originalFailure) throw Object.assign(originalFailure instanceof Error ? originalFailure : new Error("PAYROLL131_NATIVE_FAILED"), { rollbackVerified: true });
  return { status: "NATIVE_PASS", invalidChecks, boundaryChecks, persistentFixtureRows: 0,
    protectedFingerprintsUnchanged: true, historicalAnomalies };
}

export async function verifyPayrollMonthRollback(database: PrismaClient) {
  const columns: Record<typeof protectedTables[number], string> = {
    CashAccount: "id", Payment: "id", PayrollEntry: "userId", Payout: "userId", ChangeLog: "actorId", DomainEvent: "actor",
  };
  return database.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const [identity] = await tx.$queryRaw<{ database: string; username: string }[]>`SELECT current_database() AS database, current_user AS username`;
    assert.deepEqual(identity, { database: "pero_crm", username: "pero" }, "PAYROLL131_DATABASE_IDENTITY_GUARD");
    const ownedCounts: Record<string, string> = {};
    for (const table of protectedTables) {
      const [row] = await tx.$queryRawUnsafe<{ count: string }[]>(`SELECT count(*)::text AS count FROM "${table}" WHERE "${columns[table]}" LIKE 'qa131-%'`);
      assert.equal(row.count, "0", "PAYROLL131_PERSISTENT_FIXTURE_FOUND:" + table);
      ownedCounts[table] = row.count;
    }
    return { status: "ROLLBACK_OWNED_ROWS_ABSENT", readOnly: true, ownedCounts, fingerprints: await fingerprint(tx) };
  });
}

// №149 использует тот же native-модуль и shared target/snapshot/rollback helpers.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md: mismatch/UNKNOWN STOP.
export function payrollSummaryFixture(runId: string, current: string) {
  assert.match(runId, /^[a-f0-9-]{36}$/i, "P149_FIXTURE_RUN_ID");
  const prefix = "qa149:" + runId + ":", accountId = prefix + "cash";
  const users: Prisma.UserCreateManyInput[] = Array.from({ length: 20 }, (_, index) => ({
    id: prefix + "user-" + index, email: "qa149." + runId + "." + index + "@invalid.local",
    name: "QA149 " + String(index).padStart(2, "0"), passwordHash: "QA149_LOGIN_DISABLED",
    roles: index === 3 ? ["ENGINEER"] : ["MANAGER", "ENGINEER"], active: index !== 0,
    payScheme: index === 0 ? "NONE" : index % 3 === 0 ? "PERCENT_TURNOVER" : "PIECE",
    payPercent: index % 3 === 0 ? "3" : null, calendarEnabled: false,
  }));
  const accounts: Prisma.CashAccountCreateManyInput[] = [{ id: accountId, name: prefix + "rollback-only", currency: "RUB" }];
  const entries: Prisma.PayrollEntryCreateManyInput[] = [], payouts: Prisma.PayoutCreateManyInput[] = [];
  for (let index = 0; index < users.length; index++) {
    const userId = users[index].id!;
    const patterns = [
      { month: "2020-01", amount: "100", currency: "BYN", bynAmount: null, scheme: "PIECE" },
      { month: "2020-01", amount: "-0.03", currency: "BYN", bynAmount: "-0.03", scheme: "PIECE" },
      { month: "2020-01", amount: "0.03", currency: "BYN", bynAmount: "0.03", scheme: "PIECE" },
      { month: "2020-01", amount: "10", currency: "USD", bynAmount: "30", scheme: "PERCENT_TURNOVER" },
      { month: "2020-01", amount: "999", currency: "USD", bynAmount: "0", scheme: "PIECE" },
      { month: current, amount: "6", currency: "BYN", bynAmount: "6", scheme: "PIECE" },
      { month: current, amount: "9", currency: "USD", bynAmount: index === 0 ? null : "27", scheme: "PIECE" },
      { month: "2999-01", amount: "7", currency: "BYN", bynAmount: "7", scheme: "PIECE" },
    ];
    for (const [position, money] of patterns.entries()) entries.push({ id: prefix + "entry-" + index + "-" + position, userId,
      ...money, comment: "QA149 rollback-only", createdAt: new Date(Date.UTC(2020, 0, 2, 0, 0, index, position)) });
    for (let position = 0; position < 3; position++) {
      const legacy = index === 0 && position === 2, amount = position === 1 ? "0.01" : "2";
      payouts.push({ id: prefix + "payout-" + index + "-" + position, userId, amount,
        month: position === 2 ? "2999-01" : "2020-01", kind: position === 1 ? "ADVANCE" : "SALARY",
        createdById: users[0].id, comment: "QA149 rollback-only", createdAt: new Date(Date.UTC(2020, 0, 3, 0, 0, index, position)),
        cashAccountId: legacy ? null : accountId, cashAmount: legacy ? null : amount, cashCurrency: legacy ? null : "RUB",
        bynAmount: legacy ? null : position === 1 ? "0" : "0.06", cashRate: legacy ? null : "0.030000", payrollRate: legacy ? null : "0.030000",
        cashRateDate: legacy ? null : new Date("2020-01-03"), payrollRateDate: legacy ? null : new Date("2020-01-03"), payrollCurrency: legacy ? null : "RUB" });
    }
  }
  const expand = <Row extends { id?: string }>(rows: Row[]) => Array.from({ length: 9 }, (_, copy) =>
    rows.map(row => ({ ...row, id: row.id! + "-copy-" + copy }))).flat();
  return { prefix, users, accounts, entries, payouts, expandedEntries: expand(entries), expandedPayouts: expand(payouts) };
}

type NativeMoney = Parameters<typeof sumHistoricalByn>[0][number] & { userId: string };
function previousPayrollGroup<Row extends NativeMoney>(rows: readonly Row[]) {
  return new Map([...new Set(rows.map(row => row.userId))].map(id => [id, sumHistoricalByn(rows.filter(row => row.userId === id))]));
}
// Прежние WHERE selectors и отдельные группировки исполняются настоящим Prisma в том же RR.
async function previousPayrollInputs(tx: Prisma.TransactionClient, month: string, current: string, userScope: string | null = null): Promise<PayrollReadModel> {
  const user = userScope === null ? {} : { userId: userScope };
  const entrySelect = { userId: true, amount: true, currency: true, bynAmount: true } as const;
  const payoutSelect = { userId: true, amount: true, payrollCurrency: true, bynAmount: true } as const;
  const [selected, paid, advances, past, estimates, turnover, total, all] = await Promise.all([
    tx.payrollEntry.findMany({ where: { ...user, month }, select: entrySelect }),
    tx.payout.findMany({ where: { ...user, month }, select: payoutSelect }),
    tx.payout.findMany({ where: { ...user, month, kind: "ADVANCE" }, select: payoutSelect }),
    tx.payrollEntry.findMany({ where: { ...user, month: { lt: current } }, select: entrySelect }),
    tx.payrollEntry.findMany({ where: { ...user, month: current }, select: entrySelect }),
    tx.payrollEntry.findMany({ where: { ...user, month, scheme: "PERCENT_TURNOVER" }, select: entrySelect }),
    tx.payout.findMany({ where: user, select: payoutSelect }),
    tx.payout.findMany({ select: { amount: true, payrollCurrency: true, bynAmount: true } }),
  ]);
  return { selectedMonth: month, currentPeriod: current, userScope, accrued: previousPayrollGroup(selected),
    paid: previousPayrollGroup(paid), advances: previousPayrollGroup(advances), pastAccrued: previousPayrollGroup(past),
    estimates: previousPayrollGroup(estimates), turnoverAccrued: previousPayrollGroup(turnover), totalPaid: previousPayrollGroup(total), allPaid: sumHistoricalByn(all) };
}

export async function payrollSummarySourceDigest() {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const files = ["apps/web/src/server/payroll/queries.ts", "apps/web/src/server/payroll/summary-read-model.ts", "apps/web/src/server/payroll/actions.ts",
    "apps/web/src/app/(app)/finance/payroll/page.tsx", "apps/web/tests/payroll-month-native.ts", "apps/web/src/lib/history-byn.ts",
    "apps/web/src/lib/payroll-month.ts", "apps/web/src/lib/roles.ts", "apps/web/tests/helpers/native-acceptance-target.ts",
    "apps/web/tests/helpers/local-crm-database.ts", "apps/web/tests/helpers/native-acceptance-snapshot.ts", "apps/web/prisma/schema.prisma"];
  const pins = await Promise.all(files.map(async file => [file, createHash("sha256").update(await readFile(resolve(root, file))).digest("hex")]));
  return createHash("sha256").update(JSON.stringify(pins)).digest("hex");
}

export async function runPayrollSummaryNative(input: NativeDeclaration & { expectedOriginalDigest: string }) {
  assert.equal(process.env.CRM_NATIVE149_GO, "OWNED_ROLLBACK", "P149_EXPLICIT_GO");
  assert.equal(input.target, "local", "P149_LOCAL_ONLY");
  assert.equal(input.scenarioId, "payroll-summary-149", "P149_SCENARIO");
  assert.match(input.expectedOriginalDigest, /^[a-f0-9]{64}$/, "P149_ORIGINAL_PIN");
  const sourceDigest = await payrollSummarySourceDigest();
  assert.equal(sourceDigest, process.env.CRM_NATIVE149_SOURCE_SHA256, "P149_SOURCE_PIN");
  const binding = nativeAcceptanceBinding(input);
  const database = new PrismaClient({ datasourceUrl: binding.url, log: [{ emit: "event", level: "query" }] });
  const events: Prisma.QueryEvent[] = []; database.$on("query", event => events.push(event));
  const priorFetch = globalThis.fetch, priorPrisma = (globalThis as { prisma?: PrismaClient }).prisma;
  let phase = "BEFORE", failurePhase: string | undefined, outbound = 0, rejected = false;
  let beforeDigest: string | null = null, afterDigest: string | null = null, ownAfter: number | null = null, sourceMatch = false;
  const owned: OwnedRowKeys = {};
  globalThis.fetch = async () => { outbound++; throw Error("P149_OUTBOUND"); };
  const snapshot = (countOwned = false) => database.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); await nativeDatabaseIdentity(tx, input);
    const value = await nativeSnapshot(tx);
    if (countOwned) {
      ownAfter = 0;
      for (const [table, keys] of Object.entries(owned)) {
        const [row] = await tx.$queryRawUnsafe<{ count: number }[]>(`SELECT count(*)::integer AS count FROM "${table}" WHERE id = ANY($1::text[])`, keys.ids);
        ownAfter += row.count;
      }
    }
    return value;
  }, { isolationLevel: "RepeatableRead", timeout: 120000 });
  try {
    const before = await snapshot(); beforeDigest = before.digest;
    assert.equal(before.digest, input.expectedOriginalDigest, "P149_ORIGINAL_BASELINE");
    return await verifiedRollback(async () => {
      const rollback = Error("P149_EXPECTED_ROLLBACK"); let report: Record<string, unknown> | undefined;
      try { await database.$transaction(async tx => {
        await nativeDatabaseIdentity(tx, input); await tx.$executeRawUnsafe("SET LOCAL statement_timeout='30s'");
        const [target] = await tx.$queryRaw<{ primary: boolean }[]>`SELECT NOT pg_is_in_recovery() AS primary`; assert.equal(target.primary, true, "P149_PRIMARY");
        (globalThis as { prisma?: PrismaClient }).prisma = tx as unknown as PrismaClient;
        const queries = await import("../src/server/payroll/queries"), model = await import("../src/server/payroll/summary-read-model");
        const current = payrollMonth(), month = "2020-01", fixture = payrollSummaryFixture(input.runId, current);
        const rows = { User: fixture.users, CashAccount: fixture.accounts, PayrollEntry: [...fixture.entries, ...fixture.expandedEntries], Payout: [...fixture.payouts, ...fixture.expandedPayouts] };
        phase = "COLLISIONS";
        for (const [table, values] of Object.entries(rows)) {
          const ids = values.map(row => row.id!); assert.ok(ids.every(id => id.startsWith(fixture.prefix)), "P149_OWN_KEYS");
          assert.equal(new Set(ids).size, ids.length, "P149_OWN_UNIQUE"); owned[table] = { column: "id", ids };
          const [collision] = await tx.$queryRawUnsafe<{ count: number }[]>(`SELECT count(*)::integer AS count FROM "${table}" WHERE id = ANY($1::text[])`, ids);
          assert.equal(collision.count, 0, "P149_COLLISION");
        }
        await tx.cashAccount.createMany({ data: fixture.accounts });
        let markerSequence = 0;
        const fence = async () => {
          const marker = fixture.prefix + "fence-" + markerSequence++; await tx.$queryRaw`SELECT ${marker}::text AS "payroll149Fence"`;
          const deadline = performance.now() + 5000; let at = -1;
          while ((at = events.findIndex(event => event.query.includes('"payroll149Fence"') && event.params.includes(marker))) < 0) {
            assert.ok(performance.now() < deadline, "P149_FENCE"); await new Promise(resolve => setTimeout(resolve, 1));
          } return at;
        };
        const measure = async <T,>(read: () => Promise<T>) => { const start = await fence(), value = await read(), end = await fence(); return { value, count: end - start - 1 }; };
        const consumer = (data: PayrollReadModel) => Promise.all([queries.getPayrollSummary(month, data), queries.getEmployeeDues(data),
          queries.getCurrentMonthEstimates(data), queries.getOrgBalance(data), queries.getTurnoverAccruals(month, data), queries.listPayrollUsers(data)]);
        const counts: { employees: number; previousSelectors: number; sharedInputs: number; financeRead: number }[] = [];
        let inserted = 0;
        for (const size of [1, 5, 20]) {
          phase = "INSERT_" + size; const users = fixture.users.slice(inserted, size), ids = new Set(users.map(row => row.id!));
          await tx.user.createMany({ data: users });
          await tx.payrollEntry.createMany({ data: fixture.entries.filter(row => ids.has(row.userId)) });
          await tx.payout.createMany({ data: fixture.payouts.filter(row => ids.has(row.userId)) }); inserted = size;
          phase = "COMPARE_" + size;
          const expected = await measure(() => previousPayrollInputs(tx, month, current));
          const actual = await measure(() => queries.readPayrollSummary(month));
          assert.deepEqual(actual.value, expected.value, "P149_INPUT_DTO");
          const finance = await measure(async () => { const data = await queries.readPayrollSummary(month); return consumer(data); });
          assert.deepEqual(finance.value, await consumer(expected.value), "P149_CONSUMER_DTO");
          assert.deepEqual(await queries.getPayrollSummary(month), finance.value[0], "P149_STANDALONE_DTO");
          const personalId = fixture.users[0].id!, personal = await queries.getMyPayroll(personalId, month);
          const own = await previousPayrollInputs(tx, month, current, personalId);
          assert.deepEqual({ accrued: personal.accrued, paid: personal.paid, debt: personal.debt, estimate: personal.estimate },
            { accrued: model.payrollAmount(own.accrued, personalId), paid: model.payrollAmount(own.paid, personalId),
              debt: (await import("../src/lib/history-byn")).subtractByn(model.payrollAmount(own.pastAccrued, personalId), model.payrollAmount(own.totalPaid, personalId)),
              estimate: model.payrollAmount(own.estimates, personalId) }, "P149_PERSONAL_DTO");
          counts.push({ employees: size, previousSelectors: expected.count, sharedInputs: actual.count, financeRead: finance.count });
          assert.deepEqual(await nativeSnapshot(tx, owned), before, "P149_ORIGINAL_DURING");
        }
        assert.equal(counts[0].sharedInputs, 2, "P149_TWO_INPUT_QUERIES");
        assert.ok(counts.every(row => row.sharedInputs === 2 && row.previousSelectors > row.sharedInputs), "P149_REDUCED_INPUT_QUERIES");
        assert.ok(counts[2].financeRead <= counts[0].financeRead + 2, "P149_QUERY_BUDGET");
        phase = "BENCHMARK";
        const base = await tx.payrollEntry.findMany({ where: { id: { in: fixture.entries.map(row => row.id!) } } });
        const smallStart = performance.now(), small = model.groupHistoricalByn(base), smallEnd = performance.now();
        assert.deepEqual(small, previousPayrollGroup(base), "P149_BENCHMARK_SMALL");
        await tx.payrollEntry.createMany({ data: fixture.expandedEntries }); await tx.payout.createMany({ data: fixture.expandedPayouts });
        const larger = await tx.payrollEntry.findMany({ where: { id: { in: owned.PayrollEntry.ids } } });
        const largeStart = performance.now(), large = model.groupHistoricalByn(larger), largeEnd = performance.now();
        assert.deepEqual(large, previousPayrollGroup(larger), "P149_BENCHMARK_LARGE"); assert.equal(larger.length, base.length * 10, "P149_TENFOLD");
        assert.deepEqual(await queries.readPayrollSummary(month), await previousPayrollInputs(tx, month, current), "P149_LARGE_INPUT_DTO");
        assert.deepEqual(await nativeSnapshot(tx, owned), before, "P149_ORIGINAL_FINAL"); assert.equal(outbound, 0, "P149_OUTBOUND_ZERO");
        report = { counts, benchmark: { smallRows: base.length, largeRows: larger.length, smallMs: smallEnd - smallStart, largeMs: largeEnd - largeStart },
          fixtureRows: Object.values(owned).reduce((sum, keys) => sum + keys.ids.length, 0) };
        phase = "ROLLBACK"; throw rollback;
      }, { isolationLevel: "RepeatableRead", timeout: 120000 }); } catch (error) { rejected = true; if (error !== rollback) { failurePhase = phase; throw error; } }
      assert.ok(report, "P149_REPORT"); return { ok: true, runId: input.runId, target: binding.identity, sourceDigest, mode: "OWNED_ROLLBACK", ...report,
        rolledBack: true, originalDigest: before.digest, originalsEqual: true, ownedRowsAfter: 0, outbound: 0 };
    }, async () => {
      phase = "AFTER"; const after = await snapshot(true); afterDigest = after.digest;
      assert.deepEqual(after, before, "P149_ORIGINAL_AFTER"); assert.equal(ownAfter, 0, "P149_OWN_ZERO");
      sourceMatch = await payrollSummarySourceDigest() === sourceDigest; assert.equal(sourceMatch, true, "P149_SOURCE_AFTER");
    });
  } catch (error) {
    const value = error as { name?: string; code?: string; meta?: { code?: string } };
    throw Object.assign(Error("P149_NATIVE_HOLD"), { payroll149Diagnostic: { phase: failurePhase ?? phase,
      errorName: ["AssertionError", "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError", "PrismaClientValidationError", "AggregateError", "Error"].includes(value.name ?? "") ? value.name : "OtherError",
      prismaCode: /^P\d{4}$/.test(value.code ?? "") ? value.code : null, sqlState: /^[A-Z0-9]{5}$/.test(value.meta?.code ?? "") ? value.meta!.code : null,
      beforeDigest, afterDigest, originalsMatch: beforeDigest !== null && beforeDigest === afterDigest, ownAfter, sourceMatch, outbound,
      rollbackVerified: rejected && beforeDigest !== null && beforeDigest === afterDigest && ownAfter === 0 } });
  } finally { globalThis.fetch = priorFetch; if (priorPrisma) (globalThis as { prisma?: PrismaClient }).prisma = priorPrisma;
    else delete (globalThis as { prisma?: PrismaClient }).prisma; await database.$disconnect(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const mode = process.argv.slice(2).join(" ");
  if (mode !== "--execute-local" && mode !== "--verify-local-readonly") {
    console.log(JSON.stringify({ status: "DRY_RUN", connectionOpened: false, required: "--execute-local or --verify-local-readonly and CRM_LOCAL_CONTAINER_ID" }));
  } else {
    const url = existingLocalCrmDatabaseUrl();
    const database = new PrismaClient({ datasourceUrl: url });
    const operation = mode === "--verify-local-readonly" ? verifyPayrollMonthRollback(database) : runPayrollMonthNative(database);
    operation.then((result) => console.log(JSON.stringify(result))).catch((error: unknown) => {
      console.error(JSON.stringify({ status: "NATIVE_FAILED", rollbackVerified: error instanceof Error && "rollbackVerified" in error && error.rollbackVerified === true,
        error: error instanceof Error ? error.message : "PAYROLL131_NATIVE_FAILED" })); process.exitCode = 1;
    }).finally(() => database.$disconnect());
  }
}
