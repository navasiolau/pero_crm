import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
const require = createRequire(import.meta.url);
const filename = require.resolve('../src/lib/prisma');
const stub = new Module(filename); stub.filename=filename; stub.loaded=true;
const d=(n:string)=>new Prisma.Decimal(n);
let foreign=false; let price: Prisma.Decimal | null=d("1000");
stub.exports={prisma:{
 project:{findUnique:async()=>({id:'p',currency:'BYN',delivery:d('0'),unloading:d('0'),installation:d('0'),products:[{expectedPrice:price,quantity:1}]})},
 payment:{findMany:async()=>[{direction:'INCOME',projectAmount:d('100'),bynAmount:d('300'),expenseArticle:null}]},
 payrollEntry:{findMany:async(args: {where:Record<string,unknown>})=>{assert.equal(args.where.settlementShareId,null);if (process.env.CRM_BYN_BASELINE !== '1') assert.equal(args.where.percentageCompletionShareId,null);return [{amount:d('10'),currency:foreign?'USD':'BYN',bynAmount:null}]}},
 stockMovement:{findMany:async()=>[{type:'EXPENSE',totalByn:d('20')},{type:'RETURN',totalByn:d('5')}]},
 productStageSettlement:{findMany:async()=>[{bynAmount:d('30'),projectAmount:d('10'),productCurrency:'BYN'}]},
 productPercentageCompletion:{findMany:async()=>[{amount:d('20'),bynAmount:d('60'),payrollCurrency:'USD'}]},
}}; require.cache[filename]=stub;
const {getProjectEconomics}=require(process.env.CRM_BYN_BASELINE === '1' ? '../src/server/finance/crm-byn-finance-baseline' : '../src/server/finance/queries') as typeof import('../src/server/finance/queries');
test('project economics uses fixed BYN and full snapshots once, without live FX',async()=>{
 foreign=false; const result=await getProjectEconomics('p');
 assert.equal(result?.paidTotal,300);assert.equal(result?.expensesTotal,15);assert.equal(result?.payrollTotal,100);assert.equal(result?.margin,185);
});
test('unknown foreign salary only invalidates dependent payroll and margins',async()=>{
 foreign=true;const result=await getProjectEconomics('p');
 assert.equal(result?.paidTotal,300);assert.equal(result?.expensesTotal,15);assert.equal(result?.payrollTotal,null);assert.equal(result?.margin,null);assert.equal(result?.marginAtFullPrice,null);assert.ok(result?.unavailableReason);
});

test('confirmed zero expected price differs from missing price',async()=>{
 foreign=false;price=d('0');assert.equal((await getProjectEconomics('p'))?.expectedPrice,0);
 price=null;assert.equal((await getProjectEconomics('p'))?.expectedPrice,null);
 price=d('1000');
});

test('preloaded ledger facts are the economics source without a second payment or stock query',async()=>{
 foreign=false;
 const database={...stub.exports.prisma,payment:{findMany:()=>assert.fail('duplicate payment read')},stockMovement:{findMany:()=>assert.fail('duplicate stock read')}} as Parameters<typeof getProjectEconomics>[1];
 const facts={payments:[{direction:'INCOME',bynAmount:d('300'),expenseArticle:null},{direction:'EXPENSE',bynAmount:d('10'),expenseArticle:{id:'a',name:'Delivery'}}],stockMovements:[{type:'EXPENSE',totalByn:d('60')},{type:'RETURN',totalByn:d('20')}]};
 const result=await getProjectEconomics('p',database,facts);
 assert.equal(result?.expensesTotal,50);assert.equal(result?.paidTotal,300);
 assert.equal(result?.expenseBreakdown.find(row=>row.key==='warehouse')?.amount,40);
 assert.equal(result?.expenseBreakdown.find(row=>row.key==='article:a')?.amount,10);
});
