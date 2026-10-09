import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, mkdir } from "node:fs/promises";
const require=createRequire(import.meta.url), {build}=createRequire(require.resolve("tsx/package.json"))("esbuild"), {chromium}=require("@playwright/test");
const postcss=createRequire(require.resolve("@tailwindcss/postcss"))("postcss"), tailwind=require("@tailwindcss/postcss");
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."), screenshots=path.join(web,"../../node_modules/.cache/warehouse-units-ui");
const fixtureUnits=[{id:"warehouse-unit-piece",name:"шт",materialCount:1},{id:"liter",name:"л",materialCount:0},{id:"tenth",name:"1/10 листа",materialCount:0},{id:"custom",name:"собственная",materialCount:0}];
const bundle=build({stdin:{contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {MaterialUnitsView} from '@/app/(app)/settings/warehouse-units/units-view';
import {ItemsView} from '@/app/(app)/warehouse/items/items-view';
function App(){
 const [units,setUnits]=React.useState(window.__units);window.__setUnits=setUnits;
 const materials=[{id:'m',name:'ЛДСП',sku:null,unit:'шт',unitId:'warehouse-unit-piece',categoryId:null,categoryName:null,purchasePrice:17.25,minStock:0.125,active:false,comment:null,stock:10.325,warehouseReady:true,shortByProjects:0}];
 return window.__mode==='catalog'?<MaterialUnitsView rows={units}/>:<ItemsView rows={materials} categories={[]} units={units} canManage={true} showMoney={true}/>;
}createRoot(document.getElementById('root')).render(<App/>);
`,resolveDir:web,loader:"tsx"},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",tsconfig:path.join(web,"tsconfig.json"),define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"server-boundaries",setup(b){
 b.onResolve({filter:/^(sonner|@\/server\/warehouse\/(unit-actions|actions))$/},args=>({path:args.path,namespace:"qa"}));
 b.onLoad({filter:/.*/,namespace:"qa"},args=>({loader:"js",contents:args.path==="sonner"?'export const toast={success(){},error(message){window.__errors.push(message)}};':args.path.endsWith("unit-actions")?`
 export async function addMaterialUnit(input){window.__catalog.push({kind:'add',input});return{ok:true}};
 export async function renameMaterialUnit(id,input){window.__catalog.push({kind:'rename',id,input});return{ok:true}};
 export async function deleteMaterialUnit(id){window.__catalog.push({kind:'delete',id});return{ok:true}};
 `: 'export async function addMaterial(input){window.__materials.push({kind:"add",input});return{ok:true}};export async function updateMaterial(id,input){window.__materials.push({kind:"update",id,input});return{ok:true}};export const addMaterialCategory=async()=>({ok:true});export const toggleMaterial=async()=>({ok:true});export const toggleMaterialCategory=async()=>({ok:true});'}));
}}],logLevel:"silent"});
const css=(async()=>{const file=path.join(web,"src/app/globals.css");return (await postcss([tailwind({base:web,optimize:true})]).process(await readFile(file,"utf8"),{from:file})).css;})();
async function withPage(mode,run,width=1440){const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width,height:width===1440?900:844}});page.setDefaultTimeout(7000);
 await page.route("http://unit.fixture/",route=>route.fulfill({contentType:"text/html",body:'<div id="root" style="padding:16px"></div>'}));
 await page.goto("http://unit.fixture/");await page.addStyleTag({content:await css});
 await page.evaluate(({mode,units})=>{window.__mode=mode;window.__units=units;window.__catalog=[];window.__materials=[];window.__errors=[];},{mode,units:fixtureUnits});
 await page.addScriptTag({content:(await bundle).outputFiles[0].text});await page.getByRole("heading",{name:mode==="catalog"?"Единицы склада":"Номенклатура",exact:true}).waitFor();await run(page);
}finally{await browser.close();}}

test("catalog UI adds and renames by id; used delete is blocked and cancel never calls deletion",async()=>{
 await withPage("catalog",async page=>{
  assert.equal(await page.getByRole("button",{name:"Удалить единицу шт",exact:true}).isDisabled(),true);
  await page.getByRole("button",{name:"Добавить единицу",exact:true}).click();await page.getByLabel("Обозначение *",{exact:true}).fill("канистра");await page.getByRole("button",{name:"Сохранить",exact:true}).click();
  await page.waitForFunction(()=>window.__catalog.length===1);assert.deepEqual(await page.evaluate(()=>window.__catalog[0]),{kind:"add",input:{name:"канистра"}});
  await page.getByRole("button",{name:"Переименовать единицу л",exact:true}).click();await page.getByLabel("Обозначение *",{exact:true}).fill("литр");await page.getByRole("button",{name:"Сохранить",exact:true}).click();
  await page.waitForFunction(()=>window.__catalog.length===2);assert.deepEqual(await page.evaluate(()=>window.__catalog[1]),{kind:"rename",id:"liter",input:{name:"литр"}});
  await page.getByRole("button",{name:"Удалить единицу собственная",exact:true}).click();await page.getByRole("button",{name:"Отмена",exact:true}).click();assert.equal(await page.evaluate(()=>window.__catalog.length),2);
  await page.getByRole("button",{name:"Удалить единицу собственная",exact:true}).click();await page.getByRole("button",{name:"Удалить",exact:true}).click();await page.waitForFunction(()=>window.__catalog.length===3);assert.deepEqual(await page.evaluate(()=>window.__catalog[2]),{kind:"delete",id:"custom"});
 });
});
test("material picker uses dynamic labels and submits stable unit id with fractional stock unchanged",async()=>{
 await withPage("items",async page=>{
  await page.getByRole("button",{name:"Редактировать материал",exact:true}).click();const dialog=page.getByRole("dialog",{name:"Редактировать материал",exact:true});
  await dialog.getByRole("button",{name:"шт",exact:true}).click();await page.getByRole("button",{name:"1/10 листа",exact:true}).click();
  await dialog.getByRole("button",{name:"Сохранить",exact:true}).click();await page.waitForFunction(()=>window.__materials.length===1);
  const [saved]=await page.evaluate(()=>window.__materials);assert.equal(saved.input.unitId,"tenth");assert.equal(saved.input.minStock,0.125);assert.equal(saved.input.unit,undefined);assert.equal(saved.input.purchasePrice,undefined);
  await page.evaluate(units=>window.__setUnits(units),fixtureUnits.map(unit=>unit.id==="liter"?{...unit,name:"литр"}:unit));
  await page.getByRole("button",{name:"Добавить материал",exact:true}).click();const creating=page.getByRole("dialog",{name:"Новый материал",exact:true});await creating.getByRole("button",{name:"шт",exact:true}).click();assert.equal(await page.getByRole("button",{name:"литр",exact:true}).count(),1);
 });
});
test("catalog renders at desktop and mobile widths with real Tailwind styles",async()=>{
 await mkdir(screenshots,{recursive:true});
 for(const width of [1440,390])await withPage("catalog",async page=>{
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:path.join(screenshots,width+".png"),fullPage:true});
 },width);
});
