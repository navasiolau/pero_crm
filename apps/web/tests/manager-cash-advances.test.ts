import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateCashPayout, calculateOrgBalance, parseCashAmount, parseCashRate } from "../src/lib/cash-ledger";

const today = new Date().toISOString().slice(0, 10);

test("money parsing rejects float artifacts, zero, NaN and excessive precision", () => {
  assert.equal(parseCashAmount("120.00"), "120.00");
  for (const amount of ["0", "-1", "NaN", "Infinity", "1e2", "1.001", "999999999999.99"]) {
    assert.throws(() => parseCashAmount(amount), /сумм|значени|знак|предел/i);
  }
});

test("cash FX snapshot and org balance use saved BYN before current conversion", () => {
  const quote = calculateCashPayout("120.00", { asOf: today, cash: { currency: "USD", rate: "3.000000", date: today }, payroll: { currency: "USD", rate: "3.000000", date: today } });
  assert.deepEqual({ cashAmount: quote.cashAmount, amount: quote.amount, bynAmount: quote.bynAmount }, { cashAmount: "120.00", amount: "120.00", bynAmount: "360.00" });
  assert.equal(calculateOrgBalance("1000.00", "360.00", "0.00", "4.000000"), "160.00");
  assert.equal(calculateOrgBalance("1000.00", "360.00", "20.00", "4.000000"), "140.00");
  assert.equal(calculateOrgBalance("1000.00", "0.00", "120.00", "1.000000"), "880.00");
  assert.equal(calculateOrgBalance("20000000000.00", "360.00", "0.00", "4.000000"), "4999999910.00");
  const fractional = calculateCashPayout("1.01", { asOf: today, cash: { currency: "USD", rate: "2.123456", date: today },
    payroll: { currency: "BYN", rate: "1.000000", date: today } });
  assert.equal(fractional.bynAmount, "2.14");
  assert.equal(fractional.cashRate, "2.123456");
  assert.throws(() => parseCashRate("2.1234567", "USD"), /курс/);
});

test("payroll amount uses unrounded physical FX ratio while BYN snapshot rounds independently", () => {
  const same = calculateCashPayout("0.50", { asOf: today, cash: { currency: "RUB", rate: "0.031000", date: today },
    payroll: { currency: "RUB", rate: "0.031000", date: today } });
  assert.equal(same.amount, "0.50");
  assert.equal(same.bynAmount, "0.02");
  const mixed = calculateCashPayout("0.01", { asOf: today, cash: { currency: "USD", rate: "3.111100", date: today },
    payroll: { currency: "RUB", rate: "0.031000", date: today } });
  assert.equal(mixed.amount, "1.00");
  assert.equal(mixed.bynAmount, "0.03");
  const large = calculateCashPayout("9999999999.99", { asOf: today, cash: { currency: "USD", rate: "3.000000", date: today },
    payroll: { currency: "USD", rate: "3.000000", date: today } });
  assert.equal(large.amount, "9999999999.99");
  assert.equal(large.bynAmount, "29999999999.97");
  const minor = calculateCashPayout("0.01", { asOf: today, cash: { currency: "RUB", rate: "0.031000", date: today },
    payroll: { currency: "RUB", rate: "0.031000", date: today } });
  assert.equal(minor.cashAmount, "0.01");
  assert.equal(minor.amount, "0.01");
  assert.equal(minor.bynAmount, "0.00");
});

test("FX dates reject impossible calendar days and future provider dates", () => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  for (const date of ["2026-02-30", tomorrow]) {
    assert.throws(() => calculateCashPayout("1.00", { asOf: today, cash: { currency: "USD", rate: "3.000000", date },
      payroll: { currency: "BYN", rate: "1.000000", date: today } }), /дат/);
  }
});
