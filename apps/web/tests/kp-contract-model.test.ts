import assert from "node:assert/strict";
import { test } from "node:test";
import { createContractModelPort } from "../src/server/kp/contract-model";
import { ContractWorkflowError } from "../src/server/kp/contract-types";
import { contractSettings } from "./helpers/contract-workflow-fixture";
import { contractFingerprint } from "../src/server/kp/contract-client";

test("нормализация и расчёт делегируются исходной Model без собственных формул", () => {
  const calls: unknown[][] = [];
  const settings = contractSettings(), summary = { totalMinor: 9068, sources: [{ terms: { productionDays: 55 } }], payments: [{ amountMinor: 6348 }, { amountMinor: 2720 }] };
  const model = createContractModelPort({ normalizeSettings: (...args) => { calls.push(args); return settings; }, validate: (...args) => { calls.push(args); return { errors: [], summary }; } });
  assert.deepEqual(model.normalizeSettings({ source: "input" }, { items: [] }, "cp_a"), settings);
  assert.deepEqual(model.validate(settings, [{ id: "cp_a", updatedAt: 0, state: { items: [] } }], [{ id: "pero-by" }]), summary);
  assert.equal(calls.length, 2); assert.equal((calls[1][0] as { payments: unknown }).payments, settings.payments);
});

test("fingerprint стабилен между порядками полей и отклоняет опасный/несовместимый JSON без геттеров", () => {
  assert.equal(contractFingerprint({ b: ["😀", 1], a: "текст" }), contractFingerprint({ a: "текст", b: ["😀", 1] }));
  for (const value of [NaN, Infinity, undefined, BigInt(1), "\u0000", "\ud800", "\udc00", { ["\ud800"]: "x" }, JSON.parse('{"__proto__":{"x":1}}'), new Array(10)]) {
    assert.throws(() => contractFingerprint(value), error => error instanceof ContractWorkflowError && error.status === 400);
  }
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  assert.throws(() => contractFingerprint(cycle));
  let deep: unknown = "x"; for (let index = 0; index < 80; index++) deep = { child: deep };
  assert.throws(() => contractFingerprint(deep));
  let invoked = false;
  const accessor = Object.defineProperty({}, "name", { enumerable: true, get() { invoked = true; return "x"; } });
  assert.throws(() => contractFingerprint(accessor)); assert.equal(invoked, false);
});

test("ошибки проверки заказчика/платежей Model доходят до вызывающего кода, NaN не сохраняется", () => {
  const model = createContractModelPort({ normalizeSettings: () => ({ ...contractSettings(), productionDays: NaN }),
    validate: () => ({ errors: [{ field: "sameCustomerConfirmed", message: "Подтвердите заказчика" }], summary: { totalMinor: 1 } }) });
  assert.throws(() => model.normalizeSettings({}, { items: [] }, "cp_a"), error => error instanceof ContractWorkflowError && error.status === 400);
  assert.throws(() => model.validate(contractSettings(), [], []), /Подтвердите заказчика/);
});
