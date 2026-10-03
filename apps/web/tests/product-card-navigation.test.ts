import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as React from "react";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import test from "node:test";
import {openProductCardCover} from "../src/lib/product-card-cover-action";
import {CardNumber} from "../src/components/card-number";
import {ProductKanbanCard} from "../src/components/product-kanban-card";
import {RecentProjects} from "../src/components/recent-projects";
Object.assign(globalThis,{React});
const product={number:"205.1",title:"Название без увеличения",statusChangedAt:"2026-10-01T00:00:00Z",expectedPrice:null,engineerName:null,sketchFile:{id:"file",fileName:"cover.png",mimeType:"image/png",hasThumb:true}};
test("project policy invokes the existing navigation once without opening fullscreen",()=>{
 const calls:string[]=[];openProductCardCover({type:"navigate",onOpen:()=>calls.push("same product route")},()=>calls.push("fullscreen"));
 assert.deepEqual(calls,["same product route"]);
});
test("general card default remains fullscreen and drag overlay never opens either context",()=>{
 const calls:string[]=[];openProductCardCover(undefined,()=>calls.push("fullscreen"));assert.deepEqual(calls,["fullscreen"]);
 openProductCardCover({type:"navigate",onOpen:()=>calls.push("navigate")},()=>calls.push("fullscreen"),true);openProductCardCover(undefined,()=>calls.push("fullscreen"),true);assert.deepEqual(calls,["fullscreen"]);
});
test("actual shared card renders accessible context action and disables drag preview",()=>{
 const project=renderToStaticMarkup(createElement(ProductKanbanCard,{product,currency:"BYN",showAmount:false,coverAction:{type:"navigate",onOpen(){}}}));
 const general=renderToStaticMarkup(createElement(ProductKanbanCard,{product,currency:"BYN",showAmount:false}));
 const drag=renderToStaticMarkup(createElement(ProductKanbanCard,{product,currency:"BYN",showAmount:false,dragging:true}));
 assert.match(project,/aria-label="Открыть изделие Название без увеличения"/);assert.doesNotMatch(project,/на весь экран/);assert.match(general,/на весь экран/);assert.match(drag,/aria-label="[^"]*на весь экран" disabled=""/);
 assert.match(project,/data-card-number="true"/);assert.match(project,/class="break-words text-sm">Название без увеличения/);
});
test("number token enlarges only its own content and recent project keeps navigation and labels",()=>{
 const number=renderToStaticMarkup(createElement(CardNumber,null,"205"));assert.match(number,/text-\[1.25em\] font-bold/);
 const recent=renderToStaticMarkup(createElement(RecentProjects,{projects:[{id:"project",number:"205",client:"Клиент",product:"Название заказа",status:"В работе",statusClass:"",sum:"10 BYN"}]}));
 assert.match(recent,/href="\/projects\/project"/);assert.equal((recent.match(/data-card-number/g)??[]).length,1);assert.match(recent,/>Название заказа</);assert.match(recent,/>Клиент</);
});
test("project tab passes shared onOpen policy while global board now explicitly navigates and drag handles remain intact",()=>{
 const tab=readFileSync(new URL("../src/app/(app)/projects/[id]/products-tab.tsx",import.meta.url),"utf8");
 assert.match(tab,/coverAction=\{\{type:"navigate",onOpen:\(\)=>onOpen\(product\)\}\}/);assert.match(tab,/onClick=\{\(\) => onOpen\(product\)\}/);assert.match(tab,/setActivatorNodeRef/);
 const general=readFileSync(new URL("../src/app/(app)/products/products-kanban.tsx",import.meta.url),"utf8");assert.match(general,/coverAction=\{\{type:"navigate",onOpen:\(\)=>onOpen\(product\)\}\}/);assert.match(general,/setActivatorNodeRef/);
 for(const file of ["../src/components/project-kanban-card.tsx","../src/app/(app)/projects/projects-table.tsx","../src/app/(app)/products/products-table.tsx"])
  assert.match(readFileSync(new URL(file,import.meta.url),"utf8"),/<CardNumber>\{(?:project|row)\.number\}<\/CardNumber>/);
});
