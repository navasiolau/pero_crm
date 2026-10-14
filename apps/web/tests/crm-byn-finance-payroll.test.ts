import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sumHistoricalByn, subtractByn } from '../src/lib/history-byn';
import { groupHistoricalByn, payrollAmount, requirePayrollReadScope, summarizePayrollHistory,
 type PayrollHistoryRow, type PayoutHistoryRow } from '../src/server/payroll/summary-read-model';
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
