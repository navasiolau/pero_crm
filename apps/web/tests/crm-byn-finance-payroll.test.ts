import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
const require = createRequire(import.meta.url);
const filename=require.resolve('../src/lib/prisma');const stub=new Module(filename);stub.filename=filename;stub.loaded=true;
const d=(n:string)=>new Prisma.Decimal(n);
let entries=[{userId:'u',month:'2020-01',amount:d('100'),currency:'USD',bynAmount:d('300')}];
let payouts: {userId:string;month:string;amount:Prisma.Decimal;payrollCurrency:string|null;bynAmount:Prisma.Decimal|null}[]=[];
const matches=(row:{userId:string;month:string},where?:Record<string,unknown>)=> {
 if (!where) return true;
 if (where.userId && row.userId !== where.userId) return false;
 if (!where.month) return true;
 return typeof where.month === 'object' ? row.month < (where.month as {lt:string}).lt : row.month === where.month;
};
const tx={
 payrollEntry:{findMany:async(args:{where?:Record<string,unknown>})=>entries.filter(row=>matches(row,args.where))},
 payout:{findMany:async(args:{where?:Record<string,unknown>})=>payouts.filter(row=>matches(row,args.where))},
 payment:{aggregate:async(args:{where:{direction:string}})=>({_sum:{bynAmount:d(args.where.direction==='INCOME'?'1000':'50')}})},
 user:{findMany:async()=>[{id:'u',name:'User'}]},
 orgSetting:{findUnique:async()=>{throw new Error('History must not read setting')}},
};
stub.exports={prisma:tx};require.cache[filename]=stub;
const {getEmployeeDues,getOrgBalance,getPayrollCurrency}=require('../src/server/payroll/queries') as typeof import('../src/server/payroll/queries');
const {readOrgBalance}=require('../src/server/payroll/cash-core') as typeof import('../src/server/payroll/cash-core');
test('mixed history debt and org balance consume fixed BYN, not source amounts',async()=>{
 payouts=[{userId:'u',month:'2020-01',amount:d('20'),payrollCurrency:'USD',bynAmount:d('60')}];
 assert.equal((await getEmployeeDues())[0].due,240);assert.equal(await getOrgBalance(),890);
 assert.equal((await readOrgBalance(tx as unknown as Prisma.TransactionClient,'9','0','30')).toFixed(2),'860.00');
 assert.equal(await getPayrollCurrency(),'BYN');
});
test('legacy payout without currency or snapshot makes only dependent totals unavailable and writer fails closed',async()=>{
 payouts=[{userId:'u',month:'2020-01',amount:d('20'),payrollCurrency:null,bynAmount:null}];
 assert.equal((await getEmployeeDues())[0].due,null);assert.equal(await getOrgBalance(),null);
 await assert.rejects(readOrgBalance(tx as unknown as Prisma.TransactionClient,'1'),/сохранённого BYN/);
});
test('zero fixed payout and zero fixed foreign accrual are valid evidence',async()=>{
 payouts=[{userId:'u',month:'2020-01',amount:d('20'),payrollCurrency:null,bynAmount:d('0')}];
 entries=[{userId:'u',month:'2020-01',amount:d('100'),currency:'USD',bynAmount:d('0')}];
 assert.deepEqual(await getEmployeeDues(),[]);assert.equal(await getOrgBalance(),950);
});
