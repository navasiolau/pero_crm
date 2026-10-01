import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  canReplaceProductCover,
  getAttachedProductCoverChoices,
  getProductCoverActions,
  getProductCoverLayout,
  getProductCoverPreviewUrl,
  keepCurrentCoverOnFailure,
  refreshAfterCoverMutation,
  type ProductCoverChoice,
} from "../src/lib/product-hero";
import { getFileViewerPresentation } from "../src/components/file-viewer";
import { ProductCoverLayout } from "../src/app/(app)/products/[id]/product-sketch";

const image = (id: string, productId: string, projectId: string, mimeType = "image/jpeg") => ({
  id, productId, projectId, fileName: `${id}.jpg`, mimeType, hasThumb: true,
});

test("cover layout reserves the split only when an image exists", () => {
  assert.equal(getProductCoverLayout(true), "cover");
  assert.equal(getProductCoverLayout(false), "full-width");
});

test("cover replacement follows edit permission and role union", () => {
  assert.equal(canReplaceProductCover(["MANAGER"], true), true);
  assert.equal(canReplaceProductCover(["ENGINEER"], true), true);
  assert.equal(canReplaceProductCover(["MANAGER", "ENGINEER"], true), true);
  assert.equal(canReplaceProductCover(["ACCOUNTANT", "ENGINEER"], true), true);
  assert.equal(canReplaceProductCover(["ENGINEER"], false), false);
  assert.equal(canReplaceProductCover(["ACCOUNTANT"], true), false);
  assert.equal(canReplaceProductCover(["WORKER"], true), false);
  assert.equal(canReplaceProductCover(["MOUNTER"], true), false);
});

test("cover toolbar contains only fullscreen and the permitted replace icon", () => {
  assert.deepEqual(getProductCoverActions(true, true), ["fullscreen", "replace"]);
  assert.deepEqual(getProductCoverActions(true, false), ["fullscreen"]);
  assert.deepEqual(getProductCoverActions(false, true), ["replace"]);
  assert.deepEqual(getProductCoverActions(false, false), []);
});

test("existing cover choices are image files attached to the same product and project", () => {
  const choices = getAttachedProductCoverChoices([
    image("current", "p1", "order1"),
    image("other-product", "p2", "order1"),
    image("other-project", "p1", "order2"),
    image("pdf", "p1", "order1", "application/pdf"),
  ], "p1", "order1");

  assert.deepEqual(choices.map((file) => file.id), ["current"]);
});

test("cover and board previews use protected optimized routes while fullscreen uses original", () => {
  const cover = image("img-1", "p1", "order1");
  assert.equal(getProductCoverPreviewUrl(cover, "card"), "/api/files/img-1?preview=card");
  assert.equal(getProductCoverPreviewUrl(cover, "cover"), "/api/files/img-1?preview=cover");
  assert.equal(getProductCoverPreviewUrl(cover, "original"), "/api/files/img-1");
  assert.equal(getProductCoverPreviewUrl({ ...cover, mimeType: "application/pdf" }, "cover"), null);
});

test("FileViewer fullscreen variant uses the original without altering the regular viewer", () => {
  const fullscreen = getFileViewerPresentation("cover-fullscreen");
  const standard = getFileViewerPresentation("standard");
  assert.equal(fullscreen.fullscreen, true);
  assert.equal(fullscreen.showFilenameBar, false);
  assert.match(fullscreen.popupClassName, /sm:max-w-none/);
  assert.equal(standard.fullscreen, false);
  assert.equal(standard.showFilenameBar, true);
  assert.doesNotMatch(standard.popupClassName, /sm:max-w-none/);

  const fullscreenPopup = renderToStaticMarkup(createElement("div", {
    className: fullscreen.popupClassName,
    "data-file-viewer-variant": "cover-fullscreen",
  }, "Обложка"));
  const standardPopup = renderToStaticMarkup(createElement("div", {
    className: standard.popupClassName,
    "data-file-viewer-variant": "standard",
  }, "Имя обычного файла"));
  assert.match(fullscreenPopup, /data-file-viewer-variant="cover-fullscreen"/);
  assert.match(fullscreenPopup, /sm:max-w-none/);
  assert.match(fullscreenPopup, /w-screen/);
  assert.doesNotMatch(fullscreenPopup, /Имя обычного файла/);
  assert.match(standardPopup, /data-file-viewer-variant="standard"/);
  assert.doesNotMatch(standardPopup, /sm:max-w-none/);
  assert.match(standardPopup, /Имя обычного файла/);
});

test("mobile dialog sizing excludes the fullscreen cover and gives it the full viewport height", () => {
  const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
  assert.match(css, /\[data-slot="dialog-content"\]:not\(\[data-file-viewer-variant="cover-fullscreen"\]\)\s*\{[\s\S]*?max-height:\s*calc\(var\(--dialog-viewport-height,[^}]+\)\s*-/);
  assert.match(css, /\[data-slot="dialog-content"\]\[data-file-viewer-variant="cover-fullscreen"\]\s*\{[\s\S]*?height:\s*var\(--dialog-viewport-height,\s*100dvh\)[^}]*max-height:\s*none/);
});

test("failed cover mutation keeps the previous cover id", () => {
  assert.equal(keepCurrentCoverOnFailure("old-file", "new-file", { ok: true }), "new-file");
  assert.equal(keepCurrentCoverOnFailure("old-file", "new-file", { ok: false }), "old-file");
});

test("cover change refreshes page data only after the server confirms success", () => {
  let refreshes = 0;
  const refresh = () => { refreshes += 1; };
  assert.equal(refreshAfterCoverMutation({ ok: false }, refresh), false);
  assert.equal(refreshes, 0);
  assert.equal(refreshAfterCoverMutation({ ok: true }, refresh), true);
  assert.equal(refreshes, 1);
});

test("cover presentation shows only fullscreen and authorized replace icons, never captions", () => {
  const cover: ProductCoverChoice = {
    ...image("cover-1", "p1", "order1"),
  };
  const html = renderToStaticMarkup(createElement(ProductCoverLayout, {
    productId: "p1",
    projectId: "order1",
    cover,
    attachedImages: [cover],
    actorRoles: ["ENGINEER"],
    canEditTechnicalBlock: true,
    setCoverAction: async () => ({ ok: true }),
    header: createElement("h1", null, "Тестовый шкаф"),
    details: createElement("p", null, "Основные сведения"),
  }));

  assert.match(html, /lg:grid-cols-\[minmax\(0,3fr\)_minmax\(0,2fr\)\]/);
  assert.match(html, /lg:grid-rows-\[auto_1fr\]/);
  assert.match(html, /lg:min-h-\[calc\(100dvh-8rem\)\]/);
  assert.match(html, /aria-label="Открыть обложку на весь экран"/);
  assert.match(html, /aria-label="Заменить обложку"/);
  assert.match(html, /preview=cover/);
  assert.match(html, /object-contain/);
  assert.doesNotMatch(html, /Эскиз изделия|Открыть оригинал|cover-1\.jpg/);
});

test("no-cover layout collapses to full width and offers only authorized replace icon", () => {
  const base = {
    productId: "p1",
    projectId: "order1",
    cover: null,
    attachedImages: [],
    setCoverAction: async () => ({ ok: true }),
    header: createElement("h1", null, "Тестовый шкаф"),
    details: createElement("p", null, "Основные сведения"),
  };
  const authorized = renderToStaticMarkup(createElement(ProductCoverLayout, {
    ...base, actorRoles: ["ENGINEER"], canEditTechnicalBlock: true,
  }));
  const denied = renderToStaticMarkup(createElement(ProductCoverLayout, {
    ...base, actorRoles: ["ACCOUNTANT"], canEditTechnicalBlock: false,
  }));

  assert.match(authorized, /data-layout="full-width"/);
  assert.match(authorized, /aria-label="Добавить обложку"/);
  assert.doesNotMatch(authorized, /Открыть обложку на весь экран/);
  assert.doesNotMatch(authorized, /lg:grid-cols-\[minmax\(0,3fr\)_minmax\(0,2fr\)\]/);
  assert.doesNotMatch(denied, /Добавить обложку|Заменить обложку/);
});

test("cover remains large when description is absent", () => {
  const cover: ProductCoverChoice = { ...image("cover-2", "p1", "order1") };
  const html = renderToStaticMarkup(createElement(ProductCoverLayout, {
    productId: "p1",
    projectId: "order1",
    cover,
    attachedImages: [cover],
    actorRoles: ["WORKER"],
    canEditTechnicalBlock: false,
    setCoverAction: async () => ({ ok: true }),
    header: createElement("h1", null, "Тестовый шкаф"),
    details: null,
  }));

  assert.match(html, /data-layout="cover"/);
  assert.match(html, /data-slot="product-cover-image"/);
  assert.match(html, /lg:min-h-\[calc\(100dvh-8rem\)\]/);
});
