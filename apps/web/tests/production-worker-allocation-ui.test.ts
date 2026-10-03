import assert from 'node:assert/strict';
import {before,test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRequire,Module} from 'node:module';
const require=createRequire(import.meta.url);let pin:typeof import('../src/components/worker-task-allocation-dialog').pinWorkerAllocationRequest;let TasksTab:typeof import('../src/app/(app)/projects/[id]/tasks-tab').TasksTab;
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
before(()=>{(globalThis as unknown as {React:typeof React}).React=React;inject('next/navigation',{useRouter:()=>({refresh(){},push(){}})});inject('../src/server/works/actions',{addWork(){throw Error('SSR_WRITE_FORBIDDEN')},removeWork(){throw Error('SSR_WRITE_FORBIDDEN')}});inject('../src/server/tasks/worker-allocation-actions',{createWorkerWorkTask(){throw Error('SSR_WRITE_FORBIDDEN')}});TasksTab=require('../src/app/(app)/projects/[id]/tasks-tab').TasksTab;pin=require('../src/components/worker-task-allocation-dialog').pinWorkerAllocationRequest;});
const base={projectId:'j',productId:'p',productQuantity:3,products:[],tasks:[],priceItems:[],workers:[],works:[{id:'w',title:'Cut',quantity:'3',quantityPerUnit:'1',unitSnapshot:'м.п.',allocated:'0',priceSnapshot:null,total:null,paymentKind:'LEGACY' as const,linkedTask:null}]};
test('worker allocation control uses safe eligibility independently of manager and salary masking',()=>{const html=renderToStaticMarkup(React.createElement(TasksTab,{...base,canManage:false,canAllocateWork:true,actorUserId:'me',allocationData:{workerOptions:[{id:'me',name:'Me'}],createdAssignments:[],dependencyOptions:[],eligibleWorkIds:['w']},works:[{...base.works[0],canAllocateWorker:true}]}));assert.match(html,/Назначить задачу/);assert.doesNotMatch(html,/Удалить работу|>\s*Задача<\/button>/);const blocked=renderToStaticMarkup(React.createElement(TasksTab,{...base,canManage:false,canAllocateWork:true,actorUserId:'me',works:[{...base.works[0],canAllocateWorker:false}]}));assert.doesNotMatch(blocked,/Назначить задачу/);});

test('pinned retry retains UUID/context/quantity and a dependency copy after draft changes',()=>{const input={projectId:'j',productId:'p',workId:'w',assigneeId:'other',title:'Cut',type:'Производство',dueAt:'2026-10-04',quantity:'0.30',dependencyIds:['d'],clientMutationId:'00000000-0000-4000-8000-000000000001'};const request=pin(input);input.assigneeId='me';input.quantity='99';input.dependencyIds.push('other');assert.equal(request.assigneeId,'other');assert.equal(request.quantity,'0.30');assert.equal(request.clientMutationId,'00000000-0000-4000-8000-000000000001');assert.deepEqual(request.dependencyIds,['d']);assert.ok(Object.isFrozen(request));assert.ok(Object.isFrozen(request.dependencyIds));});

test('manager task creation starts only from a remaining product work, never generic project task',()=>{
 const works=[{...base.works[0],priceSnapshot:'0',total:'0'}];
 const product=renderToStaticMarkup(React.createElement(TasksTab,{...base,works,canManage:true}));
 assert.match(product,/Назначить задачу/);assert.doesNotMatch(product,/>\s*Задача<\/button>/);
 const project=renderToStaticMarkup(React.createElement(TasksTab,{...base,productId:undefined,works,canManage:true}));
 assert.doesNotMatch(project,/Назначить задачу|>\s*Задача<\/button>/);
 const exhausted=renderToStaticMarkup(React.createElement(TasksTab,{...base,works:[{...works[0],allocated:'3'}],canManage:true}));
 assert.doesNotMatch(exhausted,/Назначить задачу/);
});
