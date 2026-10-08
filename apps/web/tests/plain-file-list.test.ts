import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {FileList, FileListRow, type FileListItem} from "../src/components/file-list";

Object.assign(globalThis,{React});
const original:FileListItem={id:"project-file",fileName:"Эскиз изделия.v2.png",mimeType:"image/png",canDelete:true};
const hiddenMetadata={...original,size:512000,uploaderName:"Скрытый автор",createdAt:"2026-01-12",category:"Скрытая категория",comment:"Скрытый комментарий",hasThumb:true};
const remove=async()=>({ok:true});

test("actual file row shows only the original name and delete action without thumbnail or metadata",()=>{
 const html=renderToStaticMarkup(React.createElement(FileListRow,{file:hiddenMetadata,onDelete:remove}));
 assert.match(html,/Эскиз изделия\.v2\.png/);
 assert.match(html,/aria-label="Удалить файл Эскиз изделия\.v2\.png"/);
 assert.doesNotMatch(html,/<img|Скрытый|2026-01-12|512000|Скачать|Отчетный документ|Категория/);
 assert.equal((html.match(/<svg/g)??[]).length,1);
});

test("PDF video and CAD names are downloads through their protected ordinary or finance source",()=>{
 for(const file of [
  {...original,mimeType:"application/pdf",fileName:"Счёт.pdf"},
  {...original,mimeType:"video/mp4",fileName:"Монтаж.mp4"},
  {...original,mimeType:"application/octet-stream",fileName:"Шкаф.b3d",source:"finance" as const,id:"finance/id"},
 ]){
  const html=renderToStaticMarkup(React.createElement(FileListRow,{file,onDelete:remove}));
  assert.match(html,/download="(?:Счёт\.pdf|Монтаж\.mp4|Шкаф\.b3d)"/);
  assert.ok(html.includes(file.source==="finance"?'/api/finance/documents/finance%2Fid':'/api/files/project-file'));
  assert.doesNotMatch(html,/<iframe|<video|<img|target="_blank"/);
 }
});

test("server-denied and read-only rows keep the unavailable trash disabled",()=>{
 const denied=renderToStaticMarkup(React.createElement(FileListRow,{file:{...original,canDelete:false},onDelete:remove}));
 const readonly=renderToStaticMarkup(React.createElement(FileListRow,{file:original}));
 for(const html of [denied,readonly])assert.match(html,/<button[^>]*disabled=""[^>]*aria-label="Удалить файл|<button[^>]*aria-label="Удалить файл[^>]*disabled=""/);
});

test("one list preserves filename extensions and one action per item and has a useful empty state",()=>{
 const files=[original,{...original,id:"second",fileName:"Замер.dwg",mimeType:"application/octet-stream",canDelete:false}];
 const html=renderToStaticMarkup(React.createElement(FileList,{files,onDelete:remove}));
 assert.match(html,/Эскиз изделия\.v2\.png/);assert.match(html,/Замер\.dwg/);
 assert.equal((html.match(/data-file-list-row=/g)??[]).length,2);
 assert.equal((html.match(/aria-label="Удалить файл /g)??[]).length,2);
 const empty=renderToStaticMarkup(React.createElement(FileList,{files:[]}));assert.match(empty,/Файлов пока нет/);
});