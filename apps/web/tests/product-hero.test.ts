import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  getProductHeroImageState,
  getProductSketchPreviewSource,
} from "../src/lib/product-hero";
import { ProductKanbanCard } from "../src/components/product-kanban-card";


test("preview chooses optimized protected routes independently of legacy thumb metadata", () => {
  assert.equal(getProductSketchPreviewSource({
    id: "file-1", fileName: "sketch.png", mimeType: "image/png", hasThumb: true,
  }), "/api/files/file-1?preview=card");
  assert.equal(getProductSketchPreviewSource({
    id: "file-2", fileName: "sketch.png", mimeType: "image/png", hasThumb: false,
  }), "/api/files/file-2?preview=card");
  assert.equal(getProductSketchPreviewSource({
    id: "file-1", fileName: "sketch.png", mimeType: "image/png", hasThumb: true,
  }, "original"), "/api/files/file-1");
  assert.equal(getProductSketchPreviewSource({
    id: "file-3", fileName: "drawing.pdf", mimeType: "application/pdf", hasThumb: true,
  }), null);
});


test("image failure replaces a broken source, while a different source can load", () => {
  const failed = "/api/files/file-1?preview=card";
  assert.equal(getProductHeroImageState(failed, null), "image");
  assert.equal(getProductHeroImageState(failed, failed), "error");
  assert.equal(getProductHeroImageState("/api/files/file-2", failed), "image");
  assert.equal(getProductHeroImageState(null, failed), "empty");
});


test("shared kanban card preserves information and stays compact without an image", () => {
  const html = renderToStaticMarkup(createElement(ProductKanbanCard, {
    product: {
      number: "P-10.1",
      title: "Длинное название шкафа",
      statusChangedAt: new Date().toISOString(),
      expectedPrice: "1200.00",
      engineerName: "Инженер",
      sketchFile: null,
    },
    currency: "BYN",
    showAmount: true,
    projectContext: "Проект P-10 · Клиент",
  }));

  assert.match(html, /data-slot="product-kanban-card"/);
  assert.match(html, /P-10\.1/);
  assert.match(html, /Длинное название шкафа/);
  assert.match(html, /Проект P-10 · Клиент/);
  assert.match(html, /Инженер: Инженер/);
  assert.match(html, /data-has-image="false"/);
  assert.doesNotMatch(html, /data-slot="product-kanban-image"/);
});
