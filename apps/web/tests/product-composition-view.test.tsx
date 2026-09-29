import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompositionView } from "../src/components/composition-view";

// tsx's Node test transform uses classic JSX for the repository's existing UI primitives.
(globalThis as { React?: typeof React }).React = React;

const revision = { id: "confirmed", status: "CONFIRMED" as const, revisionNo: 1, draftVersion: 2,
  baseRevisionId: null, createdById: "manager", createdAt: "2026-09-29T00:00:00.000Z", confirmedById: "manager",
  confirmedAt: "2026-09-29T01:00:00.000Z" };
const draft = { ...revision, id: "draft", status: "DRAFT" as const, revisionNo: null, confirmedById: null, confirmedAt: null };
const base = { productId: "product", productNumber: "P-1", draft, current: revision, history: [revision], selected: revision,
  items: [
    { id: "module", revisionId: revision.id, lineageId: "m", parentId: null, kind: "MODULE" as const, designation: "М-1",
      normalizedDesignation: "М-1", title: "Длинный модуль шкафа", quantityPerParent: 2, effectiveQuantity: 2,
      depth: 1, travelsToInstallation: true, sortOrder: 0, createdAt: revision.createdAt, updatedAt: revision.createdAt },
    { id: "part", revisionId: revision.id, lineageId: "p", parentId: "module", kind: "PART" as const, designation: "Д-1",
      normalizedDesignation: "Д-1", title: "Полка", quantityPerParent: 3, effectiveQuantity: 6,
      depth: 2, travelsToInstallation: true, sortOrder: 0, createdAt: revision.createdAt, updatedAt: revision.createdAt },
  ] };

test("confirmed composition displays relative and effective quantities without duplicate shipping actions", () => {
  const html = renderToStaticMarkup(<CompositionView data={base} />);
  assert.match(html, /Ревизия 1 · Подтверждена/);
  assert.match(html, /На родителя: 3/);
  assert.match(html, /На изделие: 6/);
  assert.match(html, /Поедет на монтаж/);
  assert.doesNotMatch(html, /Отгрузить|Отправлено|3D/);
});

test("draft-only state explicitly says unconfirmed and never resembles production composition", () => {
  const html = renderToStaticMarkup(<CompositionView data={{ ...base, current: null, history: [], selected: draft,
    items: [{ ...base.items[0], revisionId: "draft" }] }} />);
  assert.match(html, /Черновик, не подтверждён/);
  assert.doesNotMatch(html, /Ревизия 1 · Подтверждена/);
});

test("read-only user never receives edit controls, while draft editor receives accessible actions", () => {
  const draftData = { ...base, current: null, history: [], selected: draft,
    items: [{ ...base.items[0], revisionId: "draft" }] };
  const readOnly = renderToStaticMarkup(<CompositionView data={draftData} canEdit={false} />);
  assert.doesNotMatch(readOnly, /Изменить М-1|Удалить М-1/);
  const editable = renderToStaticMarkup(<CompositionView data={draftData} canEdit onEdit={() => {}} onDelete={() => {}} />);
  assert.match(editable, /Изменить М-1/);
  assert.match(editable, /Удалить М-1/);
  assert.match(editable, /min-h-11 min-w-11/);
  const confirmed = renderToStaticMarkup(<CompositionView data={base} canEdit />);
  assert.doesNotMatch(confirmed, /Изменить М-1/);
});
