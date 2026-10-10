import {Prisma,type PrismaClient} from "@prisma/client";
import {activePaymentWhere} from '@/server/payments/active-records';
import {prisma} from "@/lib/prisma";
import {calendarDateRange} from "@/lib/calendar-dates";
import {cashMovementDelta} from "@/lib/cash-ledger";
import {historicalByn} from "@/lib/history-byn";
import type {ViewableFile} from "@/lib/viewable-file";
import {reportDocumentSelect,reportDocumentFile} from "@/server/finance-documents/view";
import {logisticsAllocationSelect,logisticsPaymentDocument} from "@/server/logistics/payment-view";
import {requireFinanceWorkspaceActor,type FinanceWorkspaceActor} from "./project-refs";

export type CashStatementQuery={from:string;to:string;mode:"BYN"|"NATIVE"};
export type CashStatementAccount={id:string;name:string;currency:string;active:boolean};
export type CashStatementFact={
 id:string;source:"PAYMENT"|"SALARY"|"ADVANCE";accountId:string|null;at:string;direction:"INCOME"|"EXPENSE";
 nativeAmount:string|null;nativeCurrency:string|null;bynAmount:string|null;label:string;comment:string|null;
 project:{id:string;number:string}|null;document:ViewableFile|null;
};
export type CashStatementTotals={opening:string|null;income:string|null;expense:string|null;closing:string|null};
export type CashStatementEntry=CashStatementFact&{change:string|null;currency:string;issues:string[]};
export type CashStatementRow={id:string;name:string;currency:string;active:boolean;unassigned:boolean;unknownAmounts:number;unassignedOperations:number;totals:CashStatementTotals;entries:CashStatementEntry[]};
type Amount=Prisma.Decimal|null;
const add=(left:Amount,right:Amount):Amount=>left===null||right===null?null:left.plus(right);
const zero=()=>new Prisma.Decimal(0);
const exact=(value:Prisma.Decimal.Value|null|undefined):string|null=>{
 if(value==null)return null;const decimal=new Prisma.Decimal(value);return decimal.isFinite()?decimal.toFixed(2):null;
};
function rangeFor(query:CashStatementQuery){
 if(query.mode!=="BYN"&&query.mode!=="NATIVE")throw Error("Неизвестный режим отчёта");
 return calendarDateRange(query.from,query.to);
}
export function buildCashStatement(accounts:readonly CashStatementAccount[],facts:readonly CashStatementFact[],query:CashStatementQuery){
 const range=rangeFor(query),accountMap=new Map(accounts.map(account=>[account.id,account]));
 type Bucket={row:CashStatementRow;opening:Amount;income:Amount;expense:Amount};
 const buckets=new Map<string,Bucket>();
 const create=(id:string,name:string,currency:string,active:boolean,unassigned:boolean):Bucket=>{
  const bucket={row:{id,name,currency,active,unassigned,unknownAmounts:0,unassignedOperations:0,totals:{opening:"0.00",income:"0.00",expense:"0.00",closing:"0.00"},entries:[] as CashStatementEntry[]},opening:zero(),income:zero(),expense:zero()};
  buckets.set(id,bucket);return bucket;
 };
 for(const account of accounts)create(account.id,account.name,query.mode==="BYN"?"BYN":account.currency,account.active,false);
 for(const fact of facts){
  const at=new Date(fact.at).getTime();if(!Number.isFinite(at))throw Error("Некорректная дата денежной операции");
  if(at>=range.end.getTime())continue;
  const account=fact.accountId?accountMap.get(fact.accountId):undefined;
  const currency=query.mode==="BYN"?"BYN":account?.currency??fact.nativeCurrency??"UNKNOWN";
  const id=account?.id??"unassigned:"+currency;
  const bucket=buckets.get(id)??create(id,"Касса не указана",currency,false,true);
  const issues:string[]=[];
  if(!account){issues.push("В истории не указана касса");bucket.row.unassignedOperations++;}
  let amount=query.mode==="BYN"?fact.bynAmount:fact.nativeAmount;
  if(query.mode==="NATIVE"&&(!fact.nativeCurrency||account&&fact.nativeCurrency!==account.currency)){
   amount=null;issues.push(fact.nativeCurrency?"Валюта операции отличается от валюты кассы":"Не сохранена физическая валюта выплаты");
  }
  const normalized=exact(amount);
  if(normalized===null){bucket.row.unknownAmounts++;issues.push(query.mode==="BYN"?"Нет подтверждённой суммы BYN":"Нет подтверждённой суммы в валюте кассы");}
  const delta=normalized===null?null:cashMovementDelta(fact.direction,normalized);
  if(at<range.start.getTime())bucket.opening=add(bucket.opening,delta);
  else{
   if(fact.direction==="INCOME")bucket.income=add(bucket.income,delta);else bucket.expense=add(bucket.expense,delta);
   bucket.row.entries.push({...fact,change:delta?.toFixed(2)??null,currency,issues});
  }
 }
 const rows=[...buckets.values()].map(bucket=>{
  bucket.row.totals={opening:exact(bucket.opening),income:exact(bucket.income),expense:exact(bucket.expense),closing:exact(add(add(bucket.opening,bucket.income),bucket.expense))};
  bucket.row.entries.sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id));return bucket.row;
 });
 const totalsMap=new Map<string,CashStatementTotals>();
 for(const row of rows){
  const previous=totalsMap.get(row.currency)??{opening:"0.00",income:"0.00",expense:"0.00",closing:"0.00"};
  const sum=(a:string|null,b:string|null)=>a===null||b===null?null:new Prisma.Decimal(a).plus(b).toFixed(2);
  totalsMap.set(row.currency,{opening:sum(previous.opening,row.totals.opening),income:sum(previous.income,row.totals.income),expense:sum(previous.expense,row.totals.expense),closing:sum(previous.closing,row.totals.closing)});
 }
 return {query,rows,totals:[...totalsMap].sort(([a],[b])=>a.localeCompare(b)).map(([currency,totals])=>({currency,...totals})),
  unknownAmounts:rows.reduce((sum,row)=>sum+row.unknownAmounts,0),unassignedOperations:rows.reduce((sum,row)=>sum+row.unassignedOperations,0)};
}
export async function loadCashStatement(actor:FinanceWorkspaceActor,query:CashStatementQuery,db:Pick<PrismaClient,"cashAccount"|"payment"|"payout">){
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
 return buildCashStatement(accounts,facts,query);
}
export type CashStatement=ReturnType<typeof buildCashStatement>;
/** Public report read uses one consistent, read-only snapshot across all sources. */
export async function getCashStatement(actor:FinanceWorkspaceActor,query:CashStatementQuery){
 requireFinanceWorkspaceActor(actor);rangeFor(query);
 return prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
  return loadCashStatement(actor,query,tx);
 },{isolationLevel:"RepeatableRead",maxWait:5000,timeout:15000});
}
