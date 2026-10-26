import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { projectProposalPricing, resolveProposalRate } from "../src/server/kp/pricing";
import { projectTotalText } from "../src/lib/product-quantity";

const byn = { currency: "BYN", value: "1", date: "2026-10-18", source: "NBRB" as const };
const usd = { currency: "USD", value: "3.25", date: "2026-10-18", source: "MANUAL" as const };

test("скидка распределяется между ценами единицы и общими услугами при количестве больше одного", () => {
  const result = projectProposalPricing({ currency: "$", items: [{ id: "a", price: "100", qty: 3 }, { id: "b", price: "50", qty: 2 }],
    delivery: { mode: "total", total: "40" }, discount: "10", discountMode: "percent" }, usd);
  assert.equal(result.project.initialPrice.toFixed(2), "1430.00");
  assert.deepEqual(result.items.map(item => [item.id, item.quantity, item.initialPrice.toFixed(2), item.expectedPrice.toFixed(2)]),
    [["a", 3, "325.00", "292.50"], ["b", 2, "162.50", "146.25"]]);
  assert.equal(result.project.servicesTotal?.toFixed(2), "117.00");
  assert.equal(result.project.delivery, null);
  assert.equal(result.project.unloading, null);
  assert.equal(result.project.installation, null);
  assert.equal(result.project.proposalRoundingAdjustment.toFixed(2), "0.00");
  assert.equal(projectTotalText(result.items, result.project), "1287.00");
  assert.equal(result.source.total.toFixed(2), "396.00");
});

test("абсолютная скидка и округление единицы компенсируются в обе стороны до копейки", () => {
  for (const [discount, unit, total, adjustment] of [["0.01", "1.00", "2.99", "-0.01"], ["0.02", "0.99", "2.98", "0.01"]]) {
    const result = projectProposalPricing({ currency: "BYN", items: [{ id: "a", price: "1", qty: 3 }],
      delivery: { visible: false }, discountMode: "amount", discount }, byn);
    assert.equal(result.items[0].expectedPrice.toFixed(2), unit);
    assert.equal(result.project.proposalRoundingAdjustment.toFixed(2), adjustment);
    assert.equal(projectTotalText(result.items, result.project), total);
    assert.equal(result.items[0].initialPrice.toFixed(2), "1.00");
  }
});

test("дробный валютный курс округляется после пересчёта единицы без изменения общего Decimal-контекста", () => {
  const precision = Prisma.Decimal.precision;
  for (const [currency, fx, quantity, unit, total, adjustment] of [
    ["RUB", "0.0333333333", 3, "0.03", "0.10", "0.01"],
    ["EUR", "3.005", 2, "3.01", "6.01", "-0.01"],
  ] as const) {
    const result = projectProposalPricing({ currency, items: [{ id: "a", price: "1", qty: quantity }], delivery: { visible: false } }, { ...byn, currency, value: fx });
    assert.equal(result.items[0].initialPrice.toFixed(2), unit);
    assert.equal(result.items[0].expectedPrice.toFixed(2), unit);
    assert.equal(result.project.initialPrice.toFixed(2), total);
    assert.equal(projectTotalText(result.items, result.project), total);
    assert.equal(result.project.proposalRoundingAdjustment.toFixed(2), adjustment);
  }
  assert.equal(Prisma.Decimal.precision, precision);
});

test("печатные пограничные суммы исходного генератора сохраняются до Decimal-пересчёта", () => {
  const raw = { currency: "BYN", items: [{ id: "a", price: "10.075", qty: 1 }], delivery: { visible: false } };
  const normalized = projectProposalPricing(raw, byn);
  assert.equal(normalized.items[0].initialPrice.toFixed(2), "10.07");
  assert.equal(normalized.source.total.toFixed(2), "10.07");
  assert.equal(raw.items[0].price, "10.075");
  const source = { currency: "USD", items: [{ id: "a", price: "100.75", qty: 1 }], discount: 10, delivery: { visible: false } };
  const result = projectProposalPricing(source, usd);
  assert.equal(result.source.base.toFixed(2), "100.75");
  assert.equal(result.source.discount.toFixed(2), "10.07");
  assert.equal(result.source.total.toFixed(2), "90.68");
  assert.equal(result.items[0].expectedPrice.toFixed(2), "294.71");
  assert.equal(projectTotalText(result.items, result.project), "294.71");
});

test("разбивка использует явные категории, суммирует одинаковые категории и сохраняет подписи", () => {
  const state = { currency: "BYN", items: [{ id: "a", price: 100 }], discount: 20,
    delivery: { mode: "items", items: [
      { name: "Произвольная подпись", crmKind: "DELIVERY", price: 10 },
      { name: "Никакого угадывания", crmKind: "DELIVERY", price: 20 },
      { name: "Другой текст", crmKind: "INSTALLATION", price: 50 },
    ] } };
  const before = structuredClone(state);
  const result = projectProposalPricing(state, byn);
  assert.equal(result.project.servicesTotal, null);
  assert.equal(result.project.delivery?.toFixed(2), "24.00");
  assert.equal(result.project.installation?.toFixed(2), "40.00");
  assert.equal(result.project.unloading?.toFixed(2), "0.00");
  assert.equal(projectTotalText(result.items, result.project), "144.00");
  assert.deepEqual(state, before);
  for (const row of [{ name: "Никакого угадывания", price: 20 }, { name: "Никакого угадывания", price: 20, crmKind: "OTHER" }]) {
    const partial = projectProposalPricing({ ...state, delivery: { ...state.delivery,
      items: [state.delivery.items[0], row, state.delivery.items[2]] } }, byn);
    assert.equal(partial.project.servicesTotal?.toFixed(2), "64.00");
    assert.deepEqual([partial.project.delivery, partial.project.unloading, partial.project.installation], [null, null, null]);
    assert.equal(projectTotalText(partial.items, partial.project), "144.00");
  }
});

test("импортированные услуги без категорий сохраняются общей суммой со скидкой и валютным курсом", () => {
  const state = { currency: "$", items: [{ id: "a", price: 100, qty: 2 }], discount: 10, discountMode: "percent",
    delivery: { mode: "items", items: [{ name: "Доставка", price: 135 }, { name: "Монтаж", price: 1230 }] } };
  const before = structuredClone(state), result = projectProposalPricing(state, usd);
  assert.equal(result.project.initialPrice.toFixed(2), "5086.25");
  assert.equal(result.project.servicesTotal?.toFixed(2), "3992.63");
  assert.deepEqual([result.project.delivery, result.project.unloading, result.project.installation], [null, null, null]);
  assert.equal(result.source.services.toFixed(2), "1365.00");
  assert.equal(result.source.discount.toFixed(2), "156.50");
  assert.equal(result.source.total.toFixed(2), "1408.50");
  assert.equal(projectTotalText(result.items, result.project), "4577.63");
  assert.equal(result.project.proposalRoundingAdjustment.toFixed(2), "0.00");
  assert.deepEqual(state, before);
});

test("нормализация сохраняет правила генератора для копеек, десятичной запятой и количества", () => {
  const result = projectProposalPricing({ currency: "BYN", items: [{ id: "a", price: "100,005", qty: 2.4 }, { id: "b", price: -10, qty: 0 }],
    delivery: { total: "10,005" }, discountMode: "amount", discount: "20" }, byn);
  assert.equal(result.items[0].initialPrice.toFixed(2), "100.01");
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.items[1].quantity, 1);
  assert.equal(result.items[1].initialPrice.toFixed(2), "0.00");
  assert.equal(result.source.base.toFixed(2), "210.03");
  assert.equal(projectTotalText(result.items, result.project), "190.03");
});

test("нулевая база, выключенные услуги и предел скидки не создают стоимость", () => {
  const zero = projectProposalPricing({ currency: "BYN", items: [{ id: "a" }], discount: 500,
    delivery: { visible: false, total: "100", mode: "items", items: [{ price: 100 }] } }, byn);
  assert.equal(zero.source.base.toFixed(2), "0.00");
  assert.equal(zero.source.discount.toFixed(2), "0.00");
  assert.equal(zero.project.servicesTotal, null);
  assert.equal(projectTotalText(zero.items, zero.project), "0.00");
  for (const mode of ["percent", "amount"]) {
    const result = projectProposalPricing({ currency: "BYN", items: [{ id: "a", price: "0.01", qty: 3 }], discountMode: mode, discount: 500 }, byn);
    assert.equal(result.source.discount.toFixed(2), "0.03");
    assert.equal(projectTotalText(result.items, result.project), "0.00");
  }
});

test("курс соответствует валюте, календарной дате и возможностям БД", () => {
  for (const currency of ["USD", "$", "RUB", "₽", "EUR", "€", "BYN"]) {
    const canonical = currency === "$" ? "USD" : currency === "₽" ? "RUB" : currency === "€" ? "EUR" : currency;
    assert.equal(projectProposalPricing({ currency, items: [] }, { ...byn, currency: canonical }).rate.currency, canonical);
  }
  const state = { currency: "USD", items: [{ id: "a", price: 10 }] };
  for (const rate of [{ ...usd, currency: "RUB" }, { ...usd, value: "0" }, { ...usd, value: "-1" },
    { ...usd, value: "NaN" }, { ...usd, value: "0.12345678901" }, { ...usd, date: "2026-02-30" }, { ...usd, date: "2026-13-01" }, { ...usd, source: "OTHER" }, { ...usd, currency: "" }]) {
    assert.throws(() => projectProposalPricing(state, rate));
  }
  assert.throws(() => projectProposalPricing({ currency: "BYN", items: [] }, { ...byn, value: "2" }));
  assert.throws(() => projectProposalPricing({ currency: "BYN", items: [{ id: "a", price: "10000000000" }] }, byn), /предел/);
  assert.throws(() => projectProposalPricing({ currency: "BYN", items: [{ id: "a", price: 1, qty: 2147483648 }] }, byn));
  assert.throws(() => projectProposalPricing({ currency: "BYN", items: [{ id: "a", price: 1 }, { id: "a", price: 2 }] }, byn));
});

test("курс на дату КП запрашивается только при подготовке нового снимка", async () => {
  const calls: [string, string][] = [];
  const fetchRate = async (currency: string, date: string) => { calls.push([currency, date]); return { rate: "3.25", date }; };
  const initial = await resolveProposalRate({ currency: "$", quoteDate: "2026-10-18" }, fetchRate);
  assert.equal(initial.value.toFixed(2), "3.25");
  const repeat = await resolveProposalRate({ currency: "USD", quoteDate: "2026-11-01", existing: initial }, fetchRate);
  assert.equal(repeat.date, "2026-10-18");
  assert.deepEqual(calls, [["USD", "2026-10-18"]]);
  await assert.rejects(resolveProposalRate({ currency: "RUB", quoteDate: "2026-10-18", existing: initial }, fetchRate));
  assert.equal(calls.length, 1);
  const manual = await resolveProposalRate({ currency: "EUR", quoteDate: "2026-10-18", manual: { currency: "EUR", value: "3.70", date: "2026-10-17", source: "MANUAL" } }, fetchRate);
  assert.equal(manual.source, "MANUAL");
  assert.equal(calls.length, 1);
  assert.ok(manual.value instanceof Prisma.Decimal);
  await assert.rejects(resolveProposalRate({ currency: "EUR", quoteDate: "2026-10-18", manual: { ...manual, source: "NBRB" } }, fetchRate));
  await assert.rejects(resolveProposalRate({ currency: "EUR", quoteDate: "2026-10-18" }, async () => ({ rate: "3", date: "2026-10-17" })));
});
