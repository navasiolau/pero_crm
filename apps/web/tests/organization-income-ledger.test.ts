import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Prisma} from '@prisma/client';
import {readCashBalance,readOrgBalance} from '../src/server/payroll/cash-core';
import {loadOrganizationIncome} from '../src/server/finance/income-ledger';
import {paymentSchema} from '../src/server/payments/core';
import {readFileSync} from 'node:fs';
test('actual cash/org aggregates include general income once and preserve unknown historic payout refusal',async()=>{
 const rows=[{projectId:null,direction:'INCOME',cashAccountId:'cash',amount:100,bynAmount:300},{projectId:'j',direction:'INCOME',cashAccountId:'cash',amount:10,bynAmount:30}];let unknown=false;
 const db={payment:{aggregate:async({where}:{where:{direction:string}})=>({_sum:{bynAmount:rows.filter(r=>r.direction===where.direction).reduce((a,r)=>a+r.bynAmount,0)}}),groupBy:async()=>[{direction:'INCOME',_sum:{amount:110}}]},payout:{aggregate:async()=>({_sum:{cashAmount:0}}),findMany:async()=>unknown?[{amount:1,payrollCurrency:null,bynAmount:null}]:[]}} as unknown as Prisma.TransactionClient;
 assert.equal((await readCashBalance(db,'cash')).toFixed(2),'110.00');assert.equal((await readOrgBalance(db,'1')).toFixed(2),'330.00');unknown=true;await assert.rejects(readOrgBalance(db,'1'),/BYN/);
});
test('general payment context is accepted and forward migration preserves nullable pair without rewriting history',()=>{
 for(const direction of ['INCOME','EXPENSE'])assert.equal(paymentSchema.safeParse({direction,amount:1,currency:'BYN',cashAccountId:'cash'}).success,true);
 const sql=readFileSync('prisma/migrations/20261008120000_organization_expenses/migration.sql','utf8');
 assert.match(sql,/"projectId" IS NULL\) = \("projectAmount" IS NULL/);assert.doesNotMatch(sql,/UPDATE|DELETE|TRUNCATE/i);
});
test('income loader refuses nonfinance before read and keeps general project nullable',async()=>{let reads=0;const db={payment:{findMany:async()=>{reads++;return[{id:'pay',amount:new Prisma.Decimal(100),currency:'USD',rate:new Prisma.Decimal(3),rateDate:null,bynAmount:new Prisma.Decimal(300),paidAt:new Date(),comment:null,project:null,cashAccount:{name:'USD'}}]}},cashAccount:{findMany:async()=>[]},expenseArticle:{findMany:async()=>{throw Error('income loader must not query expense articles')}},project:{findMany:async()=>[]}} as unknown as Parameters<typeof loadOrganizationIncome>[1];await assert.rejects(loadOrganizationIncome({id:'m',roles:['MANAGER']},db),/прав/);assert.equal(reads,0);const result=await loadOrganizationIncome({id:'a',roles:['ACCOUNTANT']},db);assert.equal('expenseArticles' in result,false);assert.equal(result.rows[0].project,null);assert.equal(result.rows[0].amount,100);assert.equal(result.rows[0].bynAmount,300);});
