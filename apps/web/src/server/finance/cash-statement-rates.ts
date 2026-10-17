import {Prisma} from "@prisma/client";
import {calendarDateRange} from "@/lib/calendar-dates";
import {isCashCurrency} from "@/lib/cash-ledger";

export type CashStatementRate={currency:string;date:string;rate:string|null;issue:string|null};
export type CashStatementRateRequest=Pick<CashStatementRate,"currency"|"date">;

export function cashStatementRateDates(from:string,to:string){
 calendarDateRange(from,to);
 const previous=new Date(`${from}T00:00:00.000Z`);
 previous.setUTCDate(previous.getUTCDate()-1);
 return {opening:previous.toISOString().slice(0,10),closing:to};
}

/** Строковые календарные даты не зависят от часового пояса сервера. */
export async function fetchCashStatementRates(requests:readonly CashStatementRateRequest[],fetchRate:typeof fetch=fetch):Promise<CashStatementRate[]>{
 const unique=new Map(requests.filter(({currency})=>isCashCurrency(currency)&&currency!=="BYN").map(request=>[`${request.currency}:${request.date}`,request]));
 return Promise.all([...unique.values()].map(async({currency,date})=>{
  const unavailable={currency,date,rate:null,issue:`Не удалось подтвердить курс НБ РБ ${currency} на ${date}`};
  try{
   const parsed=new Date(`${date}T00:00:00.000Z`);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)return unavailable;
   const url=new URL(`https://api.nbrb.by/exrates/rates/${currency}`);
   url.searchParams.set("parammode","2");url.searchParams.set("ondate",date);
   const response=await fetchRate(url,{cache:"no-store",signal:AbortSignal.timeout(10_000)});
   if(!response.ok)return unavailable;
   const data:unknown=await response.json();
   if(typeof data!=="object"||data===null||Array.isArray(data))return unavailable;
   const record=data as Record<string,unknown>;
   if(record.Cur_Abbreviation!==currency||typeof record.Date!=="string"||record.Date.slice(0,10)!==date||!Number.isFinite(Date.parse(record.Date))||
    typeof record.Cur_OfficialRate!=="number"||!Number.isFinite(record.Cur_OfficialRate)||record.Cur_OfficialRate<=0||
    typeof record.Cur_Scale!=="number"||!Number.isSafeInteger(record.Cur_Scale)||record.Cur_Scale<=0)return unavailable;
   const rate=new Prisma.Decimal(record.Cur_OfficialRate.toString()).div(record.Cur_Scale.toString());
   if(!rate.isFinite()||rate.lte(0))return unavailable;
   return {currency,date,rate:rate.toString(),issue:null};
  }catch{return unavailable;}
 }));
}
