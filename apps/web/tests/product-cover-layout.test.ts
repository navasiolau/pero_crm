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

test("FileViewer fullscreen variant uses the original without altering the regular viewer", () => {
  const fullscreen = getFileViewerPresentation("cover-fullscreen");
  const standard = getFileViewerPresentation("standard");
  assert.equal(fullscreen.fullscreen, true);
  assert.equal(fullscreen.showFilenameBar, false);
  assert.match(fullscreen.popupClassName, /sm:max-w-none/);
  assert.equal(standard.fullscreen, false);
  assert.equal(standard.showFilenameBar, true);
  assert.doesNotMatch(standard.popupClassName, /sm:max-w-none/);

});

test("mobile dialog sizing excludes all fullscreen viewers and gives them the full viewport height", () => {
  const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
  assert.match(css, /\[data-slot="dialog-content"\]:not\(\[data-file-viewer-variant\$="-fullscreen"\]\)\s*\{[\s\S]*?max-height:\s*calc\(var\(--dialog-viewport-height,[^}]+\)\s*-/);
  assert.match(css, /\[data-slot="dialog-content"\]\[data-file-viewer-variant\$="-fullscreen"\]\s*\{[\s\S]*?height:\s*var\(--dialog-viewport-height,\s*100dvh\)[^}]*max-height:\s*none/);
});

test("21 empty sketch keeps permanent slot and exact upload prompt; readonly has no mutation control", () => {
 const base={productId:"p1",projectId:"order1",cover:null,deleteCoverAction:deleteSketchAction,header:createElement("h1",null,"Изделие"),details:null};
 const writable=renderToStaticMarkup(createElement(ProductCoverLayout,{...base,actorRoles:["MANAGER"],canEditTechnicalBlock:true}));
 const readonly=renderToStaticMarkup(createElement(ProductCoverLayout,{...base,actorRoles:["ACCOUNTANT"],canEditTechnicalBlock:false}));
 assert.match(writable,/data-slot="product-cover-image"/);assert.match(writable,/Добавьте эскиз/);assert.match(writable,/Добавить изображение/);
 assert.match(readonly,/data-slot="product-cover-image"/);assert.match(readonly,/Добавьте эскиз/);assert.doesNotMatch(readonly,/Добавить изображение/);
});

test("21 filled sketch is itself fullscreen trigger with exact delete, no gallery pencil or expand", () => {
 const cover=image("cover-1","p1","order1");
 const markup=renderToStaticMarkup(createElement(ProductCoverLayout,{productId:"p1",projectId:"order1",cover,actorRoles:["MANAGER"],canEditTechnicalBlock:true,deleteCoverAction:deleteSketchAction,header:null,details:null}));
 assert.match(markup,/aria-label="Открыть эскиз на весь экран"/);assert.match(markup,/aria-label="Удалить эскиз"/);
 assert.doesNotMatch(markup,/Заменить обложку|Добавить обложку|Назначить изображение|Выберите обложку|Открыть оригинал|cover-1\.jpg/);
});

test("readonly and engineer without existing file-delete right still view sketch but cannot delete",()=>{
 const cover=image("legacy-cover","p1","order1");
 for(const actorRoles of [["ACCOUNTANT"],["ENGINEER"]] as const){
  const markup=renderToStaticMarkup(createElement(ProductCoverLayout,{productId:"p1",projectId:"order1",cover,actorRoles,canEditTechnicalBlock:actorRoles[0]==="ENGINEER",canDeleteCover:false,deleteCoverAction:deleteSketchAction,header:null,details:null}));
  assert.match(markup,/Открыть эскиз на весь экран/);assert.doesNotMatch(markup,/Удалить эскиз|Добавить изображение/);
 }
});
