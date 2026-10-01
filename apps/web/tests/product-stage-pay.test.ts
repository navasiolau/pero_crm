import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateStageMinorUnits,
  calculateStageFund,
  distributeStageFund,
  physicalStageQuantity,
  splitStageShareVectors,
  STAGE_SHARE_UNITS,
  type StageFundInput,
  type StageWorkWeight,
} from "../src/lib/product-stage-pay";

const units = (value: string | number) => BigInt(value);
const older = "2026-01-01T00:00:00.000Z";
const newer = "2026-01-02T00:00:00.000Z";
const base: StageFundInput = { price: "10000.00", ratePercent: "5.00", productCurrency: "BYN", payrollCurrency: "BYN", productRateByn: "1", payrollRateByn: "1" };
const task = (id: string, userId: string, stageShareUnits: bigint, createdAt = older) => ({ id, userId, stageShareUnits, createdAt });
const work = (id: string, poolWeightUnits: bigint, tasks: StageWorkWeight["tasks"], createdAt = older) => ({ id, poolWeightUnits, tasks, createdAt });
const splitWorks = () => [
  work("first", units(600000), [task("source-half", "source", units(500000)), task("new-half", "recipient", units(500000), newer)]),
  work("second", units(400000), [task("second-task", "source", STAGE_SHARE_UNITS)]),
];
const beneficiaryAmounts = (distribution: ReturnType<typeof distributeStageFund>) => Object.fromEntries(distribution.beneficiaries.map((row) => [row.userId, row.amount]));
const minorById = (rows: ReturnType<typeof allocateStageMinorUnits>) => Object.fromEntries(rows.map((row) => [row.id, row.amountMinor.toString()]));

test("one 500 pool gives works 300/200 and the first 50% transfer gives 350/150", () => {
  const fund = calculateStageFund(base);
  assert.equal(fund.amount, "500.00");
  const allocation = distributeStageFund(fund, splitWorks());
  assert.deepEqual(allocation.works.map((row) => row.amount), ["300.00", "200.00"]);
  assert.deepEqual(beneficiaryAmounts(allocation), { recipient: "150.00", source: "350.00" });
});

test("a later price changes preview 500→600 and 350/150→420/180 without freezing money", () => {
  const rows = splitWorks();
  const before = structuredClone(rows);
  const allocation = distributeStageFund(calculateStageFund({ ...base, price: "12000.00" }), rows);
  assert.deepEqual(beneficiaryAmounts(allocation), { recipient: "180.00", source: "420.00" });
  assert.deepEqual(rows, before);
});

test("1000 USD ×5% ×3 gives 150 BYN and a 50 USD project equivalent", () => {
  const fund = calculateStageFund({ ...base, price: "1000", productCurrency: "USD", productRateByn: "3" });
  assert.deepEqual(fund, { sourceFundExact: "50.000000", amount: "150.00", bynAmount: "150.00", projectAmount: "50.00" });
});

test("FX divides by the payroll currency quote, without a Number intermediate", () => {
  const fund = calculateStageFund({ ...base, price: "1000", productCurrency: "USD", payrollCurrency: "EUR", productRateByn: "3", payrollRateByn: "6" });
  assert.deepEqual(fund, { sourceFundExact: "50.000000", amount: "25.00", bynAmount: "150.00", projectAmount: "50.00" });
});

test("half-up rounds 0.015 to 0.02 once before calculating equivalents", () => {
  assert.deepEqual(calculateStageFund({ ...base, price: "0.03", ratePercent: "50" }), {
    sourceFundExact: "0.015000", amount: "0.02", bynAmount: "0.02", projectAmount: "0.02",
  });
});

test("source percentage preserves all six decimals at the 0.01 boundary", () => {
  assert.equal(calculateStageFund({ ...base, price: "0.01", ratePercent: "0.01" }).sourceFundExact, "0.000001");
});

test("equivalents use the rounded actual obligation, including zero", () => {
  const quote = { ...base, ratePercent: "100", payrollCurrency: "USD" as const, payrollRateByn: "3" };
  assert.deepEqual(calculateStageFund({ ...quote, price: "0.01" }), { sourceFundExact: "0.010000", amount: "0.00", bynAmount: "0.00", projectAmount: "0.00" });
  assert.deepEqual(calculateStageFund({ ...quote, price: "0.02" }), { sourceFundExact: "0.020000", amount: "0.01", bynAmount: "0.03", projectAmount: "0.03" });
});

test("null price/rate are not configured, while explicit zero is valid", () => {
  assert.throws(() => calculateStageFund({ ...base, ratePercent: null }), { code: "RATE_REQUIRED" });
  assert.throws(() => calculateStageFund({ ...base, price: null }), { code: "PRICE_REQUIRED" });
  assert.deepEqual(calculateStageFund({ ...base, ratePercent: "0" }), { sourceFundExact: "0.000000", amount: "0.00", bynAmount: "0.00", projectAmount: "0.00" });
  assert.equal(calculateStageFund({ ...base, price: "0" }).amount, "0.00");
});

test("FX requires finite positive representable decimals even for a zero fund", () => {
  for (const value of [null, "", "0", "-1", "NaN", "Infinity", "1e3", "0.0000001", NaN, Infinity, 3]) {
    assert.throws(() => calculateStageFund({ ...base, productCurrency: "USD", ratePercent: "0", productRateByn: value as string | null }), String(value));
  }
  assert.throws(() => calculateStageFund({ ...base, payrollCurrency: "EUR", payrollRateByn: "0" }));
});

test("BYN has rate one and equal foreign currencies require equal quotes", () => {
  assert.throws(() => calculateStageFund({ ...base, productRateByn: "2" }), { code: "BYN_RATE_MISMATCH" });
  assert.throws(() => calculateStageFund({ ...base, productCurrency: "USD", payrollCurrency: "USD", productRateByn: "3", payrollRateByn: "2" }), { code: "SAME_CURRENCY_RATE_MISMATCH" });
  assert.throws(() => calculateStageFund({ ...base, productCurrency: "GBP" as "BYN" }), { code: "CURRENCY_UNSUPPORTED" });
});

test("price NUMERIC(12,2) and rate 0..100 bounds are enforced before rounding", () => {
  assert.equal(calculateStageFund({ ...base, price: "9999999999.99", ratePercent: "100" }).amount, "9999999999.99");
  assert.throws(() => calculateStageFund({ ...base, price: "10000000000.00" }), { code: "PRICE_OVERFLOW" });
  for (const price of ["-1", "0.001", "1e2", "NaN", "Infinity"]) assert.throws(() => calculateStageFund({ ...base, price }));
  for (const ratePercent of ["100.01", "-1", "0.001", "NaN", "Infinity"]) assert.throws(() => calculateStageFund({ ...base, ratePercent }));
});

test("FX NUMERIC(18,6) accepts its exact limit and refuses overflow", () => {
  const quote = { ...base, price: "0", productCurrency: "USD" as const, payrollCurrency: "USD" as const, productRateByn: "999999999999.999999", payrollRateByn: "999999999999.999999" };
  assert.equal(calculateStageFund(quote).amount, "0.00");
  assert.throws(() => calculateStageFund({ ...quote, productRateByn: "1000000000000.000000" }), { code: "PRODUCT_FX_OVERFLOW" });
});

test("payroll amount overflow is rejected after exact FX rounding", () => {
  assert.throws(() => calculateStageFund({ ...base, price: "9999999999.99", ratePercent: "100", productCurrency: "USD", productRateByn: "2" }), { code: "AMOUNT_OVERFLOW" });
});

test("BYN NUMERIC(18,2) and project NUMERIC(12,2) have independent overflow checks", () => {
  assert.throws(() => calculateStageFund({ ...base, price: "9999999999.99", ratePercent: "100", productCurrency: "USD", payrollCurrency: "USD", productRateByn: "10000000", payrollRateByn: "10000000" }), { code: "BYN_AMOUNT_OVERFLOW" });
  assert.throws(() => calculateStageFund({ ...base, price: "9999999999.99", ratePercent: "100", productCurrency: "USD", productRateByn: "0.000001" }), { code: "PROJECT_AMOUNT_OVERFLOW" });
});

test("large BYN equivalents remain exact beyond IEEE-754 integer precision", () => {
  assert.equal(calculateStageFund({ ...base, price: "9999999999.99", ratePercent: "100", productCurrency: "USD", payrollCurrency: "USD", productRateByn: "999999.999999", payrollRateByn: "999999.999999" }).bynAmount, "9999999999980000.00");
  assert.deepEqual(minorById(allocateStageMinorUnits(units("999999999999999999"), [
    { id: "old", units: units(500000), createdAt: older }, { id: "new", units: units(500000), createdAt: newer },
  ])), { old: "500000000000000000", new: "499999999999999999" });
});

test("largest remainder uses remainder first, then createdAt and ID", () => {
  assert.deepEqual(minorById(allocateStageMinorUnits(units(1), [
    { id: "a", units: units(333333), createdAt: older }, { id: "b", units: units(333333), createdAt: older }, { id: "c", units: units(333334), createdAt: newer },
  ])), { a: "0", b: "0", c: "1" });
  assert.deepEqual(minorById(allocateStageMinorUnits(units(1), [
    { id: "b", units: units(500000), createdAt: "2026-01-02T00:00:00Z" },
    { id: "a", units: units(500000), createdAt: "2026-01-01T20:00:00-04:00" },
  ])), { b: "0", a: "1" });
});

test("one cent is preserved at both Work and Task levels", () => {
  const rows = [work("first", units(500000), [task("old", "one", units(500000)), task("new", "two", units(500000), newer)]), work("second", units(500000), [task("other", "two", STAGE_SHARE_UNITS)], newer)];
  const allocation = distributeStageFund({ amount: "0.01", bynAmount: "0.03", projectAmount: "0.01" }, rows);
  assert.deepEqual(allocation.works.map((row) => [row.amount, row.bynAmount, row.projectAmount]), [["0.01", "0.02", "0.01"], ["0.00", "0.01", "0.00"]]);
  assert.deepEqual(allocation.works[0].tasks.map((row) => [row.amount, row.bynAmount, row.projectAmount]), [["0.01", "0.01", "0.01"], ["0.00", "0.01", "0.00"]]);
  assert.deepEqual(allocation.beneficiaries.map((row) => [row.userId, row.amount, row.bynAmount]), [["one", "0.01", "0.01"], ["two", "0.00", "0.02"]]);
});

test("zero work weights and zero task shares keep rows but never receive residual cents", () => {
  const rows = [work("zero-work", units(0), [task("zero-work-task", "zero", STAGE_SHARE_UNITS)]),
    work("paid-work", STAGE_SHARE_UNITS, [task("zero-share", "zero", units(0)), task("paid-task", "paid", STAGE_SHARE_UNITS, newer)], newer)];
  const result = distributeStageFund({ amount: "0.01", bynAmount: "0.01", projectAmount: "0.01" }, rows);
  assert.deepEqual(result.works.map((row) => row.amount), ["0.00", "0.01"]);
  assert.deepEqual(result.works[1].tasks.map((row) => row.amount), ["0.00", "0.01"]);
  assert.deepEqual(beneficiaryAmounts(result), { paid: "0.01", zero: "0.00" });
});

test("both distributions must be complete even when the fund or Work weight is zero", () => {
  const zero = { amount: "0", bynAmount: "0", projectAmount: "0" };
  assert.throws(() => distributeStageFund(zero, []));
  assert.throws(() => distributeStageFund(zero, [work("w", units(999999), [task("t", "u", STAGE_SHARE_UNITS)])]), { code: "WEIGHT_SUM_INVALID" });
  assert.throws(() => distributeStageFund(zero, [work("w", STAGE_SHARE_UNITS, [])]));
  assert.throws(() => distributeStageFund(zero, [work("z", units(0), [task("t", "u", units(999999))]), work("w", STAGE_SHARE_UNITS, [task("t2", "u", STAGE_SHARE_UNITS)])]), { code: "WEIGHT_SUM_INVALID" });
});

test("negative/oversized units, duplicate IDs, invalid dates and negative totals fail", () => {
  for (const invalid of [units(-1), units(1000001), 0.5 as unknown as bigint]) assert.throws(() => allocateStageMinorUnits(units(1), [{ id: "a", units: invalid, createdAt: older }]));
  assert.throws(() => allocateStageMinorUnits(units(1), [{ id: "a", units: units(500000), createdAt: older }, { id: "a", units: units(500000), createdAt: newer }]));
  assert.throws(() => allocateStageMinorUnits(units(1), [{ id: "a", units: STAGE_SHARE_UNITS, createdAt: "not-a-date" }]));
  assert.throws(() => allocateStageMinorUnits(units(-1), [{ id: "a", units: STAGE_SHARE_UNITS, createdAt: older }]));
  assert.throws(() => distributeStageFund({ amount: "0.01", bynAmount: "0.01", projectAmount: "0.01" }, [work("w1", units(500000), [task("same", "u", STAGE_SHARE_UNITS)]), work("w2", units(500000), [task("same", "u", STAGE_SHARE_UNITS)])]));
});

test("physical quantities 2/3 and finance 80/20 remain independent through a half split", () => {
  const legacy = Object.freeze({ quantity: "2.00", physicalUnits: STAGE_SHARE_UNITS, financialUnits: units(800000), oldShareAmount: "123.45" });
  const parts = splitStageShareVectors({ quantityShareUnits: legacy.physicalUnits, stageShareUnits: legacy.financialUnits, percent: "50" });
  assert.deepEqual(parts, { remainingQuantityShareUnits: units(500000), transferredQuantityShareUnits: units(500000), remainingStageShareUnits: units(400000), transferredStageShareUnits: units(400000) });
  assert.deepEqual([physicalStageQuantity(legacy.quantity, parts.remainingQuantityShareUnits), physicalStageQuantity(legacy.quantity, parts.transferredQuantityShareUnits), physicalStageQuantity("3", STAGE_SHARE_UNITS)], ["1", "1", "3"]);
  const allocation = distributeStageFund(calculateStageFund(base), [work("one-work", STAGE_SHARE_UNITS, [task("source", "original", parts.remainingStageShareUnits), task("child", "new", parts.transferredStageShareUnits), task("historical-other", "original", units(200000))])]);
  assert.deepEqual(allocation.works[0].tasks.map((row) => row.amount), ["200.00", "200.00", "100.00"]);
  assert.equal(legacy.oldShareAmount, "123.45");
  assert.equal(legacy.quantity, "2.00");
});

test("repeated split floors each vector independently and keeps the residual at its source", () => {
  const first = splitStageShareVectors({ quantityShareUnits: units(333333), stageShareUnits: units(200001), percent: "50" });
  assert.deepEqual(first, { remainingQuantityShareUnits: units(166667), transferredQuantityShareUnits: units(166666), remainingStageShareUnits: units(100001), transferredStageShareUnits: units(100000) });
  const next = splitStageShareVectors({ quantityShareUnits: first.remainingQuantityShareUnits, stageShareUnits: first.remainingStageShareUnits, percent: "50" });
  assert.equal(next.remainingQuantityShareUnits + next.transferredQuantityShareUnits + first.transferredQuantityShareUnits, units(333333));
  assert.equal(next.remainingStageShareUnits + next.transferredStageShareUnits + first.transferredStageShareUnits, units(200001));
  assert.equal(next.remainingStageShareUnits, units(50001));
});

test("stage share zero splits to zero/zero while the physical vector still splits", () => {
  assert.deepEqual(splitStageShareVectors({ quantityShareUnits: STAGE_SHARE_UNITS, stageShareUnits: units(0), percent: "50" }), {
    remainingQuantityShareUnits: units(500000), transferredQuantityShareUnits: units(500000), remainingStageShareUnits: units(0), transferredStageShareUnits: units(0),
  });
});

test("a positive vector cannot transfer zero units; 0.01% of a full vector is valid", () => {
  assert.throws(() => splitStageShareVectors({ quantityShareUnits: STAGE_SHARE_UNITS, stageShareUnits: units(1), percent: "50" }), { code: "STAGE_TRANSFER_TOO_SMALL" });
  assert.throws(() => splitStageShareVectors({ quantityShareUnits: units(1), stageShareUnits: STAGE_SHARE_UNITS, percent: "50" }), { code: "PHYSICAL_TRANSFER_TOO_SMALL" });
  assert.equal(splitStageShareVectors({ quantityShareUnits: STAGE_SHARE_UNITS, stageShareUnits: STAGE_SHARE_UNITS, percent: "0.01" }).transferredStageShareUnits, units(100));
  for (const percent of ["0", "100", "0.001", "NaN"]) assert.throws(() => splitStageShareVectors({ quantityShareUnits: STAGE_SHARE_UNITS, stageShareUnits: STAGE_SHARE_UNITS, percent }));
});

test("physical quantity retains eight decimals and respects NUMERIC(10,2) source bounds", () => {
  assert.equal(physicalStageQuantity("0.01", units(1)), "0.00000001");
  assert.equal(physicalStageQuantity("99999999.99", STAGE_SHARE_UNITS), "99999999.99");
  for (const quantity of ["0", "-1", "0.001", "100000000.00"]) assert.throws(() => physicalStageQuantity(quantity, STAGE_SHARE_UNITS));
});

test("role/payScheme and old quantity or money metadata do not influence engineering pay", () => {
  const works = splitWorks();
  const tagged = works.map((row) => ({ ...row, priceSnapshot: "9999", quantity: "80", tasks: row.tasks.map((entry) => ({ ...entry, roles: ["WORKER"], payScheme: "NONE", executorShare: "0.123", quantity: "999", shareAmount: "1.00" })) }));
  assert.deepEqual(distributeStageFund(calculateStageFund(base), tagged), distributeStageFund(calculateStageFund(base), works));
});

test("independent project equivalents preserve settlement cents when rounded payout is zero", () => {
  const fund = calculateStageFund({ ...base, price: "0.02", ratePercent: "100", payrollCurrency: "USD", payrollRateByn: "3" });
  const result = distributeStageFund(fund, [work("a", units(500000), [task("a-task", "a-user", STAGE_SHARE_UNITS)]), work("b", units(500000), [task("b-task", "b-user", STAGE_SHARE_UNITS)], newer)]);
  assert.deepEqual(fund, { sourceFundExact: "0.020000", amount: "0.01", bynAmount: "0.03", projectAmount: "0.03" });
  assert.deepEqual(result.works.map((row) => [row.amount, row.bynAmount, row.projectAmount]), [["0.01", "0.02", "0.02"], ["0.00", "0.01", "0.01"]]);
  assert.equal(result.works.filter((row) => row.amount !== "0.00").map((row) => row.projectAmount).join(), "0.02");
  assert.equal(fund.projectAmount, "0.03"); // будущая экономика не должна потерять вторую долю
});

test("all minor-unit totals survive both levels and beneficiary grouping across small residuals", () => {
  const money = (minor: bigint) => `${minor / units(100)}.${(minor % units(100)).toString().padStart(2, "0")}`;
  const cents = (value: string) => BigInt(value.replace(".", ""));
  const rows = [
    work("a", units(500001), [task("a1", "one", units(1)), task("a2", "two", units(499999)), task("a3", "one", units(500000), newer)]),
    work("b", units(333333), [task("b0", "zero", units(0)), task("b1", "two", units(300000)), task("b2", "one", units(700000))]),
    work("c", units(166666), [task("c1", "three", STAGE_SHARE_UNITS)]),
  ];
  const original = structuredClone(rows);
  for (let minor = units(0); minor <= units(100); minor += units(1)) {
    const totals = { amount: money(minor), bynAmount: money(minor * units(3)), projectAmount: money(minor * units(2)) };
    const result = distributeStageFund(totals, rows);
    for (const key of ["amount", "bynAmount", "projectAmount"] as const) {
      assert.equal(result.works.reduce((sum, row) => sum + cents(row[key]), units(0)), cents(totals[key]));
      assert.equal(result.beneficiaries.reduce((sum, row) => sum + cents(row[key]), units(0)), cents(totals[key]));
      for (const row of result.works) assert.equal(row.tasks.reduce((sum, part) => sum + cents(part[key]), units(0)), cents(row[key]));
    }
    assert.equal(result.works[1].tasks[0].amount, "0.00");
  }
  assert.deepEqual(rows, original);
});
