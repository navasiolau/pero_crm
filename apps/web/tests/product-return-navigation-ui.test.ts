import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProjectTabs} from '../src/components/project-tabs';
import {TabsList,TabsTrigger,TabsContent} from '../src/components/ui/tabs';
import {resolveProjectTab,globalProductsHref,productDetailHref} from '../src/lib/product-return-navigation';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
const pushes:string[]=[];let deletes=0;let confirmDelete:(()=>Promise<boolean>)|undefined;
inject('next/navigation',{useRouter:()=>({push:(href:string)=>pushes.push(href),refresh(){throw Error('UNEXPECTED_REFRESH')}})});
inject('../src/components/product-inline-provider',{useProductInline:()=>({flush:async()=>true})});
inject('../src/server/products/actions',{deleteProduct:async()=>{deletes++;return{ok:true}},changeProductStatus(){throw Error('UNEXPECTED_STATUS_WRITE')}});
inject('../src/components/confirm-delete-dialog',{ConfirmDeleteDialog:(props:{onConfirm:()=>Promise<boolean>})=>{confirmDelete=props.onConfirm;return null;}});
inject('../src/lib/list-params',{useListParams:()=>({query:'view=table&q=filter&page=3',get:()=>'',set(){throw Error('UNEXPECTED_PREFERENCE_WRITE')}})});
let rowOpen:((row:import('../src/app/(app)/products/products-view').ProductRow)=>void)|undefined;
inject('../src/components/ui/data-table',{DataTable:(props:{rows:import('../src/app/(app)/products/products-view').ProductRow[];onRowClick:typeof rowOpen;renderMobileCard:(row:import('../src/app/(app)/products/products-view').ProductRow)=>React.ReactNode})=>{rowOpen=props.onRowClick;return React.createElement('div',null,...props.rows.map(props.renderMobileCard));}});
(globalThis as unknown as {React:typeof React}).React=React;
const{ProductHeader}=require('../src/app/(app)/products/[id]/product-header') as typeof import('../src/app/(app)/products/[id]/product-header');
const{ProductsTable}=require('../src/app/(app)/products/products-table') as typeof import('../src/app/(app)/products/products-table');
// eslint-disable-next-line react/no-children-prop -- typed wrapper требует children при createElement
function tabs(value:unknown){return renderToStaticMarkup(React.createElement(ProjectTabs,{initialTab:resolveProjectTab(value,['overview','products']),children:React.createElement(React.Fragment,null,React.createElement(TabsList,null,React.createElement(TabsTrigger,{value:'overview'},'Общее'),React.createElement(TabsTrigger,{value:'products'},'Изделия')),React.createElement(TabsContent,{value:'overview'},'overview-panel'),React.createElement(TabsContent,{value:'products'},'products-panel'))}));}
const product={id:'p',number:'205.1',title:'Product',kind:null,status:'DESIGN' as const,expectedPrice:null,quantity:1,description:null,projectId:'parent',engineerId:null};
function header(backHref?:string){return renderToStaticMarkup(React.createElement(ProductHeader,{product,canManage:false,actorRoles:['ACCOUNTANT'],currency:'BYN',showAmount:false,backHref}));}
test('real ProjectTabs URL products selects products panel, normal/invalid entry selects overview',()=>{assert.match(tabs('products'),/products-panel/);assert.doesNotMatch(tabs('products'),/overview-panel/);assert.match(tabs(undefined),/overview-panel/);assert.match(tabs(['products','files']),/overview-panel/);});
test('real Header global back retains filter/page and contextual accessible label',()=>{const html=header('/products?view=table&q=filter&page=3');assert.match(html,/href="\/products\?view=table&amp;q=filter&amp;page=3"/);assert.match(html,/Назад к списку изделий/);});
test('real Header rejects forged parent and uses Project Products fallback',()=>{const html=header('/projects/foreign?tab=products');assert.match(html,/href="\/projects\/parent\?tab=products"/);assert.match(html,/Назад к изделиям проекта/);});
test('successful registered delete callback returns to same global destination',async()=>{pushes.length=0;header('/products?view=table&page=3');assert.equal(await confirmDelete!(),true);assert.deepEqual(pushes,['/products?view=table&page=3']);assert.equal(deletes,1);});
test('successful delete with direct or forged context returns parent products',async()=>{pushes.length=0;header('https://evil.invalid');assert.equal(await confirmDelete!(),true);assert.deepEqual(pushes,['/projects/parent?tab=products']);});
test('actual global table mobile link and row callback carry identical canonical context',()=>{
 const row={...product,statusChangedAt:new Date(0).toISOString(),currency:'BYN',projectNumber:'205',projectTitle:'Project',clientId:'c',clientName:'Client',engineerName:null,isEngineeringParticipant:false,hasB3d:false,noModel:false,sketchFile:null};
 const html=renderToStaticMarkup(React.createElement(ProductsTable,{products:[row],total:1,page:3,pageSize:10,showAmount:false}));const expected=productDetailHref(row.number,globalProductsHref('view=table&q=filter&page=3'));assert.ok(html.includes(expected));pushes.length=0;rowOpen!(row);assert.deepEqual(pushes,[expected]);
});
