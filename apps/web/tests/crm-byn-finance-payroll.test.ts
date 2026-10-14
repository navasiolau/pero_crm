import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { sumHistoricalByn, subtractByn } from '../src/lib/history-byn';
import { groupHistoricalByn, payrollAmount, requirePayrollReadScope, summarizePayrollHistory,
 type PayrollHistoryRow, type PayoutHistoryRow } from '../src/server/payroll/summary-read-model';
const require = createRequire(import.meta.url);
const filename=require.resolve('../src/lib/prisma');const stub=new Module(filename);stub.filename=filename;stub.loaded=true;
const d=(n:string)=>new Prisma.Decimal(n);
type Entry=PayrollHistoryRow & {amount:Prisma.Decimal;currency:string;bynAmount:Prisma.Decimal|null};
type Paid=PayoutHistoryRow & {amount:Prisma.Decimal;payrollCurrency:string|null;bynAmount:Prisma.Decimal|null};
type User={id:string;name:string;active:boolean;payScheme:string;payPercent:Prisma.Decimal|null;roles:string[]};
let entries:Entry[]=[{userId:'u',month:'2020-01',scheme:'PIECE',amount:d('100'),currency:'USD',bynAmount:d('300')}];
let payouts:Paid[]=[];
let users:User[]=[{id:'u',name:'User',active:true,payScheme:'PIECE',payPercent:null,roles:['WORKER']}];
const reads={payrollHistory:0,payoutHistory:0,payoutDetails:0};
type ReadArgs={where?:Record<string,unknown>;select?:Record<string,unknown>;include?:Record<string,unknown>};
const matches=(row:{userId:string;month:string},where?:Record<string,unknown>)=> {
 if (!where) return true;
 if (where.userId && row.userId !== where.userId) return false;
 if (!where.month) return true;
 if(typeof where.month==='object') {
  const period=where.month as {lt?:string;lte?:string};
  return period.lt!==undefined?row.month<period.lt:period.lte!==undefined?row.month<=period.lte:false;
 }
 return row.month===where.month;
};
const userMatches=(row:User,where?:Record<string,unknown>):boolean=>{
 if(!where)return true;
 if(Array.isArray(where.OR))return where.OR.some(condition=>userMatches(row,condition));
 if(where.id&&!((where.id as {in:string[]}).in.includes(row.id)))return false;
 if(where.active!==undefined&&row.active!==where.active)return false;
 if(where.payScheme!==undefined&&(typeof where.payScheme==='string'?row.payScheme!==where.payScheme:row.payScheme===(where.payScheme as {not:string}).not))return false;
 if(where.payPercent!==undefined&&Number(row.payPercent??0)<=(where.payPercent as {gt:number}).gt)return false;
 return true;
};
const tx={
 payrollEntry:{findMany:async(args:ReadArgs)=>{reads.payrollHistory++;return entries.filter(row=>matches(row,args.where)).map((row,index)=>({id:'entry-'+index,comment:null,createdAt:new Date('2026-09-01T00:00:00Z'),...row}));}},
 payout:{findMany:async(args:ReadArgs)=>{
  if(args.include)reads.payoutDetails++;else reads.payoutHistory++;
  return payouts.filter(row=>matches(row,args.where)).map((row,index)=>({id:'payout-'+index,comment:null,createdAt:new Date('2026-09-01T00:00:00Z'),createdById:'u',cashCurrency:'BYN',cashAmount:row.bynAmount,cashAccount:{name:'Fixture cash'},user:users.find(user=>user.id===row.userId),...row}));
 }},
 payment:{aggregate:async(args:{where:{direction:string}})=>({_sum:{bynAmount:d(args.where.direction==='INCOME'?'1000':'50')}})},
 user:{findMany:async(args?:ReadArgs)=>users.filter(row=>userMatches(row,args?.where)).sort((a,b)=>a.name.localeCompare(b.name))},
 orgSetting:{findUnique:async()=>{throw new Error('History must not read setting')}},
};
stub.exports={prisma:tx};require.cache[filename]=stub;
const queries=require('../src/server/payroll/queries') as typeof import('../src/server/payroll/queries');
const { getEmployeeDues, getOrgBalance } = queries;

// Эталон прежних private groupPayroll/groupPayout: отдельный filter для каждого ID.
function previousGroup<Row extends Parameters<typeof sumHistoricalByn>[0][number] & {userId:string}>(rows:readonly Row[]) {
 return new Map([...new Set(rows.map(row=>row.userId))].map(id=>[id,sumHistoricalByn(rows.filter(row=>row.userId===id))]));
}
function previousSummary(ledger:readonly PayrollHistoryRow[],payments:readonly PayoutHistoryRow[],selected:string,current:string,userScope:string|null=null) {
 const ownEntries=ledger.filter(row=>userScope===null||row.userId===userScope);
 const ownPayouts=payments.filter(row=>userScope===null||row.userId===userScope);
 return {selectedMonth:selected,currentPeriod:current,userScope,
  accrued:previousGroup(ownEntries.filter(row=>row.month===selected)),
  paid:previousGroup(ownPayouts.filter(row=>row.month===selected)),
  advances:previousGroup(ownPayouts.filter(row=>row.month===selected&&row.kind==='ADVANCE')),
  pastAccrued:previousGroup(ownEntries.filter(row=>row.month<current)),
  estimates:previousGroup(ownEntries.filter(row=>row.month===current)),
  turnoverAccrued:previousGroup(ownEntries.filter(row=>row.month===selected&&row.scheme==='PERCENT_TURNOVER')),
  totalPaid:previousGroup(ownPayouts),allPaid:sumHistoricalByn(payments)};
}
test('one-pass periods equal the former Decimal/null selectors for mixed and scoped history',()=>{
 const ledger:PayrollHistoryRow[]=[
  {userId:'fixed',month:'2026-09',scheme:'PIECE',amount:'100.005',currency:'BYN',bynAmount:null},
  {userId:'fixed',month:'2026-09',scheme:'PIECE',amount:'-0.005',currency:'BYN',bynAmount:null},
  {userId:'fixed',month:'2026-10',scheme:'PERCENT_TURNOVER',amount:'4',currency:'USD',bynAmount:'12.345'},
  {userId:'fixed',month:'2026-11',scheme:'PIECE',amount:'15',currency:'BYN',bynAmount:'15'},
  {userId:'unknown',month:'2026-09',scheme:'ENGINEERING',amount:'20',currency:'USD',bynAmount:null},
  {userId:'unknown',month:'2026-10',scheme:'PIECE',amount:'11.005',currency:'BYN',bynAmount:'11.005'},
  {userId:'zero',month:'2026-09',scheme:'PERCENT_TURNOVER',amount:'999',currency:'USD',bynAmount:'0'},
  {userId:'zero',month:'2026-09',scheme:'PERCENT_TURNOVER',amount:'-3',currency:'BYN',bynAmount:'-3'},
  {userId:'zero',month:'2026-09',scheme:'PERCENT_TURNOVER',amount:'3',currency:'BYN',bynAmount:'3'},
 ];
 const payments:PayoutHistoryRow[]=[
  {userId:'fixed',month:'2026-09',kind:'SALARY',amount:'10',payrollCurrency:'USD',bynAmount:'30.015'},
  {userId:'fixed',month:'2026-10',kind:'ADVANCE',amount:'2.005',payrollCurrency:'BYN',bynAmount:null},
  {userId:'fixed',month:'2026-11',kind:'SALARY',amount:'1',payrollCurrency:'BYN',bynAmount:'1'},
  {userId:'zero',month:'2026-09',kind:'ADVANCE',amount:'999',payrollCurrency:null,bynAmount:'0'},
  {userId:'unknown',month:'2026-11',kind:'SALARY',amount:'7',payrollCurrency:null,bynAmount:null},
 ];
 for(const selected of ['2026-09','2026-10','2026-11']) for(const scope of [null,'fixed','unknown','absent']) {
  const actual=summarizePayrollHistory(ledger,payments,selected,'2026-10',scope);
  assert.deepEqual(actual,previousSummary(ledger,payments,selected,'2026-10',scope));
  const expected=previousSummary(ledger,payments,selected,'2026-10',scope);
  for(const id of ['fixed','unknown','zero','absent']) assert.equal(
   subtractByn(payrollAmount(actual.pastAccrued,id),payrollAmount(actual.totalPaid,id)),
   subtractByn(payrollAmount(expected.pastAccrued,id),payrollAmount(expected.totalPaid,id)));
 }
 const model=summarizePayrollHistory(ledger,payments,'2026-09','2026-10');
 assert.equal(model.turnoverAccrued.get('zero'),0);
 assert.equal(payrollAmount(model.accrued,'absent'),0);
 assert.equal(model.accrued.get('unknown'),null);
 assert.equal(model.estimates.get('unknown'),11.01);
 assert.equal(model.allPaid,null);
});

test('global payout total preserves original Decimal rounding instead of summing rounded employees',()=>{
 const payments:PayoutHistoryRow[]=['one','two'].map(userId=>({userId,month:'2026-09',kind:'SALARY',amount:'0.015',payrollCurrency:'BYN',bynAmount:null}));
 const model=summarizePayrollHistory([],payments,'2026-09','2026-10','one');
 assert.equal(model.totalPaid.get('one'),0.02);
 assert.equal(model.totalPaid.has('two'),false);
 assert.equal(model.allPaid,0.03);
 assert.equal(model.allPaid,sumHistoricalByn(payments));
});

test('unknown buckets short circuit and unrelated future entries are never converted',()=>{
 const invalid:PayrollHistoryRow={userId:'unknown',month:'2026-09',scheme:'PIECE',currency:'BYN',bynAmount:null,
  get amount():string {throw Error('LATE_UNKNOWN_AMOUNT_READ');}};
 const future:PayrollHistoryRow={userId:'future',month:'2026-11',scheme:'PIECE',currency:'BYN',bynAmount:null,
  get amount():string {throw Error('UNRELATED_FUTURE_AMOUNT_READ');}};
 const ledger:PayrollHistoryRow[]=[{userId:'unknown',month:'2026-09',scheme:'PIECE',amount:'10',currency:'USD',bynAmount:null},invalid,future];
 assert.deepEqual(groupHistoricalByn(ledger.slice(0,2)),previousGroup(ledger.slice(0,2)));
 assert.deepEqual(summarizePayrollHistory(ledger,[],'2026-09','2026-10'),previousSummary(ledger,[],'2026-09','2026-10'));
});

test('request snapshot rejects selected-month and employee-scope mismatch',()=>{
 const model=summarizePayrollHistory([],[],'2026-09','2026-10','one');
 assert.doesNotThrow(()=>requirePayrollReadScope(model,'2026-09','one'));
 assert.throws(()=>requirePayrollReadScope(model,'2026-10','one'),/другому периоду/);
 assert.throws(()=>requirePayrollReadScope(model,'2026-09'),/сотруднику/);
 assert.throws(()=>requirePayrollReadScope(model,'2026-09','one','2026-11'),/другому периоду/);
});

test('row visits stay linear as employees and history grow tenfold; measured timing is informational',()=>{
 const measure=(employeeCount:number)=>{
  let visits=0;
  const ledger:PayrollHistoryRow[]=Array.from({length:employeeCount*10},(_,index)=>{
   const id='employee-'+index%employeeCount;
   return {get userId(){visits++;return id;},month:'2026-09',scheme:'PIECE',amount:'0.015',currency:'BYN',bynAmount:null};
  });
  const start=performance.now(),actual=groupHistoricalByn(ledger),after=performance.now();
  const linearVisits=visits;visits=0;
  const expected=previousGroup(ledger),end=performance.now(),previousVisits=visits;
  assert.deepEqual(actual,expected);
  assert.ok(linearVisits<=ledger.length*2);
  assert.ok(previousVisits>=employeeCount*ledger.length);
  visits=0;summarizePayrollHistory(ledger,[],'2026-09','2026-10');
  assert.ok(visits<=ledger.length*2);
  return {employeeCount,rows:ledger.length,linearVisits,previousVisits,linearMs:after-start,previousMs:end-after};
 };
 const small=measure(20),large=measure(200);
 assert.equal(large.rows,small.rows*10);assert.equal(large.linearVisits,small.linearVisits*10);
 console.log(JSON.stringify({payroll149Benchmark:[small,large]}));
});

test('one finance request reuses exactly two history reads for 1/5/20 employees, retaining debt membership and roles',async()=>{
 const selected='2020-01',current=queries.currentMonth(),counts:number[]=[];
 for(const size of [1,5,20]) {
  users=Array.from({length:size},(_,index)=>({id:'u'+index,name:'User '+String(index).padStart(2,'0'),
   active:index!==0,payScheme:index===0?'NONE':index%3===0?'PERCENT_TURNOVER':'PIECE',
   payPercent:index%3===0?d('3'):null,roles:index===3?['ENGINEER']:['MANAGER','ENGINEER']}));
  entries=users.flatMap(user=>[
   {userId:user.id,month:selected,scheme:'PERCENT_TURNOVER',amount:d('25'),currency:'USD',bynAmount:d('75')},
   {userId:user.id,month:current,scheme:'ENGINEERING',amount:d('6.005'),currency:'BYN',bynAmount:null},
  ]);
  payouts=users.map(user=>({userId:user.id,month:selected,kind:'ADVANCE',amount:d('2'),payrollCurrency:'USD',bynAmount:d('6')}));
  Object.assign(reads,{payrollHistory:0,payoutHistory:0,payoutDetails:0});
  const snapshot=await queries.readPayrollSummary(selected);
  const expected=previousSummary(entries,payouts,selected,current);
  assert.deepEqual(snapshot,expected);
  const [summary,dues,estimates,eligible,balance,turnover]=await Promise.all([
   queries.getPayrollSummary(selected,snapshot),getEmployeeDues(snapshot),queries.getCurrentMonthEstimates(snapshot),
   queries.listPayrollUsers(snapshot),getOrgBalance(snapshot),queries.getTurnoverAccruals(selected,snapshot),
  ]);
  assert.equal(reads.payrollHistory,1);assert.equal(reads.payoutHistory,1);assert.equal(reads.payoutDetails,1);
  counts.push(reads.payrollHistory+reads.payoutHistory);
  assert.deepEqual(summary.rows.map(row=>({userId:row.userId,accrued:row.accrued,paid:row.paid,advance:row.advance,due:row.due})),
   users.map(user=>({userId:user.id,accrued:payrollAmount(expected.accrued,user.id),paid:payrollAmount(expected.paid,user.id),
    advance:payrollAmount(expected.advances,user.id),due:subtractByn(payrollAmount(expected.pastAccrued,user.id),payrollAmount(expected.totalPaid,user.id))})));
  assert.deepEqual(dues,users.map(user=>({userId:user.id,name:user.name,due:69})));
  assert.deepEqual(estimates,Object.fromEntries(expected.estimates));
  assert.ok(eligible.some(user=>user.id==='u0'));
  assert.equal(balance,subtractByn(950,expected.allPaid));
  assert.ok(!turnover.some(user=>user.userId==='u3'));
  assert.deepEqual(await queries.getPayrollSummary(selected),summary);
 }
 assert.deepEqual(counts,[2,2,2]);
 console.log(JSON.stringify({payroll149HistoryDelegateCounts:counts,actualSql:'NOT_RUN'}));
});

test('personal month totals reuse selected detail rows and keep fixed history within employee scope',async()=>{
 const current=queries.currentMonth();
 users=[{id:'u',name:'User',active:true,payScheme:'PIECE',payPercent:null,roles:['WORKER']}];
 entries=[
  {userId:'u',month:'2020-01',scheme:'PIECE',amount:d('100'),currency:'USD',bynAmount:d('300')},
  {userId:'u',month:current,scheme:'ENGINEERING',amount:d('10.005'),currency:'BYN',bynAmount:null},
  {userId:'u',month:'2999-01',scheme:'PIECE',amount:d('9'),currency:'USD',bynAmount:null},
  {userId:'foreign',month:'2020-01',scheme:'PIECE',amount:d('999'),currency:'BYN',bynAmount:d('999')},
 ];
 payouts=[
  {userId:'u',month:'2020-01',kind:'SALARY',amount:d('20'),payrollCurrency:'USD',bynAmount:d('60')},
  {userId:'u',month:current,kind:'ADVANCE',amount:d('2'),payrollCurrency:'BYN',bynAmount:null},
  {userId:'foreign',month:'2020-01',kind:'SALARY',amount:d('999'),payrollCurrency:null,bynAmount:null},
 ];
 for(const month of ['2020-01',current,'2999-01']) {
  Object.assign(reads,{payrollHistory:0,payoutHistory:0,payoutDetails:0});
  const actual=await queries.getMyPayroll('u',month);
  const ownEntries=entries.filter(row=>row.userId==='u'),ownPayouts=payouts.filter(row=>row.userId==='u');
  assert.deepEqual({accrued:actual.accrued,paid:actual.paid,debt:actual.debt,estimate:actual.estimate},{
   accrued:sumHistoricalByn(ownEntries.filter(row=>row.month===month)),paid:sumHistoricalByn(ownPayouts.filter(row=>row.month===month)),
   debt:subtractByn(sumHistoricalByn(ownEntries.filter(row=>row.month<current)),sumHistoricalByn(ownPayouts)),
   estimate:sumHistoricalByn(ownEntries.filter(row=>row.month===current)),
  });
  assert.equal(reads.payrollHistory,2);assert.equal(reads.payoutHistory,1);assert.equal(reads.payoutDetails,1);
  assert.equal(actual.entries.length,ownEntries.filter(row=>row.month===month).length);
  assert.equal(actual.payouts.length,ownPayouts.filter(row=>row.month===month).length);
 }
});
