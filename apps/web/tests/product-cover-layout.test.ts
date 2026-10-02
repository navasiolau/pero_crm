import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement, type ComponentProps } from "react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
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
import { ProductCoverLayout as ActualProductCoverLayout } from "../src/app/(app)/products/[id]/product-sketch-view";

function ProductCoverLayout(props: ComponentProps<typeof ActualProductCoverLayout>) {
  return createElement(AppRouterContext.Provider, {value: {refresh() {}} as AppRouterInstance}, createElement(ActualProductCoverLayout, props));
}

Object.assign(globalThis, {React});
const deleteSketchAction = async (input: {productId:string;expectedSketchFileId:string;clientMutationId:string}) => ({ok:true as const,sketchFileId:null,clientMutationId:input.clientMutationId});
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

test("legacy cover toolbar helper remains available for older SDK compatibility", () => {
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

test("cover presentation shows clickable sketch and exact delete only, never filename captions", () => {
  const cover: ProductCoverChoice = {
    ...image("cover-1", "p1", "order1"),
  };
  const html = renderToStaticMarkup(createElement(ProductCoverLayout, {
    productId: "p1",
    projectId: "order1",
    cover,
    actorRoles: ["ENGINEER"],
    canEditTechnicalBlock: true,
    deleteCoverAction: deleteSketchAction,
    header: createElement("h1", null, "Тестовый шкаф"),
    details: createElement("p", null, "Основные сведения"),
  }));

  assert.match(html, /lg:grid-cols-\[minmax\(0,3fr\)_minmax\(0,2fr\)\]/);
  assert.match(html, /aria-label="Открыть эскиз на весь экран"/);
  assert.match(html, /aria-label="Удалить эскиз"/);
  assert.match(html, /preview=cover/);
  assert.match(html, /object-contain/);
  assert.doesNotMatch(html, /Открыть оригинал|cover-1\.jpg/);
});

test("empty cover keeps the same slot and offers only authorized upload", () => {
  const base = {
    productId: "p1",
    projectId: "order1",
    cover: null,
    deleteCoverAction: deleteSketchAction,
    header: createElement("h1", null, "Тестовый шкаф"),
    details: createElement("p", null, "Основные сведения"),
  };
  const authorized = renderToStaticMarkup(createElement(ProductCoverLayout, {
    ...base, actorRoles: ["ENGINEER"], canEditTechnicalBlock: true,
  }));
  const denied = renderToStaticMarkup(createElement(ProductCoverLayout, {
    ...base, actorRoles: ["ACCOUNTANT"], canEditTechnicalBlock: false,
  }));

  assert.match(authorized, /data-layout="cover"/);
  assert.match(authorized, /Добавить изображение/);
  assert.doesNotMatch(authorized, /Открыть обложку на весь экран/);
  assert.match(authorized, /lg:grid-cols-\[minmax\(0,3fr\)_minmax\(0,2fr\)\]/);
  assert.doesNotMatch(denied, /Добавить изображение|Удалить эскиз/);
});

test("cover remains large when description is absent", () => {
  const cover: ProductCoverChoice = { ...image("cover-2", "p1", "order1") };
  const html = renderToStaticMarkup(createElement(ProductCoverLayout, {
    productId: "p1",
    projectId: "order1",
    cover,
    actorRoles: ["WORKER"],
    canEditTechnicalBlock: false,
    deleteCoverAction: deleteSketchAction,
    header: createElement("h1", null, "Тестовый шкаф"),
    details: null,
  }));

  assert.match(html, /data-layout="cover"/);
  assert.match(html, /data-slot="product-cover-image"/);
});

test("21 empty sketch keeps permanent slot and exact upload prompt; readonly has no mutation control", () => {
 const base={productId:"p1",projectId:"order1",cover:null,deleteCoverAction:deleteSketchAction,header:createElement("h1",null,"Изделие"),details:null};
 const writable=renderToStaticMarkup(createElement(ProductCoverLayout,{...base,actorRoles:["MANAGER"],canEditTechnicalBlock:true}));
 const readonly=renderToStaticMarkup(createElement(ProductCoverLayout,{...base,actorRoles:["ACCOUNTANT"],canEditTechnicalBlock:false}));
 assert.match(writable,/data-slot="product-cover-image"/);assert.match(writable,/Добавьте эскиз/);assert.match(writable,/Добавить изображение/);
 assert.match(readonly,/data-slot="product-cover-image"/);assert.match(readonly,/Добавьте эскиз/);assert.doesNotMatch(readonly,/Добавить изображение/);
});

test("21 filled sketch is itself fullscreen trigger with exact delete, no gallery pencil or expand", () => {
 const cover=image("exact-file","p1","order1");
 const markup=renderToStaticMarkup(createElement(ProductCoverLayout,{productId:"p1",projectId:"order1",cover,actorRoles:["MANAGER"],canEditTechnicalBlock:true,deleteCoverAction:deleteSketchAction,header:null,details:null}));
 assert.match(markup,/aria-label="Открыть эскиз на весь экран"/);assert.match(markup,/aria-label="Удалить эскиз"/);
 assert.doesNotMatch(markup,/Заменить обложку|Добавить обложку|Назначить изображение|Выберите обложку/);
});

test("readonly and engineer without existing file-delete right still view sketch but cannot delete",()=>{
 const cover=image("legacy-cover","p1","order1");
 for(const actorRoles of [["ACCOUNTANT"],["ENGINEER"]] as const){
  const markup=renderToStaticMarkup(createElement(ProductCoverLayout,{productId:"p1",projectId:"order1",cover,actorRoles,canEditTechnicalBlock:actorRoles[0]==="ENGINEER",canDeleteCover:false,deleteCoverAction:deleteSketchAction,header:null,details:null}));
  assert.match(markup,/Открыть эскиз на весь экран/);assert.doesNotMatch(markup,/Удалить эскиз|Добавить изображение/);
 }
});
