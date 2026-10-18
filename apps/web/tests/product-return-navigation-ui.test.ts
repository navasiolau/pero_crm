import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProjectTabs} from '../src/components/project-tabs';
import {TabsList,TabsTrigger,TabsContent} from '../src/components/ui/tabs';
import {resolveProjectTab,globalProductsHref,productDetailHref} from '../src/lib/product-return-navigation';
import type {ProductDeleteInput} from '../src/server/products/delete-contract';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
const pushes:string[]=[];
inject('next/navigation',{useRouter:()=>({push:(href:string)=>pushes.push(href),refresh(){throw Error('UNEXPECTED_REFRESH')}})});
inject('../src/components/product-inline-provider',{useProductInline:()=>({flush:async()=>true}),useOptionalProductInline:()=>null});
inject('../src/server/products/actions',{readProductDeleteBaseline(){throw Error('UNEXPECTED_BASELINE_READ')},deleteProductAction(){throw Error('UNEXPECTED_READONLY_DELETE')},changeProductStatus(){throw Error('UNEXPECTED_STATUS_WRITE')}});
inject('../src/components/confirm-delete-dialog',{ConfirmDeleteDialog:()=>null});
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
test('actual global table mobile link and row callback carry identical canonical context',()=>{
 const row={...product,statusChangedAt:new Date(0).toISOString(),currency:'BYN',projectNumber:'205',projectTitle:'Project',clientId:'c',clientName:'Client',engineerName:null,isEngineeringParticipant:false,hasB3d:false,noModel:false,sketchFile:null};
 const html=renderToStaticMarkup(React.createElement(ProductsTable,{products:[row],total:1,page:3,pageSize:10,showAmount:false}));const expected=productDetailHref(row.id,globalProductsHref('view=table&q=filter&page=3'));assert.ok(html.includes(expected));pushes.length=0;rowOpen!(row);assert.deepEqual(pushes,[expected]);
});

// Hook cells изолируют React lifecycle, но исполняется реальный production DeleteButton.
type HarnessElement={type:unknown;props:Record<string,unknown>};
async function deleteHarness(backHref:string,malformedFirst=false){
 const cells:unknown[]=[];let cursor=0,reads=0,refreshes=0;
 const requests:ProductDeleteInput[]=[],destinations:string[]=[];
 const hook={useState(seed:unknown){const index=cursor++;if(!(index in cells))cells[index]=seed;return[cells[index],(value:unknown)=>{cells[index]=value;}]},useRef(seed:unknown){const index=cursor++;if(!(index in cells))cells[index]={current:seed};return cells[index]},useEffect(){},
  router:{push:(href:string)=>destinations.push(href),refresh:()=>{refreshes++;}},
  baseline:async(id:string)=>{reads++;assert.equal(id,product.id);return{ok:true,baseline:{productId:product.id,number:product.number,title:product.title,expectedUpdatedAt:'2026-10-03T10:00:00.000Z'}}},
  remove:async(input:ProductDeleteInput)=>{requests.push({...input});return{ok:true,productId:input.productId,projectId:'parent',deletedAt:'2026-10-03T11:00:00.000Z',clientMutationId:malformedFirst&&requests.length===1?'wrong-ack':input.clientMutationId}},
 };
 const globals=globalThis as unknown as {productDeleteNavigationHarness?:typeof hook};globals.productDeleteNavigationHarness=hook;
 const modules=['react','next/navigation','../src/components/ui/button','../src/components/confirm-delete-dialog','../src/server/products/actions','../src/components/product-delete-button'];
 const previous=new Map(modules.map(name=>[require.resolve(name),require.cache[require.resolve(name)]]));
 let ProductDeleteButton:(props:{productId:string;canManage:boolean;returnHref:string})=>HarnessElement|null;
 try{
  inject('react',{...React,useState:hook.useState,useRef:hook.useRef,useEffect:hook.useEffect});
  inject('next/navigation',{useRouter:()=>hook.router});
  inject('../src/components/ui/button',{Button:'button'});
  inject('../src/components/confirm-delete-dialog',{ConfirmDeleteDialog:'confirm-delete'});
  inject('../src/server/products/actions',{readProductDeleteBaseline:hook.baseline,deleteProductAction:hook.remove});
  delete require.cache[require.resolve('../src/components/product-delete-button')];
  ProductDeleteButton=require('../src/components/product-delete-button').ProductDeleteButton;
 }finally{for(const [file,value]of previous){if(value)require.cache[file]=value;else delete require.cache[file];}}
 const render=(canManage=true)=>{cursor=0;return ProductDeleteButton({productId:product.id,canManage,returnHref:require('../src/lib/product-return-navigation').resolveProductReturn(backHref,product.projectId).href})};
 const child=(element:HarnessElement|null,type:string)=>{assert.ok(element);return (element.props.children as HarnessElement[]).find(item=>item?.type===type)!;};
 return{requests,destinations,get refreshes(){return refreshes},render,
  async open(){const button=child(render(),'button');(button.props.onClick as ()=>void)();await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,1);assert.equal(child(render(),'confirm-delete').props.open,true);},
  confirm:()=>child(render(),'confirm-delete').props.onConfirm as ()=>Promise<boolean>,close:()=>{delete globals.productDeleteNavigationHarness;}};
}
test('actual manager delete captures typed baseline and returns to global destination only after matched ACK',async()=>{
 const h=await deleteHarness('/products?view=table&page=3');try{assert.equal(h.render(false),null);await h.open();assert.equal(await h.confirm()(),true);assert.deepEqual(h.destinations,['/products?view=table&page=3']);assert.equal(h.refreshes,1);assert.equal(h.requests.length,1);assert.equal(h.requests[0].expectedUpdatedAt,'2026-10-03T10:00:00.000Z');assert.match(h.requests[0].clientMutationId,/^[a-f0-9-]{36}$/);}finally{h.close();}
});
test('actual delete rejects malformed ACK, retains exact typed attempt and retries to safe parent destination',async()=>{
 const h=await deleteHarness('https://evil.invalid',true);try{await h.open();assert.equal(await h.confirm()(),false);assert.deepEqual(h.destinations,[]);assert.equal(h.refreshes,0);assert.equal(await h.confirm()(),true);assert.deepEqual(h.requests[0],h.requests[1]);assert.deepEqual(h.destinations,['/projects/parent?tab=products']);}finally{h.close();}
});
