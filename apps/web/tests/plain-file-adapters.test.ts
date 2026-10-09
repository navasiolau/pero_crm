import assert from "node:assert/strict";
import test from "node:test";
import {createRequire, Module} from "node:module";
import * as React from "react";
import {renderToStaticMarkup} from "react-dom/server";
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
inject("next/navigation",{useRouter:()=>({refresh(){throw Error("SSR_REFRESH_FORBIDDEN")}})});
inject("../src/server/files/actions",{deleteFile(){throw Error("SSR_DELETE_FORBIDDEN")}});
Object.assign(globalThis,{React});
const {FileGridView}=require("../src/app/(app)/projects/[id]/files-tab") as typeof import("../src/app/(app)/projects/[id]/files-tab");
const {ReportDocumentButton}=require("../src/components/report-document-button") as typeof import("../src/components/report-document-button");
const base={id:"ordinary",fileName:"Исходное имя.v2.pdf",mimeType:"application/pdf",section:"PRODUCTION" as const,canDelete:false,hasThumb:true,size:128000,uploaderName:"Скрытый автор",createdAt:"2026-10-08T12:30:00.000Z"};

test("real ordinary adapter renders only filename and permission-disabled trash even when canEdit is true",()=>{
 const html=renderToStaticMarkup(React.createElement(FileGridView,{files:[base],canEdit:true}));
 assert.match(html,/Исходное имя\.v2\.pdf/);assert.match(html,/download="Исходное имя\.v2\.pdf"/);
 assert.match(html,/aria-label="Удалить файл Исходное имя\.v2\.pdf"/);assert.match(html,/disabled=""/);
 assert.doesNotMatch(html,/<img|preview=|Скрытый автор|128000|КБ|МБ|2026|aria-label="Скачать"/);
});

test("server-authorized ordinary file action remains available independently of uploader canEdit",()=>{
 const html=renderToStaticMarkup(React.createElement(FileGridView,{files:[{...base,canDelete:true}],canEdit:false}));
 assert.match(html,/aria-label="Удалить файл Исходное имя\.v2\.pdf"/);assert.doesNotMatch(html,/<button[^>]*disabled=""/);
});

test("real finance report adapter uses original name plus disabled trash and protected download",()=>{
 const html=renderToStaticMarkup(React.createElement(ReportDocumentButton,{document:{id:"finance",fileName:"Счёт.pdf",mimeType:"application/pdf",source:"finance"}}));
 assert.match(html,/href="\/api\/finance\/documents\/finance"/);assert.match(html,/download="Счёт\.pdf"/);assert.match(html,/aria-label="Удалить файл Счёт\.pdf"/);assert.match(html,/disabled=""/);
 assert.doesNotMatch(html,/Отчетный документ|lucide-file-text|<iframe|<img/);
});