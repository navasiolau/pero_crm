import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRequire,Module} from 'node:module';
import {Prisma,type Role} from '@prisma/client';
import {canAddProductWork} from '../src/server/works/access';
import {createWorkerTaskAllocationCore} from '../src/server/tasks/worker-allocation-core';
import type {TaskTransaction} from '../src/server/tasks/transaction';
import {taskPieceAmount} from '../src/lib/work-shares';
import {canAccrueOrdinarySalary} from '../src/lib/compensation-policy';
import {hasAnyRole,OFFICE_ROLES} from '../src/lib/roles';
import {navItems} from '../src/lib/nav';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
function host(tag:string){function Host(props:Record<string,unknown>){return React.createElement(tag,null,props.children as React.ReactNode);}return Host;}
let TasksTab:typeof import('../src/app/(app)/projects/[id]/tasks-tab').TasksTab;
before(()=>{
 (globalThis as unknown as {React:typeof React}).React=React;
 inject('next/navigation',{useRouter:()=>({refresh(){},push(){}})});
 inject('../src/server/works/actions',{addWork(){throw Error('SSR_WRITE_FORBIDDEN');},removeWork(){throw Error('SSR_WRITE_FORBIDDEN');}});
 inject('../src/server/tasks/actions',{changeTaskStatus(){throw Error('SSR_WRITE_FORBIDDEN');},createTask(){throw Error('SSR_WRITE_FORBIDDEN');}});
 inject('../src/components/ui/dialog',Object.fromEntries(['Dialog','DialogContent','DialogDescription','DialogFooter','DialogHeader','DialogOverlay','DialogPortal','DialogTitle','DialogTrigger','DialogClose'].map(name=>[name,host(name==='DialogTitle'?'h2':'section')])));
 TasksTab=require('../src/app/(app)/projects/[id]/tasks-tab').TasksTab;
});

// Кейс 1: монтажник создал работу в PRODUCTION; в DESIGN кнопок нет.
test('field creation gate allows MOUNTER in PRODUCTION and denies DESIGN/non-field',()=>{
 assert.equal(canAddProductWork(['MOUNTER'],'PRODUCTION'),true);
 assert.equal(canAddProductWork(['WORKER'],'PRODUCTION'),true);
 assert.equal(canAddProductWork(['MOUNTER'],'DESIGN'),false);
 assert.equal(canAddProductWork(['ENGINEER'],'PRODUCTION'),false);
});

// Кейс 2: монтажник раздал 5 работ двум сотрудникам; остаток защищён, повтор идемпотентен.
const mounterActor={id:'creator',name:'Монтажник',roles:['MOUNTER' as const],source:'web' as const};
function allocationInput(assigneeId:string){
 return{projectId:'project',productId:'product',workId:'work',assigneeId,title:'Монтаж',type:'Производство',quantity:'1.00',dueAt:'2026-10-10',estimateMinutes:60,dependencyIds:[],clientMutationId:randomUUID()};
}
function allocationFixture(){
 const users=new Map([['creator',{id:'creator',name:'Creator',roles:['MOUNTER'],active:true}],['worker',{id:'worker',name:'Worker',roles:['WORKER'],active:true}],['mounter2',{id:'mounter2',name:'Mounter2',roles:['MOUNTER'],active:true}]]);
 const product={id:'product',projectId:'project',status:'PRODUCTION',deletedAt:null,project:{deletedAt:null}};
 const work={id:'work',projectId:'project',productId:'product',quantity:new Prisma.Decimal('5.00'),priceSnapshot:new Prisma.Decimal('12.34'),paymentKind:'LEGACY',stagePayPoolId:null};
 const tasks:Record<string,unknown>[]=[],logs:Record<string,unknown>[]=[],events:Record<string,unknown>[]=[];
 const tx={$queryRaw:async()=>[],user:{findUnique:async({where}:{where:{id:string}})=>users.get(where.id)??null},project:{findUnique:async()=>({id:'project',currency:'BYN',deletedAt:null})},product:{findFirst:async()=>product},work:{findUnique:async()=>({...work,tasks}),findFirst:async()=>({...work,tasks})},task:{findUnique:async({where}:{where:{id:string}})=>tasks.find(task=>task.id===where.id)??null,findMany:async()=>[],create:async({data}:{data:Record<string,unknown>})=>{const row={id:'task-'+tasks.length,...data,quantity:new Prisma.Decimal(String(data.quantity))};tasks.push(row);return row;}},changeLog:{findUnique:async({where}:{where:{id:string}})=>logs.find(row=>row.id===where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{logs.push(data);return data;}},domainEvent:{create:async({data}:{data:Record<string,unknown>})=>{const row={id:'event-'+events.length,...data};events.push(row);return row;}}} as unknown as Prisma.TransactionClient;
 const transaction:TaskTransaction=fn=>fn(tx);
 return{transaction,tasks,logs,events};
}
test('mounter distributes five works to two employees; over-limit conflicts and replay repeats',async()=>{
 const f=allocationFixture(),recipients=['worker','mounter2','worker','mounter2','worker'];
 const first=allocationInput(recipients[0]);
 assert.equal((await createWorkerTaskAllocationCore(mounterActor,first,f.transaction)).ok,true);
 for(const assigneeId of recipients.slice(1))assert.equal((await createWorkerTaskAllocationCore(mounterActor,allocationInput(assigneeId),f.transaction)).ok,true);
 assert.equal(f.tasks.length,5);
 assert.deepEqual(f.tasks.map(task=>task.assigneeId),recipients);
 const over=await createWorkerTaskAllocationCore(mounterActor,allocationInput('worker'),f.transaction);
 assert.equal(over.ok,false);assert.equal(f.tasks.length,5);
 const replay=await createWorkerTaskAllocationCore(mounterActor,first,f.transaction);
 assert.equal(replay.ok,true);assert.equal((replay as {repeated?:boolean}).repeated,true);assert.equal(f.tasks.length,5);
});

// Кейс 3: DONE начислил PIECE (обычная сдельщина LEGACY без изменений ядра).
test('DONE piece accrual math is unchanged for field executors',()=>{
 assert.equal(canAccrueOrdinarySalary(['MOUNTER' as Role]),true);
 assert.equal(canAccrueOrdinarySalary(['WORKER' as Role]),true);
 assert.equal(taskPieceAmount({quantity:'2.00',executorShare:1},'12.34'),'24.68');
});

// Кейсы 4–5: интерфейс — кнопки полевых ролей, подсказка пустого прайса, закрытый сайдбар.
const workRow={id:'w',title:'Монтаж',quantity:'5.00',quantityPerUnit:'1',unitSnapshot:'шт.',allocated:'0.00',priceSnapshot:'12.34',total:'61.70',paymentKind:'LEGACY' as const,linkedTask:null,canAllocateWorker:true};
const priceItem={id:'tariff',name:'Монтаж',unit:'шт.',price:'12.34'};
function tabProps(extra:Record<string,unknown>={}){
 return{projectId:'j',productId:'p',productQuantity:5,products:[],tasks:[],priceItems:[priceItem],workers:[],works:[{...workRow}],canManage:false,canAddWork:true,canAllocateWork:true,actorUserId:'me',allocationData:{workerOptions:[{id:'me',name:'Я'},{id:'other',name:'Коллега'}],createdAssignments:[{id:'t',title:'Монтаж',assigneeName:'Коллега',quantity:'1.00',status:'NEW' as const,workId:'w',dueAt:null,rewardAmount:'12.34',rewardCurrency:'BYN',rewardSource:'WORK_SNAPSHOT' as const}],dependencyOptions:[],eligibleWorkIds:['w']},...extra};
}
test('mounter sees work and allocation controls plus own assignments in PRODUCTION',()=>{
 const html=renderToStaticMarkup(React.createElement(TasksTab,tabProps()));
 assert.match(html,/>\s*Работа<\/button>/);
 assert.match(html,/Назначить задачу/);
 assert.match(html,/Мои назначения работникам/);
});
test('DESIGN hides field controls; empty price list shows manager hint',()=>{
 const design=renderToStaticMarkup(React.createElement(TasksTab,tabProps({canAddWork:false,canAllocateWork:false,works:[{...workRow,canAllocateWorker:false}]})));
 assert.doesNotMatch(design,/>\s*Работа<\/button>/);
 assert.doesNotMatch(design,/Назначить задачу/);
 assert.doesNotMatch(design,/Мои назначения работникам/);
 const empty=renderToStaticMarkup(React.createElement(TasksTab,tabProps({priceItems:[]})));
 assert.match(empty,/обратитесь к менеджеру/);
 const filled=renderToStaticMarkup(React.createElement(TasksTab,tabProps()));
 assert.doesNotMatch(filled,/обратитесь к менеджеру/);
});
test('sidebar stays closed for mounters and tasks page keeps office redirect',()=>{
 assert.equal(navItems.some(item=>item.href==='/tasks'&&item.roles.includes('MOUNTER' as Role)),false);
 assert.equal(navItems.some(item=>item.href==='/products'&&item.roles.includes('MOUNTER' as Role)),false);
 assert.equal(hasAnyRole(['MOUNTER' as Role],OFFICE_ROLES),false);
});
