import {Prisma,type PrismaClient} from "@prisma/client";
import {activePaymentWhere} from "@/server/payments/active-records";
import {prisma} from "@/lib/prisma";
import {calendarDateRange} from "@/lib/calendar-dates";
import {cashMovementDelta,isCashCurrency} from "@/lib/cash-ledger";
import {historicalByn} from "@/lib/history-byn";
import type {ViewableFile} from "@/lib/viewable-file";
import {reportDocumentSelect,reportDocumentFile} from "@/server/finance-documents/view";
import {logisticsAllocationSelect,logisticsPaymentDocument} from "@/server/logistics/payment-view";
import {requireFinanceWorkspaceActor,type FinanceWorkspaceActor} from "./project-refs";
import {cashStatementRateDates,fetchCashStatementRates,type CashStatementRate,type CashStatementRateRequest} from "./cash-statement-rates";

export type CashStatementQuery={from:string;to:string;mode:"BYN"|"NATIVE"};
export type CashStatementAccount={id:string;name:string;currency:string;active:boolean};
export type CashStatementFact={
 id:string;source:"PAYMENT"|"SALARY"|"ADVANCE";accountId:string|null;at:string;direction:"INCOME"|"EXPENSE";
 nativeAmount:string|null;nativeCurrency:string|null;bynAmount:string|null;label:string;comment:string|null;
 project:{id:string;number:string}|null;document:ViewableFile|null;
};
export type CashStatementTotals={opening:string|null;income:string|null;expense:string|null;revaluation:string|null;closing:string|null};
export type CashBalanceValuation={nativeAmount:string|null;nativeCurrency:string;date:string;rate:string|null;rateDate:string|null;issue:string|null};
export type CashStatementEntry=CashStatementFact&{change:string|null;currency:string;issues:string[]};
export type CashStatementRow={
 id:string;name:string;currency:string;active:boolean;unassigned:boolean;unknownAmounts:number;unassignedOperations:number;
 totals:CashStatementTotals;entries:CashStatementEntry[];valuation:{opening:CashBalanceValuation;closing:CashBalanceValuation}|null;
};
type Amount=Prisma.Decimal|null;
const add=(left:Amount,right:Amount):Amount=>left===null||right===null?null:left.plus(right);
const zero=()=>new Prisma.Decimal(0);
const decimal=(value:Prisma.Decimal.Value|null|undefined):Amount=>{
 if(value==null)return null;
 try{const amount=new Prisma.Decimal(value);return amount.isFinite()?amount:null;}catch{return null;}
};
const exact=(value:Prisma.Decimal.Value|null|undefined):string|null=>decimal(value)?.toFixed(2)??null;
const emptyTotals=():CashStatementTotals=>({opening:"0.00",income:"0.00",expense:"0.00",revaluation:"0.00",closing:"0.00"});
const totalKeys=["opening","income","expense","revaluation","closing"] as const;
function rangeFor(query:CashStatementQuery){
 if(query.mode!=="BYN"&&query.mode!=="NATIVE")throw Error("Неизвестный режим отчёта");
 return calendarDateRange(query.from,query.to);
}
function valueBalance(amount:Amount,currency:string,date:string,unassigned:boolean,rates:ReadonlyMap<string,CashStatementRate>){
 const metadata:CashBalanceValuation={nativeAmount:exact(amount),nativeCurrency:currency,date,rate:null,rateDate:null,issue:null};
 const unknown=(issue:string)=>({amount:null,metadata:{...metadata,issue}});
 if(unassigned)return unknown("Касса не указана: физический остаток нельзя подтвердить");
 if(!isCashCurrency(currency))return unknown("Валюта кассы не поддерживается для оценки НБ РБ");
 if(amount===null)return unknown("Нет подтверждённого остатка в валюте кассы: неполная физическая история");
 if(amount.isZero())return {amount:zero(),metadata};
 const quote=rates.get(`${currency}:${date}`);
 const rate=currency==="BYN"?new Prisma.Decimal(1):decimal(quote?.rate);
 if(rate===null||rate.lte(0))return unknown(quote?.issue??`Нет подтверждённого курса НБ РБ ${currency} на ${date}`);
 return {amount:amount.mul(rate).toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP),metadata:{...metadata,rate:rate.toString(),rateDate:date}};
}

export function buildCashStatement(accounts:readonly CashStatementAccount[],facts:readonly CashStatementFact[],query:CashStatementQuery,rates:readonly CashStatementRate[]=[]){
 const range=rangeFor(query),dates=cashStatementRateDates(query.from,query.to),accountMap=new Map(accounts.map(account=>[account.id,account]));
 const rateMap=new Map(rates.map(rate=>[`${rate.currency}:${rate.date}`,rate]));
 type Bucket={row:CashStatementRow;nativeCurrency:string;opening:Amount;income:Amount;expense:Amount;nativeOpening:Amount;nativeClosing:Amount};
 const buckets=new Map<string,Bucket>();
 const create=(id:string,name:string,nativeCurrency:string,active:boolean,unassigned:boolean):Bucket=>{
  const bucket:Bucket={row:{id,name,currency:query.mode==="BYN"?"BYN":nativeCurrency,active,unassigned,unknownAmounts:0,unassignedOperations:0,totals:emptyTotals(),entries:[],valuation:null},
   nativeCurrency,opening:zero(),income:zero(),expense:zero(),nativeOpening:unassigned&&query.mode==="BYN"?null:zero(),nativeClosing:unassigned&&query.mode==="BYN"?null:zero()};
  buckets.set(id,bucket);return bucket;
 };
 for(const account of accounts)create(account.id,account.name,account.currency,account.active,false);
 for(const fact of facts){
  const at=new Date(fact.at).getTime();if(!Number.isFinite(at))throw Error("Некорректная дата денежной операции");
  if(at>=range.end.getTime())continue;
  const account=fact.accountId?accountMap.get(fact.accountId):undefined;
  const currency=account?.currency??fact.nativeCurrency??"UNKNOWN";
  const id=account?.id??"unassigned:"+(query.mode==="BYN"?"BYN":currency);
  const bucket=buckets.get(id)??create(id,"Касса не указана",query.mode==="BYN"?"UNKNOWN":currency,false,true);
  const issues:string[]=[];
  if(!account){issues.push("В истории не указана касса");bucket.row.unassignedOperations++;}
  let native=exact(fact.nativeAmount);
  if(!fact.nativeCurrency||account&&fact.nativeCurrency!==account.currency){
   native=null;issues.push(fact.nativeCurrency?"Валюта операции отличается от валюты кассы":"Не сохранена физическая валюта выплаты");
  }
  if(native===null)issues.push("Нет подтверждённой суммы в валюте кассы");
  const selected=query.mode==="BYN"?exact(fact.bynAmount):native;
  if(selected===null&&query.mode==="BYN")issues.push("Нет подтверждённой суммы BYN");
  if(selected===null||native===null)bucket.row.unknownAmounts++;
  const nativeDelta=native===null?null:cashMovementDelta(fact.direction,native);
  bucket.nativeClosing=add(bucket.nativeClosing,nativeDelta);
  const delta=selected===null?null:cashMovementDelta(fact.direction,selected);
  if(at<range.start.getTime()){
   bucket.opening=add(bucket.opening,delta);bucket.nativeOpening=add(bucket.nativeOpening,nativeDelta);
  }else{
   if(fact.direction==="INCOME")bucket.income=add(bucket.income,delta);else bucket.expense=add(bucket.expense,delta);
   bucket.row.entries.push({...fact,change:exact(delta),currency:bucket.row.currency,issues});
  }
 }
 const rows=[...buckets.values()].map(bucket=>{
  let opening=bucket.opening,closing=add(add(bucket.opening,bucket.income),bucket.expense),revaluation:Amount=zero();
  if(query.mode==="BYN"){
   const start=valueBalance(bucket.nativeOpening,bucket.nativeCurrency,dates.opening,bucket.row.unassigned,rateMap);
   const end=valueBalance(bucket.nativeClosing,bucket.nativeCurrency,dates.closing,bucket.row.unassigned,rateMap);
   opening=start.amount;closing=end.amount;
   revaluation=closing===null||opening===null||bucket.income===null||bucket.expense===null?null:closing.sub(opening).sub(bucket.income).sub(bucket.expense);
   bucket.row.valuation={opening:start.metadata,closing:end.metadata};
  }
  bucket.row.totals={opening:exact(opening),income:exact(bucket.income),expense:exact(bucket.expense),revaluation:exact(revaluation),closing:exact(closing)};
  bucket.row.entries.sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id));return bucket.row;
 });
 const totalsMap=new Map<string,CashStatementTotals>();
 for(const row of rows){
  const previous=totalsMap.get(row.currency)??emptyTotals();
  for(const key of totalKeys)previous[key]=exact(add(decimal(previous[key]),decimal(row.totals[key])));
  totalsMap.set(row.currency,previous);
 }
 return {query,rows,totals:[...totalsMap].sort(([a],[b])=>a.localeCompare(b)).map(([currency,totals])=>({currency,...totals})),
  valuationUnavailable:rows.filter(row=>row.valuation&&(row.valuation.opening.issue||row.valuation.closing.issue)).length,
  unknownAmounts:rows.reduce((sum,row)=>sum+row.unknownAmounts,0),unassignedOperations:rows.reduce((sum,row)=>sum+row.unassignedOperations,0)};
}

type CashStatementDb=Pick<PrismaClient,"cashAccount"|"payment"|"payout">;
async function readCashStatementFacts(actor:FinanceWorkspaceActor,query:CashStatementQuery,db:CashStatementDb){
 requireFinanceWorkspaceActor(actor);const range=rangeFor(query);
 const [accounts,payments,payouts]=await Promise.all([
  db.cashAccount.findMany({select:{id:true,name:true,currency:true,active:true},orderBy:{createdAt:"asc"}}),
  db.payment.findMany({where:{...activePaymentWhere,paidAt:{lt:range.end}},select:{id:true,cashAccountId:true,paidAt:true,direction:true,amount:true,currency:true,bynAmount:true,comment:true,
   project:{select:{id:true,number:true}},expenseArticle:{select:{name:true}},reportDocument:{select:reportDocumentSelect},logisticsAllocation:{select:logisticsAllocationSelect},
   stockPurchase:{select:{movement:{select:{material:{select:{name:true}}}}}}
  }}),
  db.payout.findMany({where:{createdAt:{lt:range.end}},select:{id:true,cashAccountId:true,createdAt:true,kind:true,amount:true,payrollCurrency:true,
   cashAmount:true,cashCurrency:true,bynAmount:true,comment:true,user:{select:{name:true}}}}),
 ]);
 const facts:CashStatementFact[]=payments.map(row=>({id:"payment:"+row.id,source:"PAYMENT",accountId:row.cashAccountId,at:row.paidAt.toISOString(),
  direction:row.direction,nativeAmount:exact(row.amount),nativeCurrency:row.currency,bynAmount:exact(row.bynAmount),
  label:row.logisticsAllocation?"Логистика":row.stockPurchase?"Закупка · "+row.stockPurchase.movement.material.name:row.direction==="INCOME"?"Приход":row.expenseArticle?.name??"Расход",
  comment:row.comment,project:row.project?{id:row.project.id,number:row.project.number}:null,document:reportDocumentFile(row.reportDocument)??logisticsPaymentDocument(row.logisticsAllocation)}));
 for(const row of payouts)facts.push({id:"payout:"+row.id,source:row.kind==="ADVANCE"?"ADVANCE":"SALARY",accountId:row.cashAccountId,at:row.createdAt.toISOString(),
  direction:"EXPENSE",nativeAmount:exact(row.cashAmount),nativeCurrency:row.cashCurrency,bynAmount:exact(historicalByn(row)),
  label:(row.kind==="ADVANCE"?"Аванс":"Зарплата")+" · "+row.user.name,comment:row.comment,project:null,document:null});
 return {accounts,facts};
}

/** DB-helper без сетевых обращений; курсы передаются отдельно. */
export async function loadCashStatement(actor:FinanceWorkspaceActor,query:CashStatementQuery,db:CashStatementDb,rates:readonly CashStatementRate[]=[]){
 const snapshot=await readCashStatementFacts(actor,query,db);
 return buildCashStatement(snapshot.accounts,snapshot.facts,query,rates);
}
export type CashStatement=ReturnType<typeof buildCashStatement>;

/** Все денежные источники читаются одним согласованным снимком; сеть — после его завершения. */
export async function getCashStatement(actor:FinanceWorkspaceActor,query:CashStatementQuery,fetchRate:typeof fetch=fetch){
 requireFinanceWorkspaceActor(actor);rangeFor(query);
 const snapshot=await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
  return readCashStatementFacts(actor,query,tx);
 },{isolationLevel:"RepeatableRead",maxWait:5000,timeout:15000});
 const provisional=buildCashStatement(snapshot.accounts,snapshot.facts,query);
 if(query.mode==="NATIVE")return provisional;
 const requests:CashStatementRateRequest[]=[];
 for(const row of provisional.rows){
  if(row.unassigned||!row.valuation)continue;
  for(const value of [row.valuation.opening,row.valuation.closing]){
   if(value.nativeAmount!==null&&isCashCurrency(value.nativeCurrency)&&value.nativeCurrency!=="BYN"&&!new Prisma.Decimal(value.nativeAmount).isZero())
    requests.push({currency:value.nativeCurrency,date:value.date});
  }
 }
 if(requests.length===0)return provisional;
 const rates=await fetchCashStatementRates(requests,fetchRate);
 return buildCashStatement(snapshot.accounts,snapshot.facts,query,rates);
}
