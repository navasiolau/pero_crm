import assert from 'node:assert/strict';
import {createRequire,Module} from 'node:module';
import {test} from 'node:test';
import {Prisma} from '@prisma/client';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name);const stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
let projectCurrency='USD',fxCalls=0,writes=0,accountReads=0;let saved:Record<string,unknown>={};
const tx={project:{findUnique:async()=>({id:'p',number:'P',currency:projectCurrency})},cashAccount:{findUnique:async()=>{accountReads++;return{id:'cash',name:'USD cash',active:true,currency:'USD'}}},orgSetting:{findUnique:async()=>({value:'USD'})},expenseArticle:{findUnique:async()=>({id:'article',active:true})},payment:{create:async({data}:{data:Record<string,unknown>})=>{writes++;saved=data;return{id:'payment',...data}}}};
inject('../src/lib/prisma',{prisma:tx});inject('next/cache',{revalidatePath:()=>{}});
inject('../src/server/projects/core',{requireActorRoles:()=>{}});
inject('../src/server/plugins/changelog',{writeChangeLog:async()=>{}});inject('../src/server/plugins/events',{emitDomainEvent:async()=>{}});inject('../src/server/notifications/notify',{notifyOrg:async()=>{}});
inject('../src/server/tasks/transaction',{withTaskTransaction:async(fn:(t:typeof tx)=>unknown)=>fn(tx)});
inject('../src/server/finance/nbrb',{isCurrency:(v:string)=>['BYN','USD','EUR','RUB'].includes(v),getNbrbRate:async()=>{fxCalls++;return{rate:3,date:'2026-10-02'}},equivalents:(amount:number,rate:number,projectRate:number)=>({bynAmount:amount*rate,projectAmount:amount*rate/projectRate})});
inject('../src/server/payroll/cash-core',{readCashBalance:async()=>new Prisma.Decimal(1000),readOrgBalance:async(_tx:unknown,rate:string,delta:string)=>{assert.equal(rate,'1.000000');assert.equal(delta,'-300');return new Prisma.Decimal(1000)}});
const {createPaymentCore}=require('../src/server/payments/core') as typeof import('../src/server/payments/core');
const actor={id:'a',name:'A',roles:['ACCOUNTANT' as const],source:'web' as const};
const input={projectId:'p',direction:'INCOME' as const,amount:100,currency:'USD',cashAccountId:'cash'};
test('unprepared foreign project rejects income and expense before FX, cash read or write',async()=>{
 for(const direction of ['INCOME','EXPENSE'] as const){projectCurrency='USD';fxCalls=0;writes=0;accountReads=0;
 const result=await createPaymentCore(actor,{...input,direction,expenseArticleId:'article'});
 assert.equal(result.ok,false);assert.match(result.error??'',/BYN/);assert.equal(fxCalls,0);assert.equal(accountReads,0);assert.equal(writes,0);}
});
test('BYN project preserves USD cash100 and fixes BYN300 despite old payroll setting',async()=>{
 projectCurrency='BYN';fxCalls=0;writes=0;
 assert.equal((await createPaymentCore(actor,input)).ok,true);assert.equal(fxCalls,1);assert.equal(writes,1);
 assert.equal(saved.currency,'USD');assert.equal(saved.amount,100);assert.equal(saved.rate,3);assert.equal(saved.bynAmount,300);assert.equal(saved.projectAmount,300);
});

test('USD expense uses one physical FX rate and internal BYN cap without reading legacy setting',async()=>{
 projectCurrency='BYN';fxCalls=0;writes=0;
 assert.equal((await createPaymentCore(actor,{...input,direction:'EXPENSE',expenseArticleId:'article'})).ok,true);
 assert.equal(fxCalls,1);assert.equal(writes,1);assert.equal(saved.currency,'USD');assert.equal(saved.bynAmount,300);
});
