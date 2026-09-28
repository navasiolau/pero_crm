import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateStageFund } from "../src/lib/product-stage-pay";
import { assertStageQuoteCurrent, resolveStageRates } from "../src/server/product-stage-pay/quote";

const now = new Date("2026-09-28T12:00:00.000Z");

test("1000 USD at 5 percent and rate 3 produces exactly 150 BYN", async () => {
  const calls: string[] = [];
  const quote = await resolveStageRates("USD", "BYN", now, async (currency, date) => {
    calls.push(currency); assert.equal(date?.toISOString().slice(0, 10), "2026-09-28");
    return { rate: 3, date: "2026-09-28" };
  });
  assert.deepEqual(calls, ["USD"]);
  assert.deepEqual(quote.payroll, { currency: "BYN", rate: "1.000000", date: "2026-09-28" });
  const fund = calculateStageFund({ price: "1000.00", ratePercent: "5.00", productCurrency: "USD", payrollCurrency: "BYN", productRateByn: quote.product.rate, payrollRateByn: quote.payroll.rate });
  assert.deepEqual(fund, { sourceFundExact: "50.000000", amount: "150.00", bynAmount: "150.00", projectAmount: "50.00" });
});

test("same foreign currency is fetched once and BYN never requires a network call", async () => {
  let calls = 0;
  const read = async () => { calls++; return { rate: 3.123456, date: "2026-09-28" }; };
  const quote = await resolveStageRates("USD", "USD", now, read);
  assert.equal(calls, 1);
  assert.deepEqual(quote.product, quote.payroll);
  await resolveStageRates("BYN", "BYN", now, read);
  assert.equal(calls, 1);
});

test("unsupported currency is rejected before any provider call", async () => {
  let calls = 0;
  await assert.rejects(resolveStageRates("GBP", "BYN", now, async () => { calls++; return { rate: 3, date: "2026-09-28" }; }), /валют/);
  assert.equal(calls, 0);
});

test("missing, zero, non-finite, overprecision and overflowing rates are rejected", async () => {
  for (const rate of [undefined, null, 0, -1, NaN, Infinity, 0.1234567, 1e12]) {
    await assert.rejects(resolveStageRates("USD", "BYN", now, async () => ({ rate: rate as number, date: "2026-09-28" })), /курс/i, String(rate));
  }
});

test("invalid or future rate dates are rejected without replacing currencies", async () => {
  for (const date of ["", "2026-02-30", "2026-09-29", "2026-09-28T00:00:00"])
    await assert.rejects(resolveStageRates("USD", "BYN", now, async () => ({ rate: 3, date })), /дат/i, date);
});

test("provider timeout fails the entire quote, without amount or BYN fallback", async () => {
  await assert.rejects(resolveStageRates("USD", "EUR", now, async (currency) => {
    if (currency === "EUR") throw new Error("timeout");
    return { rate: 3, date: "2026-09-28" };
  }), /получить курс/i);
});

test("quote validity checks both currencies and quote day before transaction writes", async () => {
  const quote = await resolveStageRates("USD", "BYN", now, async () => ({ rate: 3, date: "2026-09-28" }));
  assert.doesNotThrow(() => assertStageQuoteCurrent(quote, "USD", "BYN", now));
  assert.throws(() => assertStageQuoteCurrent(quote, "EUR", "BYN", now), /обнов|валют/i);
  assert.throws(() => assertStageQuoteCurrent(quote, "USD", "RUB", now), /обнов|валют/i);
  assert.throws(() => assertStageQuoteCurrent(quote, "USD", "BYN", new Date("2026-09-29T00:00:00Z")), /обнов|дат/i);
});

test("changed malformed quote rates cannot enter settlement calculations", async () => {
  const quote = await resolveStageRates("USD", "BYN", now, async () => ({ rate: 3, date: "2026-09-28" }));
  assert.throws(() => assertStageQuoteCurrent({ ...quote, payroll: { ...quote.payroll, rate: "2.000000" } }, "USD", "BYN", now), /курс/i);
  assert.throws(() => assertStageQuoteCurrent({ ...quote, product: { ...quote.product, rate: "0.000000" } }, "USD", "BYN", now), /курс/i);
});
