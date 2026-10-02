import assert from 'node:assert/strict';
import test from 'node:test';
import type {Prisma} from '@prisma/client';
import {createProductCore} from '../src/server/products/core';
import type {TaskTransaction} from '../src/server/tasks/transaction';
const actor={id:'m',name:'Manager',roles:['MANAGER' as const],source:'web' as const};
test('new products initialize all three rates from one snapshot even without assignments; prior products remain independent',async()=>{
 let rates={revision:2,rates:{ENGINEERING:'5.1',ASSEMBLY:'0.0',INSTALLATION:null as string|null}},reads=0;const created:Prisma.ProductCreateInput[]=[],old={rate:'9.0',paid:'150'};
 const tx={project:{findUnique:async()=>({id:'j',number:'1',currency:'BYN'})},user:{findFirst:async()=>null},orgSetting:{findUnique:async()=>{reads++;return{value:JSON.stringify(rates)}}},product:{findMany:async()=>[],aggregate:async()=>({_max:{suffixInt:0}}),create:async({data}:{data:Prisma.ProductCreateInput})=>{created.push(data);return{id:`p${created.length}`,initialPrice:null,...data}}},changeLog:{create:async()=>({})}} as unknown as Prisma.TransactionClient;
 const transaction:TaskTransaction=fn=>fn(tx);assert.equal((await createProductCore(actor,{projectId:'j',title:'Product'},transaction)).ok,true);
 const first=created[0].percentageConfigs?.create as {kind:string;ratePercent:string|null;revision:number}[];assert.deepEqual(first.map(row=>[row.kind,row.ratePercent,row.revision]),[['ENGINEERING','5.1',1],['ASSEMBLY','0.0',1],['INSTALLATION',null,1]]);assert.equal(reads,1);
 rates={revision:3,rates:{ENGINEERING:'6.0',ASSEMBLY:'4.0',INSTALLATION:'7.0'}};await createProductCore(actor,{projectId:'j',title:'Next'},transaction);assert.equal(reads,2);assert.deepEqual(first.map(row=>row.ratePercent),['5.1','0.0',null]);assert.deepEqual(old,{rate:'9.0',paid:'150'});
});
test('missing setting initializes null configs; corrupt or foreign money defaults never leave a partial product',async()=>{
 let value:string|null=null,currency='BYN';const created:Prisma.ProductCreateInput[]=[];
 const tx={project:{findUnique:async()=>({id:'j',number:'1',currency})},orgSetting:{findUnique:async()=>value===null?null:{value}},product:{findMany:async()=>[],create:async({data}:{data:Prisma.ProductCreateInput})=>{created.push(data);return{id:'p',initialPrice:null,...data};}},changeLog:{create:async()=>({})}} as unknown as Prisma.TransactionClient;
 const transaction:TaskTransaction=fn=>fn(tx);
 assert.equal((await createProductCore(actor,{projectId:'j',title:'No defaults'},transaction)).ok,true);
 assert.deepEqual((created[0].percentageConfigs?.create as {ratePercent:string|null}[]).map(row=>row.ratePercent),[null,null,null]);
 value='corrupt';await assert.rejects(createProductCore(actor,{projectId:'j',title:'Corrupt'},transaction),/настройки/i);assert.equal(created.length,1);
 value=JSON.stringify({revision:1,rates:{ENGINEERING:'5',ASSEMBLY:null,INSTALLATION:null}});currency='USD';assert.equal((await createProductCore(actor,{projectId:'j',title:'Foreign'},transaction)).ok,false);assert.equal(created.length,1);
});
