import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { after, test } from "node:test";

const require = createRequire(import.meta.url);
const prismaPath = require.resolve("../src/lib/prisma");
const previousPrisma = require.cache[prismaPath];
let databaseReads = 0;
const noDatabase = new Proxy({}, { get() { databaseReads += 1; throw new Error("UNEXPECTED_DATABASE_ACCESS"); } });
const prismaStub = new Module(prismaPath);
prismaStub.filename = prismaPath;
prismaStub.loaded = true;
prismaStub.exports = { prisma: noDatabase };
require.cache[prismaPath] = prismaStub;
const queriesPath = require.resolve("../src/server/payroll/queries");
const previousQueries = require.cache[queriesPath];
const payroll = require(queriesPath) as typeof import("../src/server/payroll/queries");
after(() => {
  if (previousPrisma) require.cache[prismaPath] = previousPrisma; else delete require.cache[prismaPath];
  if (previousQueries) require.cache[queriesPath] = previousQueries; else delete require.cache[queriesPath];
});

test("payroll period rejects calendar aliases and noncanonical keys", () => {
  for (const key of [undefined, "", "2025-13", "2026-00", "2026-1", "26-01", "0000-01", "10000-01", " 2026-01", "2026-01 ", "2026-01\n"])
    assert.equal(payroll.isValidMonth(key), false, String(key));
  for (const key of ["0001-01", "0099-12", "2024-02", "2026-01", "9999-12"])
    assert.equal(payroll.isValidMonth(key), true, key);
});

test("current payroll month changes at Moscow midnight, including year boundary", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T20:59:59.999Z").getTime() });
  assert.equal(payroll.currentMonth(), "2026-10");
  t.mock.timers.setTime(new Date("2026-10-31T21:00:00.000Z").getTime());
  assert.equal(payroll.currentMonth(), "2026-11");
  t.mock.timers.setTime(new Date("2026-10-31T21:30:00.000Z").getTime());
  assert.equal(payroll.currentMonth(), "2026-11");
  t.mock.timers.setTime(new Date("2026-12-31T20:59:59.999Z").getTime());
  assert.equal(payroll.currentMonth(), "2026-12");
  t.mock.timers.setTime(new Date("2026-12-31T21:00:00.000Z").getTime());
  assert.equal(payroll.currentMonth(), "2027-01");
});

test("month range is half-open Moscow time, leap-aware and independent of process TZ", () => {
  const originalTimezone = process.env.TZ;
  try {
    for (const timezone of ["UTC", "Europe/Moscow", "America/New_York"]) {
      process.env.TZ = timezone;
      const { start, end } = payroll.monthRange("2024-02");
      assert.equal(start.toISOString(), "2024-01-31T21:00:00.000Z", timezone);
      assert.equal(end.toISOString(), "2024-02-29T21:00:00.000Z", timezone);
      assert.equal(end.getTime() - start.getTime(), 29 * 86_400_000);
      const october = payroll.monthRange("2014-10");
      assert.equal(october.start.toISOString(), "2014-09-30T20:00:00.000Z");
      assert.equal(october.end.toISOString(), "2014-10-31T21:00:00.000Z");
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone;
  }
});

test("invalid range throws before a Date rollover or financial read", async () => {
  for (const key of ["2025-13", "2026-00", "0000-01", "2026-1"]) {
    assert.throws(() => payroll.monthRange(key), /месяц|MONTH/);
    await assert.rejects(payroll.getMonthTurnover(key), /месяц|MONTH/);
  }
  assert.equal(databaseReads, 0);
});

test("public monthly payroll readers reject invalid period before touching DB", async () => {
  await assert.rejects(payroll.getMyPayroll("user", "2025-13"), /месяц|MONTH/);
  await assert.rejects(payroll.getPayrollSummary("2026-00"), /месяц|MONTH/);
  await assert.rejects(payroll.getTurnoverAccruals("0000-01"), /месяц|MONTH/);
  assert.equal(databaseReads, 0);
});
test("historical Moscow midnight gap keeps valid March/April contiguous at first actual instant", () => {
  for (const year of [1981, 1982, 1983, 1984]) {
    const march = payroll.monthRange(`${year}-03`), april = payroll.monthRange(`${year}-04`);
    const expected = `${year}-03-31T21:00:00.000Z`;
    assert.equal(march.end.toISOString(), expected);
    assert.equal(april.start.toISOString(), expected);
    assert.equal(march.end.getTime(), april.start.getTime());
    assert.equal(payroll.currentMonth(april.start), `${year}-04`);
    assert.equal(payroll.currentMonth(new Date(april.start.getTime() - 1)), `${year}-03`);
  }
});
test("historical last-day repeated hour keeps September/October ranges adjacent", () => {
  for (const year of [1981, 1982, 1983]) {
    const september = payroll.monthRange(`${year}-09`), october = payroll.monthRange(`${year}-10`);
    assert.equal(september.end.toISOString(), `${year}-09-30T21:00:00.000Z`);
    assert.equal(october.start.getTime(), september.end.getTime());
    assert.equal(payroll.currentMonth(new Date(`${year}-09-30T19:00:00.000Z`)), `${year}-09`);
    assert.equal(payroll.currentMonth(new Date(`${year}-09-30T20:00:00.000Z`)), `${year}-09`);
    assert.equal(payroll.currentMonth(october.start), `${year}-10`);
  }
});