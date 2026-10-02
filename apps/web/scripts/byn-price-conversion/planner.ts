import {Prisma} from "@prisma/client";
import {createHash} from "node:crypto";

const Decimal=Prisma.Decimal.clone({precision:60,rounding:Prisma.Decimal.ROUND_HALF_UP});
export const PROJECT_MONEY_FIELDS=["initialPrice","delivery","unloading","installation"] as const;
export const PRODUCT_MONEY_FIELDS=["expectedPrice","initialPrice"] as const;
export type CurrentProductPrices={id:string;projectId:string;number:string;title:string;quantity:number;expectedPrice:string|null;initialPrice:string|null};
export type CurrentProjectPrices={id:string;number:string;title:string;currency:string;createdAt:string;initialPrice:string|null;delivery:string|null;unloading:string|null;installation:string|null;products:CurrentProductPrices[]};
export type HistoricalRate={currency:string;date:string;curId:number;scale:number;officialRate:string;perUnit:string;validFrom:string;validTo:string;sourceUrl:string;catalogUrl:string;catalogSha256:string;rawCurrency:string;rawResponse:string;rawSha256:string};
export type PriceReportRow={projectId:string;projectNumber:string;projectTitle:string;createdAt:string;rateDate:string;currencyBefore:string;currencyAfter:"BYN";model:"Project"|"Product";id:string;number:string;title:string;field:string;basis:"PROJECT_AMOUNT"|"UNIT";before:string|null;after:string|null;quantity:number|null;lineBefore:string|null;lineAfter:string|null;rateKey:string};
export type BynPricePlan={version:1;rounding:"HALF_UP_UNIT_2_THEN_QUANTITY";rates:HistoricalRate[];projects:{before:CurrentProjectPrices;after:CurrentProjectPrices}[];rows:PriceReportRow[]};
export function conversionAssert(ok:unknown,code:string):asserts ok {if(!ok)throw Error(code);}
export const sha256=(text:string)=>createHash("sha256").update(text).digest("hex");
export function canonical(value:unknown):string {return Array.isArray(value)?`[${value.map(canonical).join(",")}]`:value&&typeof value==="object"?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(",")}}`:JSON.stringify(value);}
export function projectCalendarDate(iso:string) {
 conversionAssert(typeof iso==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso),"PROJECT_CREATED_AT_ISO_REQUIRED");
 const date=new Date(iso);conversionAssert(Number.isFinite(date.getTime())&&date.toISOString()===iso,"PROJECT_CREATED_AT_INVALID");
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
 const part=(type:string)=>parts.find(row=>row.type===type)!.value;
 const day=`${part("year")}-${part("month")}-${part("day")}`;conversionAssert(day>="2016-07-01","PRE_BYN_DENOMINATION_REQUIRES_REVIEW");return day;
}
function money(value:string|null):string|null {
 if(value===null)return null;
 conversionAssert(typeof value==="string"&&/^\d{1,10}(?:\.\d{1,2})?$/.test(value),"CURRENT_MONEY_INVALID");
 return new Decimal(value).toFixed(2);
}
function normalized(project:CurrentProjectPrices):CurrentProjectPrices {
 conversionAssert(project&&typeof project.id==="string"&&project.id.length>0&&typeof project.number==="string"&&typeof project.title==="string"&&/^[A-Z]{3}$/.test(project.currency)&&Array.isArray(project.products),"CURRENT_PROJECT_INVALID");projectCalendarDate(project.createdAt);
 const copy=structuredClone(project);for(const field of PROJECT_MONEY_FIELDS)copy[field]=money(project[field]);
 copy.products=copy.products.map(product=>{conversionAssert(typeof product.id==="string"&&product.id.length>0&&product.projectId===project.id&&Number.isSafeInteger(product.quantity)&&product.quantity>0&&product.quantity<=2147483647&&typeof product.number==="string"&&typeof product.title==="string","CURRENT_PRODUCT_INVALID");return {...product,expectedPrice:money(product.expectedPrice),initialPrice:money(product.initialPrice)};}).sort((a,b)=>a.id.localeCompare(b.id));
 return copy;
}
export function validateHistoricalRate(currency:string,date:string,catalogRaw:string,rawResponse:string):HistoricalRate {
 conversionAssert(/^[A-Z]{3}$/.test(currency)&&currency!=="BYN"&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>="2016-07-01","FX_SCOPE_INVALID");
 const day=new Date(`${date}T00:00:00.000Z`);conversionAssert(Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===date,"FX_CALENDAR_DATE_INVALID");
 let catalog:unknown,raw:Record<string,unknown>;try{catalog=JSON.parse(catalogRaw);raw=JSON.parse(rawResponse);}catch{throw Error("NBRB_JSON_INVALID");}
 conversionAssert(Array.isArray(catalog)&&raw&&typeof raw==="object"&&!Array.isArray(raw),"NBRB_RESPONSE_INVALID");
 for(const field of ["Cur_ID","Date","Cur_Abbreviation","Cur_Scale","Cur_OfficialRate"])conversionAssert([...rawResponse.matchAll(new RegExp(`"${field}"\\s*:`,"g"))].length===1,"NBRB_DUPLICATE_FIELD");
 const matches=catalog.filter(item=>item&&item.Cur_Abbreviation===currency&&typeof item.Cur_DateStart==="string"&&typeof item.Cur_DateEnd==="string"&&item.Cur_DateStart.slice(0,10)<=date&&item.Cur_DateEnd.slice(0,10)>=date);
 conversionAssert(matches.length===1,"NBRB_CURRENCY_VALIDITY_NOT_UNIQUE");const metadata=matches[0];
 conversionAssert([metadata.Cur_DateStart,metadata.Cur_DateEnd].every(value=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T00:00:00$/.test(value)&&Number.isFinite(new Date(`${value}Z`).getTime())&&new Date(`${value}Z`).toISOString().slice(0,10)===value.slice(0,10)),"NBRB_CURRENCY_DATES_INVALID");
 conversionAssert(Number.isSafeInteger(raw.Cur_ID)&&raw.Cur_ID===metadata.Cur_ID&&raw.Cur_Abbreviation===currency&&typeof raw.Date==="string"&&raw.Date===`${date}T00:00:00`,"NBRB_RATE_DATE_IDENTITY_MISMATCH");
 conversionAssert(Number.isSafeInteger(raw.Cur_Scale)&&Number(raw.Cur_Scale)>0&&raw.Cur_Scale===metadata.Cur_Scale,"NBRB_SCALE_MISMATCH");
 const tokens=[...rawResponse.matchAll(/"Cur_OfficialRate"\s*:\s*([0-9]+(?:\.[0-9]+)?(?:[eE][-+]?\d+)?)\s*[,}]/g)];
 conversionAssert(tokens.length===1&&typeof raw.Cur_OfficialRate==="number"&&Number.isFinite(raw.Cur_OfficialRate),"NBRB_OFFICIAL_RATE_INVALID");
 const official=new Decimal(tokens[0][1]);conversionAssert(official.isFinite()&&official.gt(0),"NBRB_OFFICIAL_RATE_INVALID");
 const sourceUrl=`https://api.nbrb.by/exrates/rates/${currency}?parammode=2&ondate=${date}`;
 return {currency,date,curId:Number(raw.Cur_ID),scale:Number(raw.Cur_Scale),officialRate:official.toString(),perUnit:official.div(Number(raw.Cur_Scale)).toString(),validFrom:metadata.Cur_DateStart,validTo:metadata.Cur_DateEnd,sourceUrl,catalogUrl:"https://api.nbrb.by/exrates/currencies",catalogSha256:sha256(catalogRaw),rawCurrency:JSON.stringify(metadata),rawResponse,rawSha256:sha256(rawResponse)};
}
function validateEvidence(rate:HistoricalRate) {
 conversionAssert(rate.rawSha256===sha256(rate.rawResponse)&&/^[a-f0-9]{64}$/.test(rate.catalogSha256),"FX_EVIDENCE_HASH_MISMATCH");
 const validated=validateHistoricalRate(rate.currency,rate.date,`[${rate.rawCurrency}]`,rate.rawResponse);
 for(const field of ["curId","scale","officialRate","perUnit","validFrom","validTo","sourceUrl","catalogUrl"] as const)conversionAssert(validated[field]===rate[field],"FX_EVIDENCE_VALUE_MISMATCH");
}
export function convertCurrentAmount(value:string|null,rate:HistoricalRate):string|null {
 validateEvidence(rate);const current=money(value);if(current===null)return null;
 const converted=new Decimal(current).mul(rate.officialRate).div(rate.scale).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);conversionAssert(converted.lte("9999999999.99"),"CONVERTED_MONEY_OVERFLOW");return converted.toFixed(2);
}
export function currentLineAmount(unit:string|null,quantity:number):string|null {
 conversionAssert(Number.isSafeInteger(quantity)&&quantity>0&&quantity<=2147483647,"CURRENT_QUANTITY_INVALID");const value=money(unit);return value===null?null:new Decimal(value).mul(quantity).toFixed(2);
}
export function buildBynPricePlan(source:CurrentProjectPrices[],rates:HistoricalRate[]):BynPricePlan {
 conversionAssert(Array.isArray(source)&&source.length<=200&&Array.isArray(rates)&&rates.length<=200,"PRICE_PLAN_BOUNDS");
 const byRate=new Map<string,HistoricalRate>();for(const rate of rates){validateEvidence(rate);const key=`${rate.currency}:${rate.date}`;conversionAssert(!byRate.has(key),"DUPLICATE_FX");byRate.set(key,rate);}
 const plan:BynPricePlan={version:1,rounding:"HALF_UP_UNIT_2_THEN_QUANTITY",rates:[],projects:[],rows:[]};const projectIds=new Set<string>(),productIds=new Set<string>(),used=new Set<string>();
 for(const raw of source){conversionAssert(!projectIds.has(raw.id),"DUPLICATE_PROJECT");projectIds.add(raw.id);if(raw.currency==="BYN")continue;const before=normalized(raw),after=structuredClone(before),date=projectCalendarDate(before.createdAt),key=`${before.currency}:${date}`,rate=byRate.get(key);conversionAssert(rate,"MISSING_FX");used.add(key);after.currency="BYN";
  const convert=(value:string|null)=>{if(value===null)return null;const converted=new Decimal(value).mul(rate.officialRate).div(rate.scale).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);conversionAssert(converted.lte("9999999999.99"),"CONVERTED_MONEY_OVERFLOW");return converted.toFixed(2);};
  const row=(model:"Project"|"Product",record:{id:string;number:string;title:string},field:string,value:string|null,quantity:number|null):PriceReportRow=>({projectId:before.id,projectNumber:before.number,projectTitle:before.title,createdAt:before.createdAt,rateDate:date,currencyBefore:before.currency,currencyAfter:"BYN",model,id:record.id,number:record.number,title:record.title,field,basis:model==="Product"?"UNIT":"PROJECT_AMOUNT",before:value,after:convert(value),quantity,lineBefore:value===null?null:new Decimal(value).mul(quantity??1).toFixed(2),lineAfter:value===null?null:new Decimal(convert(value)!).mul(quantity??1).toFixed(2),rateKey:key});
  for(const field of PROJECT_MONEY_FIELDS){after[field]=convert(before[field]);plan.rows.push(row("Project",before,field,before[field],null));}
  for(const product of before.products){conversionAssert(!productIds.has(product.id),"DUPLICATE_PRODUCT");productIds.add(product.id);const next=after.products.find(item=>item.id===product.id)!;for(const field of PRODUCT_MONEY_FIELDS){next[field]=convert(product[field]);plan.rows.push(row("Product",product,field,product[field],product.quantity));}}
  plan.projects.push({before,after});
 }
 conversionAssert(productIds.size<=1000,"PRICE_PLAN_PRODUCT_BOUNDS");plan.projects.sort((a,b)=>a.before.id.localeCompare(b.before.id));plan.rates=[...used].sort().map(key=>byRate.get(key)!);return plan;
}
export function classifyConversionState(plan:BynPricePlan,current:CurrentProjectPrices[]):"BEFORE"|"AFTER" {
 conversionAssert(current.length===plan.projects.length,"CONVERSION_CURRENT_SET_MISMATCH");const rows=current.map(normalized).sort((a,b)=>a.id.localeCompare(b.id));
 if(canonical(rows)===canonical(plan.projects.map(row=>row.before)))return "BEFORE";
 if(canonical(rows)===canonical(plan.projects.map(row=>row.after)))return "AFTER";
 throw Error("CONVERSION_STALE_OR_MIXED_STATE");
}
