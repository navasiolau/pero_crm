import assert from "node:assert/strict";
import { test } from "node:test";
import { taskPaymentLabel } from "../src/lib/task-payment-display";

test("engineering preview uses its currency and does not display the old piece snapshot", () => {
  const label = taskPaymentLabel({ workId: "work", paymentKind: "ENGINEERING", shareAmount: "999", shareCurrency: "USD", previewAmount: "150", previewCurrency: "BYN", settledSource: false });
  assert.match(label, /^≈.*150.*BYN/); assert.doesNotMatch(label, /999|USD/);
});
test("a settled zero is money, not an absent preview", () => {
  const label = taskPaymentLabel({ workId: "work", paymentKind: "ENGINEERING", previewAmount: "0.00", previewCurrency: "BYN", settledSource: true });
  assert.match(label, /0.*BYN/); assert.doesNotMatch(label, /≈|не задан/);
});
test("missing FX shows a reason without inventing a zero or fixed piece amount", () => {
  assert.equal(taskPaymentLabel({ workId: "work", paymentKind: "ENGINEERING", shareAmount: "999", shareCurrency: "BYN", previewAmount: null, previewReason: "Курс недоступен" }), "Курс недоступен");
});
test("ordinary work and unfunded tasks retain their existing display", () => {
  assert.match(taskPaymentLabel({ workId: "work", shareAmount: "70", shareCurrency: "BYN" }), /70.*BYN/);
  assert.equal(taskPaymentLabel({ workId: null }), "Без денежного начисления");
});
