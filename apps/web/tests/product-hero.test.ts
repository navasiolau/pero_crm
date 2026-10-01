import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  getProductHeroLayout,
  getProductHeroImageState,
  isCompletedProductHeroImageFailure,
  getProductSketchPreviewSource,
  getKanbanHeroHeights,
} from "../src/lib/product-hero";
import { productSketchProjection } from "../src/server/products/sketch-projection";
import { fileVisibilityWhere } from "../src/server/access/visibility";
import { ProductKanbanCard } from "../src/components/product-kanban-card";

test("product detail keeps both fields and expands an image or description by itself", () => {
  assert.equal(getProductHeroLayout(true, true), "split");
  assert.equal(getProductHeroLayout(true, false), "description");
  assert.equal(getProductHeroLayout(false, true), "image");
  assert.equal(getProductHeroLayout(false, false), "empty");
});

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

test("kanban image stage remains twice the measured information height", () => {
  assert.deepEqual(getKanbanHeroHeights(40), { infoHeight: 40, imageHeight: 80, cardHeight: 120 });
  assert.deepEqual(getKanbanHeroHeights(87.2), { infoHeight: 88, imageHeight: 176, cardHeight: 264 });
  assert.deepEqual(getKanbanHeroHeights(0), { infoHeight: 0, imageHeight: 0, cardHeight: 0 });
});

test("image failure replaces a broken source, while a different source can load", () => {
  const failed = "/api/files/file-1?preview=card";
  assert.equal(getProductHeroImageState(failed, null), "image");
  assert.equal(getProductHeroImageState(failed, failed), "error");
  assert.equal(getProductHeroImageState("/api/files/file-2", failed), "image");
  assert.equal(getProductHeroImageState(null, failed), "empty");
});

test("completed failed image is detected without rejecting loading or valid images", () => {
  assert.equal(isCompletedProductHeroImageFailure(true, 0), true);
  assert.equal(isCompletedProductHeroImageFailure(false, 0), false);
  assert.equal(isCompletedProductHeroImageFailure(true, 640), false);
  assert.equal(isCompletedProductHeroImageFailure(false, 640), false);
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

test("shared kanban card renders contained protected thumbnail for both board renderers", () => {
  const html = renderToStaticMarkup(createElement(ProductKanbanCard, {
    product: {
      number: "P-10.2",
      title: "Стол",
      statusChangedAt: new Date().toISOString(),
      expectedPrice: null,
      engineerName: null,
      sketchFile: { id: "file-10", fileName: "sketch.png", mimeType: "image/png", hasThumb: true },
    },
    currency: "BYN",
    showAmount: false,
  }));

  assert.match(html, /data-slot="product-kanban-image"/);
  assert.match(html, /src="\/api\/files\/file-10\?preview=card"/);
  assert.match(html, /object-contain/);
  assert.match(html, /alt="sketch\.png"/);
  assert.doesNotMatch(html, /1200|formatAmount/);
});

test("sketch projection returns only safe metadata and keeps actor file visibility", () => {
  const actor = { id: "engineer-1", roles: ["ENGINEER"] as const };
  const projection = productSketchProjection(actor as never);

  assert.deepEqual(Object.keys(projection.select).sort(), ["fileName", "hasThumb", "id", "mimeType"]);
  assert.deepEqual(projection.where, fileVisibilityWhere(actor as never));
  assert.notDeepEqual(projection.where, {});
});
