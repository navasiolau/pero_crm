import assert from 'node:assert/strict';
import {before,test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRequire,Module} from 'node:module';
const require=createRequire(import.meta.url);let TasksTab:typeof import('../src/app/(app)/projects/[id]/tasks-tab').TasksTab;
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
before(()=>{(globalThis as unknown as {React:typeof React}).React=React;inject('next/navigation',{useRouter:()=>({refresh(){},push(){}})});inject('../src/server/works/actions',{addWork(){throw Error('SSR_WRITE_FORBIDDEN')},removeWork(){throw Error('SSR_WRITE_FORBIDDEN')}});TasksTab=require('../src/app/(app)/projects/[id]/tasks-tab').TasksTab;});
const base={projectId:'j',productId:'p',productQuantity:3,products:[],tasks:[],priceItems:[],workers:[],works:[{id:'w',title:'Cut',quantity:'3',quantityPerUnit:'1',unitSnapshot:'м.п.',allocated:'0',priceSnapshot:null,total:null,paymentKind:'LEGACY' as const,linkedTask:null}]};
test('actual worker work-create control is independent of task/delete controls and masked work totals never show zero',()=>{
 const html=renderToStaticMarkup(React.createElement(TasksTab,{...base,canManage:false,canAddWork:true}));assert.match(html,/>\s*Работа<\/button>/);assert.doesNotMatch(html,/>\s*Задача<\/button>|Удалить работу/);assert.match(html,/м\.п\./);assert.doesNotMatch(html,/итого 0/);
 const closed=renderToStaticMarkup(React.createElement(TasksTab,{...base,canManage:false,canAddWork:false}));assert.doesNotMatch(closed,/>\s*Работа<\/button>/);
});
test('manager default work/task/delete flow remains independent and retains known snapshot total',()=>{
 const html=renderToStaticMarkup(React.createElement(TasksTab,{...base,canManage:true,works:[{...base.works[0],priceSnapshot:'12.34',total:'37.02'}]}));assert.match(html,/>\s*Работа<\/button>/);assert.match(html,/>\s*Задача<\/button>/);assert.match(html,/Удалить работу/);assert.match(html,/37,02/);
});
