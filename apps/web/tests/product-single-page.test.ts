import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import type { TechnicalSpecifications } from "@pero/kp-template";
import { ProductSinglePage } from "../src/app/(app)/products/[id]/product-overview";
// Rendering must not resolve or invoke Next's browser-only action transport.
const require = createRequire(import.meta.url);
const transportFile = require.resolve("../src/lib/independent-product-action");
const transportStub = new Module(transportFile);
transportStub.filename = transportFile; transportStub.loaded = true;
transportStub.exports = { invokeProductPatch() { throw Error("SSR must never write"); } };
require.cache[transportFile] = transportStub;
(globalThis as unknown as { React: typeof React }).React = React;
const clientActionsFile=require.resolve("../src/server/clients/actions"),clientActionsStub=new Module(clientActionsFile);clientActionsStub.filename=clientActionsFile;clientActionsStub.loaded=true;clientActionsStub.exports={createClient(){throw Error("SSR must never write")},updateClient(){throw Error("SSR must never write")}};require.cache[clientActionsFile]=clientActionsStub;
const { ProductInlineProvider } = require("../src/components/product-inline-provider") as typeof import("../src/components/product-inline-provider");
const { ProductInlineContacts, ProductInlineDetails } = require("../src/components/product-inline-fields") as typeof import("../src/components/product-inline-fields");

const initial = { title: "Шкаф", kind: null, quantity: 3, expectedPrice: "12.50", engineerId: "engineer", description: "Описание", "project.clientId": "client", "project.address": "Адрес", "client.phone": "+375290000000" };
function details(canManage: boolean, canEditTech: boolean, showAmount: boolean, expectedPrice: string | null = initial.expectedPrice, technicalSpecifications?: TechnicalSpecifications, canReadTechnical = true) {
  // eslint-disable-next-line react/no-children-prop -- provider requires children in its typed props
  return renderToStaticMarkup(createElement(ProductInlineProvider, { productId: "product", initial: { ...initial, expectedPrice }, technicalSpecifications, children: createElement(ProductInlineDetails, {
    canManage, canEditTech, canReadTechnical, showAmount, currency: "BYN", notice: createElement("p", null, "Нехватка материалов"),
    measurement: createElement("p", null, "Замер"), engineer: createElement("p", null, "Инженер и процент"),
  }) }));
}
test("техническое описание показывает исходный порядок строк в едином поле без исходного текста", () => {
  const specs: TechnicalSpecifications = {
    sections: [
      { id: "lighting", type: "lighting", group: "lighting", label: "Подсветка", value: "LED" },
      { id: "hardware", type: "hardware", group: "hardware", label: "Фурнитура", value: "" },
      { id: "body", type: "body", group: "construction", label: "Корпус", value: "<script>Дуб</script>" },
    ],
    description: "Модель", size: "1800 мм", note: null, sourceGeneration: 1,
  };
  const html = details(false, false, false, null, specs);
  assert.match(html, /<ol[^>]*>.*Подсветка.*Фурнитура.*Корпус.*<\/ol>/);
  assert.match(html, /&lt;script&gt;Дуб&lt;\/script&gt;/);
  assert.equal((html.match(/<li\b/g) ?? []).length, 3);
  assert.match(html, /Фурнитура/);
  assert.doesNotMatch(html, /1800 мм|Модель|Исходное описание|<details|Добавить раздел|Удалить раздел|<script>|<textarea/);
  assert.equal((details(false, true, false, null, specs).match(/<textarea\b/g) ?? []).length, 8);
  assert.doesNotMatch(details(false, false, false, null, specs, false), /Корпус|Исходное описание|Техническое описание/);
});
test("длинный многострочный материал сохранён целиком и защищён от HTML в редакторе и чтении", () => {
  const value = "Дуб натуральный\n".repeat(500) + "<script>текст</script>";
  const specs: TechnicalSpecifications = { sections: [{ id: "body", type: "body", group: "construction", label: "Корпус", value }], description: null, size: null, note: null, sourceGeneration: 0 };
  for (const editable of [false, true]) {
    const html = details(false, editable, false, null, specs);
    assert.equal((html.match(/Дуб натуральный/g) ?? []).length, 500);
    assert.match(html, /&lt;script&gt;текст&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, editable ? /overflow-hidden/ : /whitespace-pre-wrap/);
    assert.match(html, /overflow-wrap:anywhere/);
  }
});
test("цена, количество и сумма в общей группе перед описанием → замером → инженером", () => {
  const html = details(true, true, true);
  const markers = ["product-inline-price", "product-inline-quantity", "Сумма:", "data-product-technical-specifications", "Замер", "Инженер и процент"];
  const positions = markers.map(marker => html.indexOf(marker));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  const groupStart=html.indexOf("data-product-price-quantity");
  assert.ok(groupStart>=0&&positions.slice(0,3).every(position=>position>groupStart&&position<positions[3]));
  assert.match(html, /Цена, BYN/);
  assert.match(html, /Сумма:\s*37[,.]5 BYN/);
  assert.doesNotMatch(html, /Замерщик|Вид изделия|Первоначальная цена/);
  const reader = details(false, false, false);
  assert.doesNotMatch(reader, /product-inline-price/);
  assert.match(reader, /id="product-inline-quantity"[^>]*readOnly=""/);
  assert.doesNotMatch(reader, /<textarea/);
  assert.match(reader, /data-product-technical-specifications/);
  assert.match(reader, />Описание<\/span>/);
  const engineer = details(false, true, true);
  assert.match(engineer, /id="product-inline-quantity"[^>]*readOnly=""/);
  // Сохранённый прежний текст и пустой новый пункт доступны инженеру как две пары.
  assert.equal((engineer.match(/<textarea\b/g) ?? []).length, 4);
  assert.match(engineer, /<textarea[^>]*aria-label="Значение характеристики 1"[^>]*>Описание<\/textarea>/);
  assert.match(engineer, /data-technical-trailing="true"/);
  assert.doesNotMatch(engineer, /<textarea[^>]*readOnly/);
  // eslint-disable-next-line react/no-children-prop -- provider requires children in its typed props
  const contacts = renderToStaticMarkup(createElement(ProductInlineProvider, { productId: "product", initial,
    children: createElement(ProductInlineContacts, { canManage: false, clients: [{id: "client", label: "Клиент", phone: "+375290000000", address: "Адрес клиента"}] }) }));
  assert.ok(contacts.indexOf("product-inline-client") < contacts.indexOf("product-client-phone"));
  assert.ok(contacts.indexOf("product-client-phone") < contacts.indexOf("product-client-address"));
  assert.doesNotMatch(contacts, /Количество|Техническое описание|Замерщик/);
});
test("нижние секции постоянны, документы precede сборку/монтаж и локальная прокрутка", () => {
  const html = renderToStaticMarkup(createElement(ProductSinglePage, {
    overview: "Реквизиты", documents: "Документы", assembly: "Сборщик", installation: "Монтажник", works: null, materials: null,
  }));
  const markers = ["Реквизиты", "Документы", "Сборщик", "Монтажник", "Работы и задачи"];
  assert.ok(markers.every((marker, index) => !index || html.indexOf(markers[index - 1]) < html.indexOf(marker)));
  assert.doesNotMatch(html, /role="tab|Материалы|История|Процентные этапы/);
  assert.match(html, /data-product-section="works"/);
  assert.match(html, /overflow-x-auto/);
});
