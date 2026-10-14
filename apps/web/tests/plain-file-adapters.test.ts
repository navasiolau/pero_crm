import assert from "node:assert/strict";
import test from "node:test";
import {createRequire, Module} from "node:module";
import * as React from "react";
import {renderToStaticMarkup} from "react-dom/server";
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
inject("next/navigation",{useRouter:()=>({refresh(){throw Error("SSR_REFRESH_FORBIDDEN")}})});
inject("../src/server/files/actions",{deleteFile(){throw Error("SSR_DELETE_FORBIDDEN")}});
inject("../src/server/payments/actions",{deletePayment(){throw Error("SSR_PAYMENT_DELETE_FORBIDDEN")},addPayment(){throw Error("SSR_PAYMENT_WRITE_FORBIDDEN")}});
Object.assign(globalThis,{React});
const {FileGridView}=require("../src/app/(app)/projects/[id]/files-tab") as typeof import("../src/app/(app)/projects/[id]/files-tab");
const base={id:"ordinary",fileName:"Исходное имя.v2.pdf",mimeType:"application/pdf",section:"PRODUCTION" as const,canDelete:false,hasThumb:true,size:128000,uploaderName:"Скрытый автор",createdAt:"2026-10-08T12:30:00.000Z"};

test("server-authorized ordinary file action remains available independently of uploader canEdit",()=>{
 const html=renderToStaticMarkup(React.createElement(FileGridView,{files:[{...base,canDelete:true}],canEdit:false}));
 assert.match(html,/aria-label="Удалить файл Исходное имя\.v2\.pdf"/);assert.doesNotMatch(html,/<button[^>]*disabled=""/);
});

test("real project FinanceTab includes the income document as a plain protected file row without file metadata or writes",()=>{
 const {FinanceTab}=require("../src/app/(app)/projects/[id]/finance-tab") as typeof import("../src/app/(app)/projects/[id]/finance-tab");
 const document={...base,id:"income-document",fileName:"Подтверждение прихода.v2.pdf",source:"finance" as const};
 const html=renderToStaticMarkup(React.createElement(FinanceTab,{
  projectId:"own-project",currency:"BYN",canEdit:false,
  economics:{expectedPrice:25,paidTotal:5,expensesTotal:0,payrollTotal:0,margin:25,marginAtFullPrice:25,expenseBreakdown:[]},
  payments:[{id:"own-income",direction:"INCOME",amount:5,currency:"BYN",rate:1,bynAmount:5,projectAmount:5,paidAt:"2026-10-08",comment:null,cashAccountName:"Касса",expenseArticleName:null,createdByName:null,reportDocument:document,stockPurchase:null}],
  expenseRows:[],cashAccounts:[],expenseArticles:[],
 }));
 assert.match(html,/data-file-list-row="income-document"/);assert.match(html,/href="\/api\/finance\/documents\/income-document"/);assert.match(html,/download="Подтверждение прихода\.v2\.pdf"/);
 const fileRow=html.match(/<div[^>]*data-file-list-row="income-document"[\s\S]*?<\/div>/)?.[0];assert.ok(fileRow);assert.match(fileRow,/aria-label="Удалить файл Подтверждение прихода\.v2\.pdf"/);assert.match(fileRow,/disabled=""/);
 assert.doesNotMatch(fileRow,/<img|<iframe|preview=|Скрытый автор|128000|2026|aria-label="Скачать"/);
});
