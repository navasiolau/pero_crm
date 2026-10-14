import assert from "node:assert/strict";
import test from "node:test";
import { calculateStageFund, type StageFundInput } from "../src/lib/product-stage-pay";
const base: StageFundInput = { price: "10000.00", ratePercent: "5.00", productCurrency: "BYN", payrollCurrency: "BYN", productRateByn: "1", payrollRateByn: "1" };

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
});
