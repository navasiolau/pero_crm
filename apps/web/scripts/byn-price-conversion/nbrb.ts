import {validateHistoricalRate,conversionAssert,sha256} from "./planner";
export async function fetchHistoricalEvidence(requests:{currency:string;date:string}[],fetcher:typeof fetch=fetch) {
 const unique=new Map(requests.map(row=>[`${row.currency}:${row.date}`,row]));conversionAssert(unique.size<=200,"NBRB_REQUEST_BOUNDS");
 async function read(url:string){const response=await fetcher(url,{signal:AbortSignal.timeout(15000),redirect:"error",cache:"no-store"});conversionAssert(response.ok,`NBRB_HTTP_${response.status}`);const body=await response.text();conversionAssert(body.length>0&&body.length<=2*1024*1024,"NBRB_RESPONSE_BOUNDS");return body;}
 const catalogUrl="https://api.nbrb.by/exrates/currencies",catalogRaw=await read(catalogUrl),rates=[];
 for(const request of unique.values()){conversionAssert(/^[A-Z]{3}$/.test(request.currency)&&request.currency!=="BYN"&&/^\d{4}-\d{2}-\d{2}$/.test(request.date),"NBRB_REQUEST_SCOPE");const url=`https://api.nbrb.by/exrates/rates/${request.currency}?parammode=2&ondate=${request.date}`;rates.push(validateHistoricalRate(request.currency,request.date,catalogRaw,await read(url)));}
 return {catalogUrl,catalogRaw,catalogSha256:sha256(catalogRaw),rates};
}
