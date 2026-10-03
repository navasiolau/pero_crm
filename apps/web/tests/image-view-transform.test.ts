import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as React from "react";
import { fitImage, clampImageTransform, zoomImageAt, imageGesture, beginImageGesture, initialImageTransform } from "../src/lib/image-view-transform";
import { FileViewer, getFileViewerPresentation, getFileViewerDispatch, type ViewableFile } from "../src/components/file-viewer";
import { FullscreenImageViewport } from "../src/components/fullscreen-image-viewport";

const bounds = { viewport: {width: 1000, height: 800}, image: {width: 1000, height: 800} };
test("fit показывает весь оригинал без обрезки для портретной и широкой фотографии", () => {
  assert.deepEqual(fitImage({width: 2000,height: 1000},{width: 1000,height: 800}),{width: 1000,height: 500});
  assert.deepEqual(fitImage({width: 1000,height: 2000},{width: 1000,height: 800}),{width: 400,height: 800});
});
test("выбранная точка изображения остаётся под курсором при увеличении и уменьшении", () => {
  const original = {scale: 2, x: 30, y: -40}, anchor = {x: 100, y: 120};
  const zoomed = zoomImageAt(original, 4, anchor, bounds);
  assert.equal((anchor.x-original.x)/original.scale,(anchor.x-zoomed.x)/zoomed.scale);
  assert.equal((anchor.y-original.y)/original.scale,(anchor.y-zoomed.y)/zoomed.scale);
  assert.deepEqual(zoomImageAt(zoomed,2,anchor,bounds),original);
});
test("масштаб и pan ограничены, fit сбрасывает смещение, resize не теряет изображение", () => {
  assert.deepEqual(clampImageTransform({scale: 0.1,x: 99,y: 99},bounds),initialImageTransform());
  assert.equal(zoomImageAt(initialImageTransform(),100,{x:0,y:0},bounds).scale,8);
  assert.deepEqual(clampImageTransform({scale:2,x:99999,y:-99999},bounds),{scale:2,x:500,y:-400});
  assert.deepEqual(clampImageTransform({scale:2,x:500,y:-400},{...bounds,viewport:{width:2500,height:2500}}),{scale:2,x:0,y:0});
});
test("drag перемещает увеличенное изображение, pinch совмещает увеличение и движение центра", () => {
  const start = {scale:2,x:0,y:0};
  const drag = beginImageGesture([{x:0,y:0}],start)!;
  assert.deepEqual(imageGesture(drag,[{x:50,y:-30}],bounds),{scale:2,x:50,y:-30});
  const pinch = beginImageGesture([{x:-50,y:0},{x:50,y:0}],start)!;
  assert.deepEqual(imageGesture(pinch,[{x:-50,y:30},{x:150,y:30}],bounds),{scale:4,x:50,y:30});
  assert.equal(beginImageGesture([],start),null);
  assert.deepEqual(initialImageTransform(),{scale:1,x:0,y:0});
});
test("central dispatch всегда полноэкранный для image/*, PDF/video/download сохраняют тип", () => {
  for (const mimeType of ["image/jpeg","image/png","image/webp","image/svg+xml"]) {
    const file={id:"f",fileName:"image",mimeType};
    assert.equal(getFileViewerDispatch(file),"image");
    assert.equal(getFileViewerPresentation("standard",file).fullscreen,true);
    assert.equal(getFileViewerPresentation("standard",file).showFilenameBar,false);
  }
  assert.equal(getFileViewerDispatch({id:"f",fileName:"pdf",mimeType:"application/pdf"}),"pdf");
  assert.equal(getFileViewerDispatch({id:"f",fileName:"video",mimeType:"video/mp4"}),"video");
  assert.equal(getFileViewerDispatch({id:"f",fileName:"model",mimeType:"application/octet-stream"}),"download");
  assert.equal(getFileViewerPresentation("standard",{mimeType:"video/mp4"}).fullscreen,false);
  assert.equal(getFileViewerPresentation("cover-fullscreen",{mimeType:"video/mp4"}).fullscreen,false);
});
test("закрытие размонтирует изображение; file, scope и variant разделяют состояние масштаба", () => {
  const file: ViewableFile = {id:"sample/id",fileName:"sample.png",mimeType:"image/png"};
  const onOpenChange = () => {};
  assert.equal(FileViewer({file,open:false,onOpenChange}),null);
  assert.equal(FileViewer({file:null,open:true,onOpenChange}),null);
  function viewport(input: ViewableFile, variant: "standard" | "cover-fullscreen" = "standard") {
    const dialog = FileViewer({file:input,open:true,onOpenChange,variant})!;
    assert.equal(dialog.props.open,true);
    assert.equal(dialog.props.modal,true);
    assert.equal(dialog.props.onOpenChange,onOpenChange);
    const content = dialog.props.children as React.ReactElement<{children: React.ReactNode}>;
    const image = (content.props.children as React.ReactNode[]).find(node =>
      React.isValidElement(node) && node.type === FullscreenImageViewport);
    assert.ok(React.isValidElement<{src:string;alt:string}>(image));
    assert.equal(image.props.alt,input.fileName);
    return image;
  }
  const regular = viewport(file);
  assert.equal(regular.props.src,"/api/files/sample/id");
  assert.notEqual(regular.key,viewport({...file,id:"another-image"}).key);
  assert.notEqual(regular.key,viewport(file,"cover-fullscreen").key);
  assert.equal(regular.key,viewport({...file}).key);
});
test("все входы используют центральный viewer; жесты удаляют обработчики при закрытии", () => {
  for (const file of ["../src/app/(app)/projects/[id]/files-tab.tsx","../src/components/task-dialog.tsx","../src/app/(app)/products/[id]/product-sketch-view.tsx","../src/components/product-kanban-card.tsx"])
    assert.match(readFileSync(new URL(file,import.meta.url),"utf8"),/useFileViewer/);
  const image = readFileSync(new URL("../src/components/fullscreen-image-viewport.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(image,/document\.body|window\.scroll|\.caption/);
  assert.match(image,/removeEventListener\("wheel",wheel\)/);
  assert.match(image,/observer\.disconnect\(\)/);
});
