import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
function inject(path:string,exports:Record<string,unknown>){const file=require.resolve(path),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
inject('next/navigation',{useRouter:()=>({push(){throw Error('SSR_MUTATION_FORBIDDEN')},refresh(){throw Error('SSR_MUTATION_FORBIDDEN')}})});
inject('../src/server/products/actions',{createProduct(){throw Error('SSR_MUTATION_FORBIDDEN')},changeProductStatus(){throw Error('SSR_MUTATION_FORBIDDEN')}});
inject('../src/lib/list-params',{useListParams:()=>({query:''})});
(globalThis as unknown as{React:typeof React}).React=React;
const {ProductsTab}=require('../src/app/(app)/projects/[id]/products-tab')as typeof import('../src/app/(app)/projects/[id]/products-tab');
const {ProductsKanban}=require('../src/app/(app)/products/products-kanban')as typeof import('../src/app/(app)/products/products-kanban');
const product={id:'p',number:'1.1',title:'Подготовленное изделие',kind:null,status:'PREPARATION' as const,statusChangedAt:new Date().toISOString(),expectedPrice:'10.01',quantity:1,currency:'BYN',projectId:'project',projectNumber:'1',projectTitle:'Заказ',clientId:'client',clientName:'Клиент',engineerName:null,engineerId:null,isEngineeringParticipant:false,hasB3d:false,noModel:false,sketchFile:null};
function check(html:string){const prep=html.indexOf('>Подготовка<'),design=html.indexOf('>Проектирование<');assert.ok(prep>=0&&design>prep);const card=html.indexOf('Подготовленное изделие');assert.ok(card>prep&&card<design,'PREPARATION product must be in its first column');}
test('project mini kanban places preparation and its product before design',()=>{check(renderToStaticMarkup(React.createElement(ProductsTab,{projectId:'project',currency:'BYN',initialProducts:[product],canManage:true,actorRoles:['MANAGER'],actorUserId:'manager',showAmount:true,engineerOptions:[]})));});
test('global kanban uses the same first preparation column and product',()=>{check(renderToStaticMarkup(React.createElement(ProductsKanban,{initialProducts:[product],canManage:true,actorRoles:['MANAGER'],showAmount:true})));});
