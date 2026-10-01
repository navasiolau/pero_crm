import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { EngineeringFundView } from "../src/lib/engineering-fund-view";
import { EngineeringFund, EngineeringFundSummary, conversionRequestKey, initialConversionTaskPercents, parseFullStageMapping, parseFundRate } from "../src/components/engineering-fund";
import { createRequestId } from "../src/lib/request-id";

function view(changes: Partial<EngineeringFundView> = {}): EngineeringFundView {
  return { productId: "p", poolId: "pool", revision: 2, productStatus: "DESIGN", state: "DRAFT", primaryEngineerId: "u",
    priceBasis: "1000.00", productCurrency: "BYN", ratePercent: null, amount: null, currency: "BYN", previewReason: "Ставка не задана",
    closedAt: null, canClose: false, works: [], candidates: [], ...changes };
}

test("SSR summary distinguishes unset, zero, paid and legacy-protected states", () => {
  const render = (data: EngineeringFundView) => renderToStaticMarkup(React.createElement(EngineeringFundSummary, { view: data }));
  assert.match(render(view()), /Ставка не задана/);
  assert.match(render(view({ ratePercent: "0.00", amount: "0.00" })), /≈ 0.00 BYN/);
  assert.match(render(view({ state: "SETTLED", ratePercent: "5.00", amount: "50.00", closedAt: "2026-09-28T12:00:00Z" })), /Начислено.*50.00 BYN/);
  const legacy = render(view({ state: "LEGACY_PROTECTED", amount: null, currency: null }));
  assert.match(legacy, /историческим начислением/);
  assert.doesNotMatch(legacy, /≈|Начислено.*\d/);
});

test("mapping requires exact membership and 100 percent; accepts explicit zero without normalization", () => {
  assert.deepEqual(parseFullStageMapping([], {}), []);
  assert.deepEqual(parseFullStageMapping(["a", "b"], { a: "0", b: "100" }), [{ id: "a", units: 0 }, { id: "b", units: 1_000_000 }]);
  assert.throws(() => parseFullStageMapping(["a", "b"], { a: "80", b: "10" }), /100/);
  assert.throws(() => parseFullStageMapping(["a", "b"], { a: "100" }), /всех/);
  assert.throws(() => parseFullStageMapping(["a"], { a: "100", foreign: "0" }), /всех/);
});

test("single conversion task defaults to 100 but multiple tasks require explicit financial mapping", () => {
  assert.deepEqual(initialConversionTaskPercents([{ id: "one" }]), { one: "100" });
  assert.deepEqual(initialConversionTaskPercents([{ id: "one" }, { id: "two" }]), { one: "", two: "" });
});

test("fund rate accepts unset and explicit zero, and refuses a third decimal", () => {
  assert.equal(parseFundRate(""), null);
  assert.equal(parseFundRate("0"), "0");
  assert.equal(parseFundRate("5,12"), "5.12");
  assert.throws(() => parseFundRate("5.123"), /двух/);
});

test("conversion idempotency key is stable for identical mapping and changes with revisions or shares", () => {
  const payload = { productId: "p", poolId: "pool", workId: "w", expectedPoolRevision: 2,
    poolWeights: [{ workId: "w", units: 200_000 }, { workId: "other", units: 800_000 }],
    taskShares: [{ taskId: "t", units: 1_000_000, expectedRevision: 0 }] };
  const key = conversionRequestKey(payload);
  assert.equal(conversionRequestKey({ ...payload, poolWeights: [...payload.poolWeights].reverse() }), key);
  assert.notEqual(conversionRequestKey({ ...payload, expectedPoolRevision: 3 }), key);
  assert.notEqual(conversionRequestKey({ ...payload, taskShares: [{ ...payload.taskShares[0], units: 0 }] }), key);
});

test("request id falls back to cryptographic random bytes when randomUUID is unavailable", () => {
  const random = { randomUUID: undefined, getRandomValues: (bytes: Uint8Array) => { bytes.set(Array.from({ length: 16 }, (_, i) => i)); return bytes; } };
  assert.match(createRequestId(random), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("full component is read-only for non-manager, paid and non-design products", () => {
  // tsx's test transform uses classic JSX for existing UI primitives that rely on Next's injected React runtime.
  const runtime = globalThis as typeof globalThis & { React?: typeof React };
  const previous = runtime.React;
  runtime.React = React;
  const render = (data: EngineeringFundView, canManage: boolean) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider,
    { value: { refresh() {} } as never }, React.createElement(EngineeringFund, { view: data, canManage, workers: [] })));
  try {
    assert.doesNotMatch(render(view({ state: "DRAFT" }), false), /Сохранить ставку|Добавить инженерную работу/);
    assert.doesNotMatch(render(view({ state: "SETTLED", amount: "1.00" }), true), /Сохранить ставку|Добавить инженерную работу/);
    assert.doesNotMatch(render(view({ productStatus: "PRODUCTION" }), true), /Сохранить ставку|Добавить инженерную работу/);
    const editable = render(view(), true);
    assert.match(editable, /Сохранить ставку|Включить фонд/);
    assert.match(editable, /min-h-12/);
    assert.match(editable, /min-w-0/);
    assert.match(editable, /Тип задачи:.*Проектирование/);
  } finally { runtime.React = previous; }
});

test("read-only work summary labels physical quantity separately from payment share", () => {
  const data = view({ works: [{ id: "w", title: "Чертежи", quantity: "5.00", weightUnits: 1_000_000, amount: "50.00",
    tasks: [{ id: "t", title: "Эскиз", status: "DONE", assigneeId: "u", assigneeName: "Инженер", quantity: "2.00", units: 800_000,
      revision: 0, amount: "40.00" }] }] });
  const runtime = globalThis as typeof globalThis & { React?: typeof React };
  const previous = runtime.React;
  runtime.React = React;
  try {
    const html = renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: { refresh() {} } as never },
      React.createElement(EngineeringFund, { view: data, canManage: false, workers: [] })));
    assert.match(html, /Физический объём задачи:.*2.00/);
    assert.match(html, /Финансовая доля задачи в работе:.*80%/);
    assert.match(html, /≈ 40.00 BYN/);
  } finally { runtime.React = previous; }
});
