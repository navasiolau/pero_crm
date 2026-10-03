import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Prisma} from '@prisma/client';
import {deletePaymentInTransaction} from '../src/server/payments/delete-core';
test('actual nullable-project deletion preserves cash/org ceilings and financial role boundary',async()=>{
 let deletes=0,audits=0,balance=100;const payment={id:'general',project:null,direction:'INCOME',cashAccountId:'cash',amount:new Prisma.Decimal(100),currency:'USD',bynAmount:new Prisma.Decimal(300)};
 const db={payment:{findUnique:async()=>payment,groupBy:async()=>[{direction:'INCOME',_sum:{amount:balance}}],aggregate:async({where}:{where:{direction:string}})=>({_sum:{bynAmount:where.direction==='INCOME'?300:0}}),delete:async()=>{deletes++;return payment;}},payout:{aggregate:async()=>({_sum:{cashAmount:0}}),findMany:async()=>[]},orgSetting:{findUnique:async()=>({value:'BYN'})},changeLog:{create:async({data}:{data:{oldValue:{project:unknown}}})=>{assert.equal(data.oldValue.project,null);audits++;return{id:'audit'};}}} as unknown as Prisma.TransactionClient;
 const actor={id:'a',name:'A',roles:['ACCOUNTANT' as const],source:'web' as const};await assert.rejects(deletePaymentInTransaction({...actor,roles:['MANAGER']},'general','INCOME','BYN','1',db),/прав/);assert.equal(deletes+audits,0);balance=99;await assert.rejects(deletePaymentInTransaction(actor,'general','INCOME','BYN','1',db),/остаток кассы/);assert.equal(deletes+audits,0);balance=100;assert.equal((await deletePaymentInTransaction(actor,'general','INCOME','BYN','1',db)).id,'general');assert.equal(deletes,1);assert.equal(audits,1);
});
