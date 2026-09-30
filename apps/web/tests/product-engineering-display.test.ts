import assert from "node:assert/strict";
import { test } from "node:test";
import { taskPaymentLabel, workPaymentAmountLabel, workPaymentSourceLabel } from "../src/lib/task-payment-display";

test("engineering preview uses its currency and does not display the old piece snapshot", () => {
  const label = taskPaymentLabel({ workId: "work", paymentKind: "ENGINEERING", shareAmount: "999", shareCurrency: "USD", previewAmount: "150", previewCurrency: "BYN", settledSource: false });
  assert.match(label, /^Прежнее распределение \(история\): ≈.*150.*BYN/); assert.doesNotMatch(label, /999|USD|будет начислено/);
});
test("a settled zero is money, not an absent preview", () => {
  const label = taskPaymentLabel({ workId: "work", paymentKind: "ENGINEERING", previewAmount: "0.00", previewCurrency: "BYN", settledSource: true });
  assert.match(label, /^Начислено ранее: .*0.*BYN/); assert.doesNotMatch(label, /≈|не задан|будет начислено/);
});
test("missing FX shows a reason without inventing a zero or fixed piece amount", () => {
  assert.equal(taskPaymentLabel({ workId: "work", paymentKind: "ENGINEERING", shareAmount: "999", shareCurrency: "BYN", previewAmount: null, previewReason: "Курс недоступен" }), "Прежнее распределение (история): Курс недоступен");
});
test("ordinary work and unfunded tasks retain their existing display", () => {
  assert.match(taskPaymentLabel({ workId: "work", shareAmount: "70", shareCurrency: "BYN" }), /70.*BYN/);
  assert.equal(taskPaymentLabel({ workId: null }), "Без денежного начисления");
});
test("installation tasks identify the product percentage source without showing legacy money", () => {
  assert.equal(taskPaymentLabel({ workId: "install-work", paymentKind: "INSTALLATION", shareAmount: "999", shareCurrency: "USD" }), "Монтаж — процент от изделия");
});
test("installation work source does not show a separate work or task budget", () => {
  const work = { paymentKind: "INSTALLATION" as const, priceSnapshot: "999.00", total: "999.00", quantity: "4" };
  assert.equal(workPaymentSourceLabel(work), "Монтаж — процент от изделия");
  assert.equal(workPaymentAmountLabel(work), "Источник оплаты: процентный этап изделия");
  assert.doesNotMatch(workPaymentSourceLabel(work) + workPaymentAmountLabel(work), /999|BYN|×/);
});
