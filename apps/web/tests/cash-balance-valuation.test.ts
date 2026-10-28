import assert from "node:assert/strict";
import {test} from "node:test";
import {Prisma} from "@prisma/client";
import {buildCashStatement,type CashStatementFact} from "../src/server/finance/cash-statement";
import {cashStatementRateDates,fetchCashStatementRates} from "../src/server/finance/cash-statement-rates";
import {guardedModuleCache} from "./helpers/guarded-module-cache";

const query={from:"2026-10-01",to:"2026-10-12",mode:"BYN" as const};
const rub={id:"rub",name:"Касса RUB",currency:"RUB",active:true};
const rates=[{currency:"RUB",date:"2026-09-30",rate:"0.036",issue:null},{currency:"RUB",date:"2026-10-12",rate:"0.037",issue:null}];
function fact(id:string,at:string,nativeAmount:string|null,bynAmount:string|null,direction:"INCOME"|"EXPENSE"="INCOME"):CashStatementFact{
 return {id,at,nativeAmount,bynAmount,direction,accountId:rub.id,nativeCurrency:"RUB",source:"PAYMENT",label:"Операция",comment:null,project:null,document:null};
}
function reconciles(totals:{opening:string|null;income:string|null;expense:string|null;revaluation:string|null;closing:string|null}){
 assert.notEqual(totals.opening,null);assert.notEqual(totals.income,null);assert.notEqual(totals.expense,null);assert.notEqual(totals.revaluation,null);
 assert.equal(new Prisma.Decimal(totals.opening!).add(totals.income!).add(totals.expense!).add(totals.revaluation!).toFixed(2),totals.closing);
}

// Демонстрация механизма 0,67; эти записи не являются сверкой production.
test("zero RUB closes at zero BYN and historical 0.67 is shown as revaluation",()=>{
 const data=buildCashStatement([rub],[fact("opening","2026-09-29T10:00:00Z","1000","36"),fact("expense","2026-10-07T10:00:00Z","1000","36.67","EXPENSE")],query,rates);
 assert.deepEqual(data.rows[0].totals,{opening:"36.00",income:"0.00",expense:"-36.67",revaluation:"0.67",closing:"0.00"});
 assert.equal(data.rows[0].entries[0].change,"-36.67");
 assert.equal(data.rows[0].valuation?.closing.nativeAmount,"0.00");
 assert.equal(data.rows[0].valuation?.closing.rate,null);
 reconciles(data.rows[0].totals);reconciles(data.totals[0]);
});

test("observed report totals explain minus 0.67 while new closing values the actual zero RUB",()=>{
 // Анонимизированные суммы из read-only production-отчёта, переданные оркестратором.
 // Здесь курс оценки 30 сентября является тестовым: raw rateDate/rate в отчёте не раскрыты.
 const facts=[fact("old-expense","2026-09-19T10:00:00Z","25000","899.75","EXPENSE"),
  fact("expense","2026-10-07T10:00:00Z","55000","1972.85","EXPENSE"),
  fact("income-one","2026-10-12T10:00:00Z","25000","897.48"),fact("income-two","2026-10-12T11:00:00Z","55000","1974.45")];
 const native=buildCashStatement([rub],facts,{...query,mode:"NATIVE"}).rows[0];
 assert.equal(native.totals.opening,"-25000.00");assert.equal(native.totals.income,"80000.00");assert.equal(native.totals.expense,"-55000.00");assert.equal(native.totals.closing,"0.00");
 assert.equal(new Prisma.Decimal("-899.75").add("2871.93").sub("1972.85").toFixed(2),"-0.67");
 const byn=buildCashStatement([rub],facts,query,rates).rows[0];
 assert.deepEqual(byn.totals,{opening:"-900.00",income:"2871.93",expense:"-1972.85",revaluation:"0.92",closing:"0.00"});
 reconciles(byn.totals);
});

test("Moscow edges use previous calendar day and inclusive final date rates",()=>{
 const data=buildCashStatement([rub],[fact("before","2026-09-30T20:59:59.999Z","100","3.5"),fact("start","2026-09-30T21:00:00.000Z","10","0.36"),fact("last","2026-10-12T20:59:59.999Z","5","0.18"),fact("after","2026-10-12T21:00:00.000Z","999","999")],query,rates);
 assert.deepEqual(data.rows[0].totals,{opening:"3.60",income:"0.54",expense:"0.00",revaluation:"0.12",closing:"4.26"});
 assert.equal(data.rows[0].entries.length,2);
 assert.equal(data.rows[0].valuation?.opening.date,"2026-09-30");
 assert.equal(data.rows[0].valuation?.closing.rateDate,"2026-10-12");
 assert.equal(data.rows[0].valuation?.closing.rate,"0.037");
 reconciles(data.rows[0].totals);
});

test("zero balance needs no rate but a nonzero balance remains unknown on rate outage",()=>{
 const zero=buildCashStatement([rub],[],query).rows[0];
 assert.deepEqual(zero.totals,{opening:"0.00",income:"0.00",expense:"0.00",revaluation:"0.00",closing:"0.00"});
 const data=buildCashStatement([rub],[fact("income","2026-10-07T10:00:00Z","100","3.60")],query);
 assert.equal(data.rows[0].totals.opening,"0.00");assert.equal(data.rows[0].totals.income,"3.60");
 assert.equal(data.rows[0].totals.closing,null);assert.equal(data.rows[0].totals.revaluation,null);
 assert.match(data.rows[0].valuation?.closing.issue??"",/курс/i);
 assert.equal(data.valuationUnavailable,1);
});

test("missing or mismatched native history never becomes a zero while saved movement remains known",()=>{
 for(const unknown of [fact("legacy","2026-10-07T10:00:00Z",null,"3.60","EXPENSE"),{...fact("mismatch","2026-10-07T10:00:00Z","100","3.60","EXPENSE"),nativeCurrency:"USD"}]){
  const data=buildCashStatement([rub],[unknown],query,rates);
  assert.equal(data.rows[0].totals.opening,"0.00");assert.equal(data.rows[0].totals.expense,"-3.60");
  assert.equal(data.rows[0].totals.closing,null);assert.equal(data.rows[0].totals.revaluation,null);
  assert.ok(data.rows[0].entries[0].issues.length>0);assert.equal(data.unknownAmounts,1);
 }
 const data=buildCashStatement([rub],[fact("old","2026-09-29T00:00:00Z",null,"3.50"),fact("known","2026-10-07T10:00:00Z","100","3.60")],query,rates);
 assert.equal(data.rows[0].totals.opening,null);assert.equal(data.rows[0].totals.closing,null);assert.equal(data.rows[0].totals.income,"3.60");
});

test("unknown saved BYN affects movements and revaluation without hiding a known physical balance",()=>{
 const data=buildCashStatement([rub],[fact("missing-byn","2026-10-07T10:00:00Z","100",null)],query,rates);
 assert.equal(data.rows[0].totals.income,null);assert.equal(data.rows[0].totals.closing,"3.70");assert.equal(data.rows[0].totals.revaluation,null);
});

test("unassigned BYN stays explicit and unsupported currency cannot claim an evaluated zero",()=>{
 const data=buildCashStatement([rub],[{...fact("unassigned","2026-10-07T10:00:00Z","10","0.36"),accountId:null}],query,rates);
 const row=data.rows.find(row=>row.unassigned)!;
 assert.equal(row.totals.income,"0.36");assert.equal(row.totals.closing,null);assert.equal(data.unassignedOperations,1);
 assert.match(row.valuation?.closing.issue??"",/касс/i);
 const native=buildCashStatement([rub],[{...fact("unassigned","2026-10-07T10:00:00Z","10","0.36"),accountId:null}],{...query,mode:"NATIVE"});
 assert.equal(native.rows.find(row=>row.unassigned)?.totals.closing,"10.00");
 const unsupported=buildCashStatement([{...rub,currency:"XXX"}],[],query,rates).rows[0];
 assert.equal(unsupported.totals.closing,null);assert.match(unsupported.valuation?.closing.issue??"",/валют/i);
});

test("Decimal valuation rounds once and reconciles large cents without Number",()=>{
 const data=buildCashStatement([rub],[fact("big","2026-09-29T10:00:00Z","90071992547409.91","900719925474.10"),fact("cents","2026-10-07T10:00:00Z","0.02","0.02")],query,rates.map(rate=>({...rate,rate:"0.01"})));
 assert.deepEqual(data.rows[0].totals,{opening:"900719925474.10",income:"0.02",expense:"0.00",revaluation:"-0.02",closing:"900719925474.10"});
 reconciles(data.rows[0].totals);
 const rounded=buildCashStatement([rub],[fact("fraction","2026-10-07T10:00:00Z","100.01","33.34")],query,rates.map(rate=>({...rate,rate:"0.333333"})));
 assert.equal(rounded.rows[0].totals.closing,"33.34");reconciles(rounded.rows[0].totals);
});

test("native mode retains physical amounts and salary/advance occur once",()=>{
 const facts=[fact("opening","2026-09-29T10:00:00Z","100","3.60"),{...fact("salary","2026-10-07T10:00:00Z","10","0.37","EXPENSE"),source:"SALARY" as const},{...fact("advance","2026-10-07T11:00:00Z","5","0.18","EXPENSE"),source:"ADVANCE" as const}];
 const native=buildCashStatement([rub],facts,{...query,mode:"NATIVE"});
 assert.equal(native.rows[0].totals.opening,"100.00");assert.equal(native.rows[0].totals.expense,"-15.00");assert.equal(native.rows[0].totals.closing,"85.00");
 assert.equal(native.rows[0].valuation,null);assert.equal(native.rows[0].entries.length,2);
 const byn=buildCashStatement([rub],facts,query,rates);
 assert.equal(byn.rows[0].totals.expense,"-0.55");assert.equal(byn.rows[0].totals.closing,"3.15");reconciles(byn.rows[0].totals);
});

test("dated rates are unique, independent of host timezone, and divided exactly",async()=>{
 assert.deepEqual(cashStatementRateDates("2026-01-01","2026-01-02"),{opening:"2025-12-31",closing:"2026-01-02"});
 assert.deepEqual(cashStatementRateDates("2024-03-01","2024-03-01"),{opening:"2024-02-29",closing:"2024-03-01"});
 const calls:string[]=[];
 const fetchRate:typeof fetch=async(input,init)=>{
  const url=new URL(input.toString());calls.push(url.href);
  assert.equal(init?.cache,"no-store");assert.ok(init?.signal);
  return Response.json({Date:`${url.searchParams.get("ondate")}T00:00:00`,Cur_Abbreviation:url.pathname.split("/").at(-1),Cur_OfficialRate:3.1415,Cur_Scale:10000});
 };
 const requests=["RUB","RUB","USD","BYN","XXX"].flatMap(currency=>["2026-09-30","2026-10-12","2026-10-12"].map(date=>({currency,date})));
 const rates=await fetchCashStatementRates(requests,fetchRate);
 assert.equal(calls.length,4);assert.equal(new Set(calls).size,4);assert.equal(rates.length,4);
 for(const rate of rates){assert.equal(rate.rate,"0.00031415");assert.equal(rate.issue,null);}
 assert.ok(calls.every(url=>new URL(url).searchParams.get("parammode")==="2"));
});

test("invalid and unavailable dated rates produce explicit unknowns",async(t)=>{
 const valid={Date:"2026-10-12T00:00:00",Cur_Abbreviation:"RUB",Cur_OfficialRate:3.6,Cur_Scale:100};
 const invalid:Record<string,unknown>[]=[{...valid,Date:"2026-10-11T00:00:00"},{...valid,Date:"2026-10-12invalid"},{...valid,Cur_Abbreviation:"USD"},
  {...valid,Cur_Scale:0},{...valid,Cur_Scale:-100},{...valid,Cur_Scale:1.5},{...valid,Cur_OfficialRate:0},{...valid,Cur_OfficialRate:-3},
  {...valid,Cur_OfficialRate:"3.6"},{...valid,Cur_OfficialRate:null},{}];
 for(const [index,data] of invalid.entries())await t.test(`invalid-rate-${index}`,async()=>{
  const result=await fetchCashStatementRates([{currency:"RUB",date:"2026-10-12"}],async()=>Response.json(data));
  assert.equal(result[0].rate,null);assert.match(result[0].issue??"",/НБ РБ.*RUB.*2026-10-12/);
 });
 for(const fetchRate of [async()=>{throw Error("offline");},async()=>new Response("unavailable",{status:503}),async()=>new Response("not json")]){
  const result=await fetchCashStatementRates([{currency:"RUB",date:"2026-10-12"}],fetchRate);
  assert.equal(result[0].rate,null);assert.ok(result[0].issue);
 }
});

test("public report fetches rates only after the consistent read-only snapshot and preserves access",async()=>{
 let inTransaction=false,readOnly=false,transactions=0,paymentReads=0,payoutReads=0;
 const accounts=[rub,{...rub,id:"rub-two",active:false},{...rub,id:"usd",currency:"USD"}];
 let paymentsPresent=true;
 const payments=["rub","usd"].map(id=>({id,cashAccountId:id,paidAt:new Date("2026-09-29T10:00:00Z"),direction:"INCOME",amount:new Prisma.Decimal(100),currency:id.toUpperCase(),bynAmount:new Prisma.Decimal("3.60"),comment:null,
  project:null,expenseArticle:null,reportDocument:null,logisticsAllocation:null,stockPurchase:null}));
 const scope=guardedModuleCache(import.meta.url,{targets:["../src/server/finance/cash-statement"],allowedOverrides:[],overrides:{},prisma:{
  $transaction:async(operation:(tx:object)=>Promise<unknown>,options:{isolationLevel:string})=>{
   transactions++;inTransaction=true;assert.equal(options.isolationLevel,"RepeatableRead");
   try{return await operation({
    $executeRawUnsafe:async(sql:string)=>{assert.equal(sql,"SET TRANSACTION READ ONLY");readOnly=true;},
    cashAccount:{findMany:async()=>{assert.ok(readOnly&&inTransaction);return accounts;}},
    payment:{findMany:async({where}:Prisma.PaymentFindManyArgs)=>{
     paymentReads++;assert.ok(readOnly&&inTransaction);assert.equal(where?.deletionId,null);
     assert.deepEqual(where?.OR,[{logisticsAllocationId:null},{logisticsAllocation:{posting:{status:"ACTIVE",trip:{deletedAt:null}}}}]);
     return paymentsPresent?payments:[];
    }},
    payout:{findMany:async()=>{payoutReads++;assert.ok(readOnly&&inTransaction);return [];}},
   });}finally{inTransaction=false;}
  },
 }});
 await scope.run(async()=>{
  const statements=scope.load<typeof import("../src/server/finance/cash-statement")>("../src/server/finance/cash-statement");
  const requests:string[]=[];
  const fetchRate:typeof fetch=async input=>{
   assert.equal(inTransaction,false);const url=new URL(input.toString());requests.push(url.href);
   return Response.json({Date:`${url.searchParams.get("ondate")}T00:00:00`,Cur_Abbreviation:url.pathname.split("/").at(-1),Cur_OfficialRate:3.6,Cur_Scale:100});
  };
  await assert.rejects(statements.getCashStatement({id:"denied",roles:["MANAGER"]},query,fetchRate),/прав/);
  assert.equal(transactions,0);assert.equal(requests.length,0);
  const byn=await statements.getCashStatement({id:"reader",roles:["PROCUREMENT"]},query,fetchRate);
  assert.equal(transactions,1);assert.equal(paymentReads,1);assert.equal(payoutReads,1);assert.equal(requests.length,4);assert.equal(new Set(requests).size,4);
  assert.equal(byn.rows.length,3);assert.equal(byn.rows.find(row=>row.id==="rub-two")?.totals.closing,"0.00");assert.equal(byn.rows.find(row=>row.id==="rub")?.totals.closing,"3.60");
  const native=await statements.getCashStatement({id:"reader",roles:["MANAGER","ACCOUNTANT"]},{...query,mode:"NATIVE"},fetchRate);
  assert.equal(transactions,2);assert.equal(requests.length,4);assert.equal(native.totals.length,2);
  paymentsPresent=false;
  const empty=await statements.getCashStatement({id:"reader",roles:["PROCUREMENT"]},query,fetchRate);
  assert.equal(transactions,3);assert.equal(requests.length,4);assert.ok(empty.rows.every(row=>row.totals.closing==="0.00"));
 });
});
