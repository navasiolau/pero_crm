import assert from "node:assert/strict";
import { test } from "node:test";
import { taskPaymentLabel, workPaymentAmountLabel, workPaymentSourceLabel } from "../src/lib/task-payment-display";

// Источник: product-engineering-display.test.ts
test("canonical unavailable reward never falls back to engineering preview or frozen compatibility fields", () => {
  for (const rewardAmount of [null, undefined]) {
    assert.equal(taskPaymentLabel({workId:"work",paymentKind:"ENGINEERING",rewardAmount,rewardCurrency:"BYN",rewardSource:"UNAVAILABLE",shareAmount:"999",shareCurrency:"USD",previewAmount:"150",previewCurrency:"BYN",settledSource:true}),"—");
  }
});
test("canonical frozen reward including zero remains exact and ignores unrelated preview", () => {
  for (const rewardAmount of ["0.00", "17.89"]) {
    assert.equal(taskPaymentLabel({workId:"work",paymentKind:"ENGINEERING",rewardAmount,rewardCurrency:"BYN",rewardSource:"FROZEN_TASK_SNAPSHOT",previewAmount:"999",previewCurrency:"USD",shareAmount:"888",shareCurrency:"USD"}), taskPaymentLabel({workId:"work",rewardAmount,rewardCurrency:"BYN",rewardSource:"FROZEN_TASK_SNAPSHOT"}));
  }
});
test("unknown FX and legacy preview reason are not a Task reward projection", () => {
  assert.equal(taskPaymentLabel({workId:"work",paymentKind:"ENGINEERING",rewardAmount:null,rewardCurrency:null,rewardSource:"UNAVAILABLE",previewAmount:null,previewReason:"Курс недоступен",shareAmount:"999",shareCurrency:"BYN"}),"—");
});
test("task money comes only from server reward DTO, with no unfunded-task label", () => {
  assert.match(taskPaymentLabel({ workId: "work", rewardAmount: "70", rewardCurrency: "BYN", rewardSource: "WORK_SNAPSHOT", shareAmount: "999", shareCurrency: "USD" }), /70.*BYN/);
  assert.equal(taskPaymentLabel({ workId: null }), "—");
});
test("task without server monetary projection does not invent an installation reward", () => {
  assert.equal(taskPaymentLabel({ workId: "install-work", paymentKind: "INSTALLATION", shareAmount: "999", shareCurrency: "USD" }), "—");
});
test("installation work source does not show a separate work or task budget", () => {
  const work = { paymentKind: "INSTALLATION" as const, priceSnapshot: "999.00", total: "999.00", quantity: "4" };
  assert.equal(workPaymentSourceLabel(work), "Монтаж — процент от изделия");
  assert.equal(workPaymentAmountLabel(work), "Источник оплаты: процентный этап изделия");
  assert.doesNotMatch(workPaymentSourceLabel(work) + workPaymentAmountLabel(work), /999|BYN|×/);
});

test("zero assigned-work reward remains real BYN money and stale share fields cannot override it", () => {
 const value = taskPaymentLabel({workId:"w",rewardAmount:"0.00",rewardCurrency:"BYN",rewardSource:"WORK_SNAPSHOT",shareAmount:"999",shareCurrency:"USD"});
 assert.match(value,/0.*BYN/);assert.doesNotMatch(value,/999|USD|дол|процент|Без денежного/i);
 assert.equal(taskPaymentLabel({workId:"w",shareAmount:"999",shareCurrency:"BYN"}),"—");
});
