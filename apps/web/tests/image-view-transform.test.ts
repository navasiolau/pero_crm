import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fitImage, clampImageTransform, zoomImageAt, imageGesture, beginImageGesture, initialImageTransform } from "../src/lib/image-view-transform";
import { getFileViewerPresentation, getFileViewerDispatch } from "../src/components/file-viewer";

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
test("закрытие и смена file/context размонтируют масштаб; все входы используют центральный viewer", () => {
  const viewer = readFileSync(new URL("../src/components/file-viewer.tsx",import.meta.url),"utf8");
  assert.match(viewer,/if \(!file \|\| !open\) return null/);
  assert.match(viewer,/FullscreenImageViewport key=\{`\$\{variant\}:\$\{file.id\}`\}/);
  assert.match(viewer,/getFileViewerPresentation\(variant,file\)/);
  assert.match(viewer,/Dialog open=\{open\} onOpenChange=\{onOpenChange\} modal/);
  assert.match(viewer,/\/api\/files\/\$\{file.id\}\?view=1/);
  for (const file of ["../src/app/(app)/projects/[id]/files-tab.tsx","../src/components/task-dialog.tsx","../src/app/(app)/products/[id]/product-sketch-view.tsx","../src/components/product-kanban-card.tsx"])
    assert.match(readFileSync(new URL(file,import.meta.url),"utf8"),/useFileViewer/);
  const image = readFileSync(new URL("../src/components/fullscreen-image-viewport.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(image,/document\.body|window\.scroll|\.caption/);
  assert.match(image,/removeEventListener\("wheel",wheel\)/);
  assert.match(image,/observer\.disconnect\(\)/);
});
