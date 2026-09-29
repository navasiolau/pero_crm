import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CompositionFinishDisplay } from "../src/components/composition-finish-display";
import { CompositionFinishForm, validateCompositionFinishForm, type CompositionFinishFormValues } from "../src/components/composition-finish-form";

(globalThis as { React?: typeof React }).React = React;

const finish = {
  id: "finish-1", itemId: "part-1", surfaceKind: "FACE" as const, surfaceLabel: "Лицевая",
  normalizedSurfaceLabel: "ЛИЦЕВАЯ", layerOrder: 1, finishKind: "VENEER" as const,
  name: "Дуб натуральный", code: "OAK-01", colorHex: null, sampleFileId: "sample-1",
};

const sampleFiles = [{ id: "sample-1", fileName: "oak.jpg", mimeType: "image/jpeg" }];

const validForm: CompositionFinishFormValues = {
  itemId: "part-1", surfaceKind: "FACE", surfaceLabel: "Лицевая", layerOrder: "1",
  finishKind: "VENEER", name: "Дуб натуральный", code: "OAK-01", colorHex: "", sampleFileId: "",
};

test("finish display preserves exact names and codes and uses the protected file route", () => {
  const html = renderToStaticMarkup(<CompositionFinishDisplay finishes={[finish]} canEdit={false} />);
  assert.match(html, /Лицевая/);
  assert.match(html, /Дуб натуральный/);
  assert.match(html, /OAK-01/);
  assert.match(html, /Образец текстуры/);
  assert.match(html, /Открыть образец/);
  assert.match(html, /src="\/api\/files\/sample-1\?thumb=1"/);
  assert.match(html, /href="\/api\/files\/sample-1"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /_next\/image/);
  assert.doesNotMatch(html, /Изменить покрытие|Удалить покрытие/);
});

test("absent sample and color stay explicit and never produce a guessed swatch", () => {
  const html = renderToStaticMarkup(<CompositionFinishDisplay finishes={[{
    ...finish, colorHex: null, sampleFileId: null,
  }]} canEdit={false} />);
  assert.match(html, /Образец не задан/);
  assert.doesNotMatch(html, /finish-color-swatch/);
  assert.match(html, /OAK-01/);
});

test("draft finish actions have accessible labels and touch-sized controls", () => {
  const html = renderToStaticMarkup(<CompositionFinishDisplay finishes={[finish]} canEdit onAdd={() => {}} onEdit={() => {}} onDelete={() => {}} />);
  assert.match(html, /Добавить покрытие/);
  assert.match(html, /Изменить покрытие Дуб натуральный OAK-01/);
  assert.match(html, /Удалить покрытие Дуб натуральный OAK-01/);
  assert.equal((html.match(/min-h-11 min-w-11/g) ?? []).length, 2);
});

test("HEX alone is shown as a color sample and is not mislabeled as a missing image", () => {
  const html = renderToStaticMarkup(<CompositionFinishDisplay finishes={[{
    ...finish, colorHex: "#F1F0EA", sampleFileId: null,
  }]} canEdit={false} />);
  assert.match(html, /#F1F0EA/);
  assert.match(html, /finish-color-swatch/);
  assert.doesNotMatch(html, /Образец не задан/);
  assert.doesNotMatch(html, /Изображение-образец не задано/);
});

test("finish form requires a Russian surface label, name and code", () => {
  const result = validateCompositionFinishForm({ ...validForm, surfaceLabel: " ", name: "", code: "" }, [], []);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /Укажите подпись поверхности/);
});

test("whole surface becomes canonical and duplicate normalized layers are rejected", () => {
  const whole = validateCompositionFinishForm({ ...validForm, surfaceKind: "WHOLE", surfaceLabel: "" }, [], []);
  assert.equal(whole.ok, true);
  if (whole.ok) assert.equal(whole.value.surfaceLabel, "Целиком");

  const duplicate = validateCompositionFinishForm({ ...validForm, surfaceLabel: " a " }, [{
    ...finish, surfaceLabel: "Ａ", normalizedSurfaceLabel: "A", sampleFileId: null,
  }], []);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.match(duplicate.message, /уже есть слой/i);
});

test("finish form exposes keyboard-operable fields and touch-sized actions", () => {
  const html = renderToStaticMarkup(<CompositionFinishDisplay finishes={[]} canEdit onAdd={() => {}} />);
  assert.match(html, /Добавить покрытие/);
  const formHtml = renderToStaticMarkup(<CompositionFinishForm
    initial={validForm}
    existing={[]}
    sampleFiles={sampleFiles}
    onSubmit={() => {}}
    onCancel={() => {}}
  />);
  for (const label of ["Тип поверхности", "Подпись поверхности", "Слой", "Тип покрытия", "Название", "Код", "Цветовой образец HEX", "Образец изображения"]) {
    assert.match(formHtml, new RegExp(label));
  }
  assert.match(formHtml, /min-h-12/);
  assert.match(formHtml, /Сохранить покрытие/);
});
