import {canonical,sha256,projectCalendarDate,convertCurrentAmount,currentLineAmount,conversionAssert,type HistoricalRate} from "./planner";
type AppValue={status:string;value?:unknown;reason?:string};
type AppProduct={id:string;number:string;title:string;expectedPrice:AppValue;initialPrice:AppValue;quantity:AppValue};
type AppProject={id:string;number:string;title:string;currency:string;createdAt:AppValue;initialPrice:AppValue;services:Record<string,AppValue>;products:AppProduct[]};
type AppSource={kind:string;origin:string;scope:{directDbAccess:boolean;businessPosts:number};projects:AppProject[]};
export function productionAppRateRequests(source:AppSource) {
 conversionAssert(source?.kind==="production-app-price-plan-readonly"&&source.scope?.directDbAccess===false&&source.scope.businessPosts===0&&Array.isArray(source.projects),"ACTUAL_APP_EXPORT_REQUIRED");
 const requests=new Map<string,{currency:string;date:string}>();
 for(const project of source.projects){if(project.currency==="BYN")continue;conversionAssert(/^[A-Z]{3}$/.test(project.currency??"")&&project.createdAt?.status==="available"&&typeof project.createdAt.value==="string","APP_RATE_BASIS_UNAVAILABLE");const date=projectCalendarDate(project.createdAt.value);requests.set(`${project.currency}:${date}`,{currency:project.currency,date});}
 return [...requests.values()];
}
export function buildProductionAppPriceReport(source:AppSource,rates:HistoricalRate[]) {
 conversionAssert(source?.kind==="production-app-price-plan-readonly"&&source.scope?.directDbAccess===false&&source.scope.businessPosts===0&&Array.isArray(source.projects),"ACTUAL_APP_EXPORT_REQUIRED");
 const byRate=new Map<string,HistoricalRate>();for(const rate of rates){const key=`${rate.currency}:${rate.date}`;conversionAssert(!byRate.has(key),"DUPLICATE_FX");byRate.set(key,rate);}
 const rows:Record<string,unknown>[]=[],blockedProjects:{id:string;reason:string}[]=[];let excludedByn=0;
 for(const project of source.projects){if(project.currency==="BYN"){excludedByn++;continue;}if(!/^[A-Z]{3}$/.test(project.currency??"")){blockedProjects.push({id:project.id,reason:"CURRENT_CURRENCY_UNAVAILABLE"});continue;}
  let date:string|undefined;try{if(project.createdAt?.status==="available"&&typeof project.createdAt.value==="string")date=projectCalendarDate(project.createdAt.value);}catch{/* Недоступная дата не заменяется датой изделия или текущей. */}
  const rate=date?byRate.get(`${project.currency}:${date}`):undefined;
  function add(model:"Project"|"Product",record:{id:string;number:string;title:string},field:string,input:AppValue|undefined,quantity?:number) {
   const row:Record<string,unknown>={projectId:project.id,projectNumber:project.number,projectTitle:project.title,model,id:record.id,number:record.number,title:record.title,field,basis:model==="Product"?"UNIT":"PROJECT_AMOUNT",availability:input?.status??"unavailable",currencyBefore:project.currency,currencyAfter:"BYN",...(project.createdAt?.status==="available"&&typeof project.createdAt.value==="string"?{createdAt:project.createdAt.value}:{}),...(date?{rateDate:date}:{}),...(quantity!==undefined?{quantity}:{})};
   if(input?.status==="known-null"&&input.value===null){row.before=null;row.after=null;row.conversionStatus="KNOWN_NULL";}
   else if(input?.status==="available"&&typeof input.value==="string"){
    row.before=input.value;
    if(!date)row.conversionStatus="PROJECT_CREATED_AT_UNAVAILABLE";
    else if(!rate)row.conversionStatus="HISTORICAL_FX_UNAVAILABLE";
    else try{row.after=convertCurrentAmount(input.value,rate);if(model==="Project"||quantity!==undefined){row.lineBefore=currentLineAmount(input.value,quantity??1);row.lineAfter=currentLineAmount(row.after as string,quantity??1);}row.conversionStatus=model==="Product"&&quantity===undefined?"QUANTITY_UNAVAILABLE":"CONVERTED_FOR_MANUAL_REPORT";}catch{row.conversionStatus="SOURCE_MONEY_OR_FX_INVALID";delete row.after;delete row.lineAfter;}
   }else row.conversionStatus="APP_FIELD_UNAVAILABLE";
   rows.push(row);
  }
  add("Project",project,"initialPrice",project.initialPrice);for(const field of ["delivery","unloading","installation"])add("Project",project,field,project.services?.[field]);
  for(const product of project.products??[]){const quantity=product.quantity?.status==="available"&&Number.isSafeInteger(product.quantity.value)&&Number(product.quantity.value)>0?Number(product.quantity.value):undefined;for(const field of ["expectedPrice","initialPrice"] as const)add("Product",product,field,product[field],quantity);}
 }
 return {version:1,sourceStatus:"ACTUAL_APP_EXPORT",sourceHash:sha256(canonical(source)),origin:source.origin,manualOnly:true,excludedByn,blockedProjects,plan:{rows,rates}};
}
