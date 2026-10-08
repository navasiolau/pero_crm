import assert from "node:assert/strict";
import test from "node:test";
import { calendarDateRange } from "../src/lib/calendar-dates";
import { formatExactMoney } from "../src/lib/format";
import { buildCashStatement, loadCashStatement, type CashStatementFact } from "../src/server/finance/cash-statement";
const account={id:"cash",name:"Касса",currency:"BYN",active:true};
const query={from:"2026-10-07",to:"2026-10-07",mode:"BYN" as const};
function fact(id:string,at:string,amount:string|null,direction:"INCOME"|"EXPENSE"="INCOME",source:"PAYMENT"|"SALARY"|"ADVANCE"="PAYMENT"):CashStatementFact {
 return {id,source,accountId:"cash",at,direction,nativeAmount:amount,nativeCurrency:"BYN",bynAmount:amount,label:source,comment:null,project:null,document:null};
}
test("MSK inclusive days include both midnight edges and validate calendar dates",()=>{
 const range=calendarDateRange(query.from,query.to);
 assert.equal(range.start.toISOString(),"2026-10-06T21:00:00.000Z");
 assert.equal(range.end.toISOString(),"2026-10-07T21:00:00.000Z");
 assert.throws(()=>calendarDateRange("2026-02-30","2026-03-01"));
 assert.throws(()=>calendarDateRange("2026-10-08","2026-10-07"));
});
test("opening plus income minus payment/salary/advance gives closing once",()=>{
 const data=buildCashStatement([account],[
  fact("opening","2026-10-06T20:59:59.999Z","100"),
  fact("in","2026-10-06T21:00:00.000Z","50"),
  fact("out","2026-10-07T00:00:00.000Z","10","EXPENSE"),
  fact("salary","2026-10-07T10:00:00.000Z","20","EXPENSE","SALARY"),
  fact("advance","2026-10-07T20:59:59.999Z","5","EXPENSE","ADVANCE"),
  fact("tomorrow","2026-10-07T21:00:00.000Z","999"),
 ],query);
 assert.deepEqual(data.rows[0].totals,{opening:"100.00",income:"50.00",expense:"-35.00",closing:"115.00"});
 assert.equal(data.rows[0].entries.length,4);
 assert.equal(data.totals[0].closing,"115.00");
});
test("native currencies stay separate and BYN uses the fixed saved equivalent",()=>{
 const usd={...account,id:"usd",currency:"USD",active:false};
 const facts=[fact("byn","2026-10-07T10:00:00Z","10"),{...fact("usd","2026-10-07T10:00:00Z","100"),accountId:"usd",nativeCurrency:"USD",bynAmount:"300"}];
 const native=buildCashStatement([account,usd],facts,{...query,mode:"NATIVE"});
 assert.deepEqual(native.totals.map(row=>[row.currency,row.closing]),[["BYN","10.00"],["USD","100.00"]]);
 assert.equal(buildCashStatement([account,usd],facts,query).totals[0].closing,"310.00");
});
test("historical unknown affects dependent totals but not known period movement; no-cash remains explicit",()=>{
 const data=buildCashStatement([account],[fact("unknown","2026-10-01T00:00:00Z",null),
  fact("known","2026-10-07T00:00:00Z","50"),{...fact("unassigned","2026-10-07T00:00:00Z","5","EXPENSE","ADVANCE"),accountId:null}],query);
 assert.equal(data.rows[0].totals.opening,null);assert.equal(data.rows[0].totals.income,"50.00");assert.equal(data.rows[0].totals.closing,null);
 assert.equal(data.rows.find(row=>row.unassigned)?.totals.closing,"-5.00");
 const mismatch=buildCashStatement([account],[{...fact("foreign","2026-10-07T00:00:00Z","10"),nativeCurrency:"USD"}],{...query,mode:"NATIVE"});
 assert.equal(mismatch.rows[0].totals.closing,null);
 assert.ok(mismatch.rows[0].entries[0].issues.length>0);
});
test("empty accounts have confirmed zeros and exact money formatting retains large cents",()=>{
 assert.equal(buildCashStatement([account],[],query).rows[0].totals.closing,"0.00");
 const data=buildCashStatement([account],[fact("big","2026-10-07T00:00:00Z","90071992547409.91"),fact("cents","2026-10-07T00:00:00Z","0.02")],query);
 assert.equal(data.rows[0].totals.closing,"90071992547409.93");
 assert.match(formatExactMoney(data.rows[0].totals.closing,"BYN"),/409,93 BYN$/);
 assert.match(formatExactMoney("-0.01","BYN"),/−0,01/);
});
test("nonfinancial loader refuses before reading money",async()=>{
 let reads=0;const db=new Proxy({},{get(){reads++;throw Error("unexpected query");}}) as Parameters<typeof loadCashStatement>[2];
 await assert.rejects(loadCashStatement({id:"m",roles:["MANAGER"]},query,db),/прав/);assert.equal(reads,0);
});
