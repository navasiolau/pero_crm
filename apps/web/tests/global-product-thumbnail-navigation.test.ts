import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {productDetailHref,globalProductsHref} from '../src/lib/product-return-navigation';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
let fullscreen=0,coverClick:((event:{preventDefault:()=>void;stopPropagation:()=>void})=>void)|undefined,rowClick:(()=>void)|undefined;const pushes:string[]=[];
const capturedReact={...React,createElement:(type:unknown,props:Record<string,unknown>|null,...children:React.ReactNode[])=>{
 if(type==='button'&&typeof props?.['aria-label']==='string'&&props['aria-label'].startsWith('Открыть '))coverClick=props.onClick as typeof coverClick;
 if(type==='div'&&typeof props?.className==='string'&&props.className.startsWith('relative')&&typeof props.onClick==='function')rowClick=props.onClick as ()=>void;
 return React.createElement(type as React.ElementType,props,...children);
}};
inject('react',capturedReact);Object.assign(globalThis,{React:capturedReact});
inject('next/navigation',{useRouter:()=>({push:(href:string)=>pushes.push(href),refresh(){throw Error('REFRESH_FORBIDDEN')}})});
let currentQuery='view=kanban&q=filter&page=3';
inject('../src/lib/list-params',{useListParams:()=>({query:currentQuery,getQuery:()=>currentQuery})});
inject('../src/server/products/actions',{changeProductStatus(){throw Error('STATUS_WRITE_FORBIDDEN')}});
inject('../src/components/file-viewer',{useFileViewer:()=>({open(){fullscreen++},viewer:null})});
inject('@dnd-kit/core',{DndContext:({children}:{children:React.ReactNode})=>children,DragOverlay:()=>null,PointerSensor:()=>null,useDraggable:()=>({attributes:{},listeners:{},setActivatorNodeRef(){},setNodeRef(){},transform:null,isDragging:false}),useDroppable:()=>({setNodeRef(){},isOver:false}),useSensors:()=>[],useSensor:()=>({})});
const{ProductsKanban}=require('../src/app/(app)/products/products-kanban') as typeof import('../src/app/(app)/products/products-kanban');
const product={id:'p',number:'205.1',title:'Product',kind:null,status:'PRODUCTION' as const,statusChangedAt:new Date(0).toISOString(),expectedPrice:null,quantity:1,currency:'BYN',projectId:'parent',projectNumber:'205',projectTitle:'Project',clientId:'c',clientName:'Client',engineerName:null,engineerId:null,isEngineeringParticipant:false,hasB3d:false,noModel:false,sketchFile:{id:'file',fileName:'sketch.png',mimeType:'image/png',hasThumb:false}};
function render(){fullscreen=0;pushes.length=0;coverClick=undefined;rowClick=undefined;return renderToStaticMarkup(React.createElement(ProductsKanban,{initialProducts:[product],canManage:false,actorRoles:['WORKER'],showAmount:false}));}

test('cached real row/cover callbacks read newest query at activation without rerender',()=>{
 currentQuery='view=kanban&q=filter&page=3';render();const cachedRow=rowClick!,cachedCover=coverClick!;
 currentQuery='view=kanban&q=new%20filter&status=%5B%22PRODUCTION%22%5D';cachedRow();
 const expected=productDetailHref(product.number,globalProductsHref(currentQuery));assert.deepEqual(pushes,[expected]);
 pushes.length=0;currentQuery='view=kanban&active=1';cachedCover({preventDefault(){},stopPropagation(){}});
 assert.deepEqual(pushes,[productDetailHref(product.number,globalProductsHref(currentQuery))]);assert.equal(fullscreen,0);
 currentQuery='view=kanban&q=filter&page=3';
});
