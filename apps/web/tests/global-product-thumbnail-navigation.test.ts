import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {productDetailHref,globalProductsHref} from '../src/lib/product-return-navigation';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
let dragging=false,fullscreen=0,coverClick:((event:{preventDefault:()=>void;stopPropagation:()=>void})=>void)|undefined,rowClick:(()=>void)|undefined;const pushes:string[]=[];
const capturedReact={...React,createElement:(type:unknown,props:Record<string,unknown>|null,...children:React.ReactNode[])=>{
 if(type==='button'&&typeof props?.['aria-label']==='string'&&props['aria-label'].startsWith('Открыть '))coverClick=props.onClick as typeof coverClick;
 if(type==='div'&&typeof props?.className==='string'&&props.className.startsWith('relative')&&typeof props.onClick==='function')rowClick=props.onClick as ()=>void;
 return React.createElement(type as React.ElementType,props,...children);
}};
inject('react',capturedReact);Object.assign(globalThis,{React:capturedReact});
inject('next/navigation',{useRouter:()=>({push:(href:string)=>pushes.push(href),refresh(){throw Error('REFRESH_FORBIDDEN')}})});
inject('../src/lib/list-params',{useListParams:()=>({query:'view=kanban&q=filter&page=3'})});
inject('../src/server/products/actions',{changeProductStatus(){throw Error('STATUS_WRITE_FORBIDDEN')}});
inject('../src/components/file-viewer',{useFileViewer:()=>({open(){fullscreen++},viewer:null})});
inject('@dnd-kit/core',{DndContext:({children}:{children:React.ReactNode})=>children,DragOverlay:()=>null,PointerSensor:()=>null,useDraggable:()=>({attributes:{},listeners:{},setActivatorNodeRef(){},setNodeRef(){},transform:null,isDragging:dragging}),useDroppable:()=>({setNodeRef(){},isOver:false}),useSensors:()=>[],useSensor:()=>({})});
const{ProductsKanban}=require('../src/app/(app)/products/products-kanban') as typeof import('../src/app/(app)/products/products-kanban');
const product={id:'p',number:'205.1',title:'Product',kind:null,status:'PRODUCTION' as const,statusChangedAt:new Date(0).toISOString(),expectedPrice:null,quantity:1,currency:'BYN',projectId:'parent',projectNumber:'205',projectTitle:'Project',clientId:'c',clientName:'Client',engineerName:null,engineerId:null,isEngineeringParticipant:false,hasB3d:false,noModel:false,sketchFile:{id:'file',fileName:'sketch.png',mimeType:'image/png',hasThumb:false}};
function render(activeDrag=false){dragging=activeDrag;fullscreen=0;pushes.length=0;coverClick=undefined;rowClick=undefined;return renderToStaticMarkup(React.createElement(ProductsKanban,{initialProducts:[product],canManage:false,actorRoles:['WORKER'],showAmount:false}));}
test('actual global cover DOM callback navigates once and preserves same row context without fullscreen',()=>{
 const html=render();assert.ok(coverClick&&rowClick);let prevented=0,stopped=0;coverClick!({preventDefault(){prevented++},stopPropagation(){stopped++}});
 const expected=productDetailHref(product.number,globalProductsHref('view=kanban&q=filter&page=3'));assert.deepEqual(pushes,[expected]);assert.equal(fullscreen,0);assert.equal(prevented,1);assert.equal(stopped,1);assert.match(html,/Открыть изделие Product/);pushes.length=0;rowClick!();assert.deepEqual(pushes,[expected]);
});
test('actual global cover drag guard prevents navigation and fullscreen even when callback invoked',()=>{
 const html=render(true);assert.ok(coverClick);coverClick!({preventDefault(){},stopPropagation(){}});assert.deepEqual(pushes,[]);assert.equal(fullscreen,0);assert.match(html,/<button[^>]+disabled/);
});
