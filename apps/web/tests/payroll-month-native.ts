import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";
import { payrollMonthRange } from "../src/lib/payroll-month";
import { issuePayoutCore } from "../src/server/payroll/cash-core";
import { getMonthTurnover } from "../src/server/payroll/queries";

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