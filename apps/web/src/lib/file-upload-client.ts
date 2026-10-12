import {createRequestId} from "./request-id";
import {declaredUploadHeader,UPLOAD_CONTEXT_HEADER} from "./upload-request-context";
import {DOCUMENT_UPLOAD_MAX_BYTES,IMAGE_UPLOAD_MAX_BYTES} from "@/server/files/upload-limits";
export type UploadCommitState="notCommitted"|"committed"|"unknown";
const PHASES=["auth","request","context","validation","image","storage-original","storage-thumb","persist","confirmation"] as const;
export type UploadPhase=typeof PHASES[number];
export type UploadFailure={error:string;kind?:string;code:string;requestId:string;clientMutationId:string;httpStatus?:number;commitState:UploadCommitState;details:{phase:UploadPhase;message:string}};
export type UploadAttempt={form:FormData;clientMutationId:string};
export type UploadSuccessData=Record<string,unknown>&{ok:true;id:string;clientMutationId:string};
export type UploadResult={ok:true;data:UploadSuccessData;httpStatus:number;requestId:string}|{ok:false;failure:UploadFailure};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plain=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
function safeText(value:unknown,fallback:string,limit=2000) {
 if(typeof value!=="string"||!value.trim())return fallback;
 return value.split(/\r?\n/).filter(line=>!/^\s*at\s|^\s*(?:node:|file:\/\/)/.test(line)).join("\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g," ")
  .replace(/\b(?:https?|postgres(?:ql)?):\/\/[^\s]+/gi,"[адрес скрыт]")
  .replace(/(["']?)(?:secretAccessKey|accessKeyId|sessionToken|securityToken|password|passwd|authorization|set-cookie|cookie|secret|token|signature|credentials?|access[-_]?key|x-amz-(?:credential|signature|security-token|algorithm))\1\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}\]]+)/gi,"[секрет скрыт]")
  .replace(/\bBearer\s+[^\s,;]+/gi,"Bearer [скрыто]")
  .replace(/\b(?:authorization|set-cookie|cookie|password|secret|token|signature|credential|access[-_]?key)\s*[:=]\s*[^\r\n,;]+/gi,"[секрет скрыт]")
  .slice(0,limit);
}
function safeId(value:unknown,fallback:string){return typeof value==="string"&&/^[A-Za-z0-9._:-]{1,128}$/.test(value)?value:fallback;}
export function createUploadAttempt(form:FormData,clientMutationId?:string):UploadAttempt {
 const existing=form.get("clientMutationId");const id=clientMutationId??(typeof existing==="string"?existing:createRequestId());if(!UUID.test(id))throw Error("Некорректный идентификатор загрузки");form.set("clientMutationId",id);return {form,clientMutationId:id};
}
export function uploadAttemptMatchesContext(attempt:UploadAttempt,fields:Record<string,string|undefined>) {
 const keys=["projectId","productId","taskId","section","assignCover","expectedSketchFileId"];
 return keys.every(key=>(attempt.form.get(key)??undefined)===fields[key]);
}
export function localUploadFailure(message:string,phase:UploadPhase="validation",clientMutationId=createRequestId(),commitState:UploadCommitState="notCommitted",httpStatus?:number,requestId=clientMutationId):UploadFailure {
 const error=safeText(message,"Не удалось выполнить файловую операцию.",300);return {error,code:phase==="confirmation"?"UPLOAD_CONFIRMATION_REQUIRED":"CLIENT_VALIDATION",requestId,clientMutationId,httpStatus,commitState,details:{phase,message:error}};
}
function failure(attempt:UploadAttempt,options:{error:string;code:string;message:string;phase:UploadPhase;response?:Response;requestId?:unknown;kind?:unknown;commitState:UploadCommitState}):UploadResult {
 return {ok:false,failure:{error:safeText(options.error,"Не удалось загрузить файл.",300),code:safeId(options.code,"UPLOAD_FAILED"),requestId:safeId(options.requestId,safeId(options.response?.headers.get("x-request-id"),attempt.clientMutationId)),clientMutationId:attempt.clientMutationId,httpStatus:options.response?.status,kind:typeof options.kind==="string"?safeText(options.kind,"",40):undefined,commitState:options.commitState,details:{phase:options.phase,message:safeText(options.message,"Причина не указана")}}};
}
export type UploadEndpoint="/api/files/upload";
// Пакетная загрузка: до 100 файлов за раз; мелкие (до 25 МБ) — пулом,
// крупные документы — строго последовательно, чтобы не держать гигабайты в памяти параллельно.
export const MULTI_UPLOAD_MAX_FILES=100;
export const MULTI_UPLOAD_CONCURRENCY=4;
export const MULTI_UPLOAD_LARGE_THRESHOLD_BYTES=IMAGE_UPLOAD_MAX_BYTES;
const UPLOAD_TIMEOUT_MIN_MS=60_000;
const UPLOAD_TIMEOUT_MAX_MS=10*60_000;
/** Таймаут по размеру файла: 60 с до 25 МБ, далее линейно до 10 мин к 1 ГБ. */
export function uploadTimeoutMsForSize(sizeBytes:number):number {
 if(!Number.isFinite(sizeBytes)||sizeBytes<=IMAGE_UPLOAD_MAX_BYTES)return UPLOAD_TIMEOUT_MIN_MS;
 const ratio=Math.min(1,(sizeBytes-IMAGE_UPLOAD_MAX_BYTES)/(DOCUMENT_UPLOAD_MAX_BYTES-IMAGE_UPLOAD_MAX_BYTES));
 return Math.round(UPLOAD_TIMEOUT_MIN_MS+ratio*(UPLOAD_TIMEOUT_MAX_MS-UPLOAD_TIMEOUT_MIN_MS));
}
function uploadTimeoutMsForAttempt(attempt:UploadAttempt):number {
 const file=attempt.form.get("file");
 return file instanceof File?uploadTimeoutMsForSize(file.size):UPLOAD_TIMEOUT_MIN_MS;
}
export async function sendFileUpload(attempt:UploadAttempt,{fetcher=fetch,timeoutMs,endpoint="/api/files/upload"}:{fetcher?:typeof fetch;timeoutMs?:number;endpoint?:UploadEndpoint}={}):Promise<UploadResult> {
 if(endpoint!=="/api/files/upload")return {ok:false,failure:localUploadFailure("Неверный адрес загрузки","request",attempt.clientMutationId)};
 const effectiveTimeout=timeoutMs??uploadTimeoutMsForAttempt(attempt);
 if(endpoint!=="/api/files/upload")return {ok:false,failure:localUploadFailure("Неверный адрес загрузки","request",attempt.clientMutationId)};
 const controller=new AbortController();let response:Response|undefined,timedOut=false,timer:ReturnType<typeof setTimeout>|undefined;
 const unknown=(code:string,error:string,message:string)=>failure(attempt,{code,error:response&&response.status>=500?`\u041d\u0435\u0442 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438. \u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430 (${response.status}).`:error,message,phase:response?"confirmation":"request",response,commitState:"unknown"});
 const timeout=new Promise<UploadResult>(resolve=>{timer=setTimeout(()=>{timedOut=true;controller.abort();resolve(unknown("UPLOAD_TIMEOUT","Загрузка не завершилась вовремя.","Время ожидания ответа истекло; результат записи не подтверждён."));},effectiveTimeout);});
 const work=(async():Promise<UploadResult>=>{
  try{
   const contextHeader=declaredUploadHeader(attempt.form);
   response=await fetcher(endpoint,{method:"POST",body:attempt.form,headers:{"x-request-id":attempt.clientMutationId,...(contextHeader?{[UPLOAD_CONTEXT_HEADER]:contextHeader}:{})},signal:controller.signal});
   let data:unknown;try{data=await response.json();}catch{return unknown("UPLOAD_NON_JSON_RESPONSE","Сервер вернул неожиданный ответ.","Ответ сервера не удалось прочитать как JSON.");}
   if(plain(data)&&response.ok&&data.ok===true&&typeof data.id==="string"&&data.id&&data.clientMutationId===attempt.clientMutationId)return {ok:true,data:data as UploadSuccessData,httpStatus:response.status,requestId:safeId(data.requestId,safeId(response.headers.get("x-request-id"),attempt.clientMutationId))};
   if(plain(data)&&data.ok===false){const details=plain(data.details)?data.details:{};const phase=PHASES.includes(details.phase as UploadPhase)?details.phase as UploadPhase:"confirmation";const commitState=["notCommitted","committed","unknown"].includes(String(data.commitState))?data.commitState as UploadCommitState:response.status>=400&&response.status<500?"notCommitted":"unknown";
    return failure(attempt,{error:typeof data.error==="string"?data.error:"Не удалось загрузить файл.",code:safeId(data.code,`UPLOAD_HTTP_${response.status}`),message:typeof details.message==="string"?details.message:"Сервер отклонил загрузку; техническая причина не передана.",phase,response,requestId:data.requestId,kind:data.kind,commitState});}
   return unknown("UPLOAD_ACK_INVALID","Не получено подтверждение загрузки.","Ожидался успешный ответ с id и исходным clientMutationId.");
  }catch(error){return timedOut?unknown("UPLOAD_TIMEOUT","Загрузка не завершилась вовремя.","Время ожидания ответа истекло; результат записи не подтверждён."):unknown("UPLOAD_NETWORK","Не удалось связаться с сервером.",`Сетевая ошибка (${error instanceof Error?safeText(error.name,"Error",40):"Error"}); результат записи не подтверждён.`);}
 })();
 try{return await Promise.race([work,timeout]);}finally{if(timer)clearTimeout(timer);}
}
export type BatchUploadItem={fileName:string;size:number;attempt:UploadAttempt};
export type BatchUploadResult={fileName:string;size:number;result:UploadResult};
export type BatchUploadSummary={results:BatchUploadResult[];truncated:number};
export type BatchFileFailure={fileName:string;failure:UploadFailure};
/** Отправляет пачку файлов: первые 100, мелкие — пулом, крупные — последовательно.
 *  Порядок результатов совпадает с порядком выбора; ошибка одного файла не валит пачку. */
export async function sendUploadBatch(items:BatchUploadItem[],options:{concurrency?:number;fetcher?:typeof fetch;timeoutForSize?:(size:number)=>number}={}):Promise<BatchUploadSummary> {
 const concurrency=Math.max(1,Math.floor(options.concurrency??MULTI_UPLOAD_CONCURRENCY));
 const fetcher=options.fetcher??fetch,timeoutForSize=options.timeoutForSize??uploadTimeoutMsForSize;
 const accepted=items.slice(0,MULTI_UPLOAD_MAX_FILES),truncated=items.length-accepted.length;
 const indexed=accepted.map((item,index)=>({item,index}));
 const results=new Array<BatchUploadResult>(accepted.length);
 const small=indexed.filter(({item})=>item.size<=MULTI_UPLOAD_LARGE_THRESHOLD_BYTES);
 const large=indexed.filter(({item})=>item.size>MULTI_UPLOAD_LARGE_THRESHOLD_BYTES);
 const runOne=async({item,index}:{item:BatchUploadItem;index:number})=>{
  const result=await sendFileUpload(item.attempt,{fetcher,timeoutMs:timeoutForSize(item.size)});
  results[index]={fileName:item.fileName,size:item.size,result};
 };
 // Мелкие файлы — ограниченным пулом; крупные — строго по одному после них.
 let cursor=0;
 const poolSize=small.length?Math.min(concurrency,small.length):0;
 await Promise.all(Array.from({length:poolSize},async()=>{
  while(cursor<small.length){const next=small[cursor++];await runOne(next);}
 }));
 for(const next of large)await runOne(next);
 return {results,truncated};
}
export function formatUploadDiagnostics(value:UploadFailure) {
 return [`HTTP: ${value.httpStatus??"нет ответа"}`,`Code: ${value.code}`,`Request ID: ${value.requestId}`,`Client mutation ID: ${value.clientMutationId}`,`Phase: ${value.details.phase}`,`Commit state: ${value.commitState}`,`Cause: ${value.details.message}`].join("\n");
}
export type LegacyCopyTarget=Pick<HTMLTextAreaElement,"focus"|"select">&{ownerDocument:Pick<Document,"execCommand"|"activeElement">};
export async function copyUploadDiagnostics(value:UploadFailure,writeText?:(text:string)=>Promise<void>,legacyTarget?:LegacyCopyTarget) {
 const text=formatUploadDiagnostics(value);
 try{if(writeText){await writeText(text);return;}if(typeof navigator==="undefined"||!navigator.clipboard?.writeText)throw Error("CLIPBOARD_UNAVAILABLE");await navigator.clipboard.writeText(text);return;}catch{
  if(!legacyTarget)throw Error("CLIPBOARD_UNAVAILABLE");
  const previous=legacyTarget.ownerDocument.activeElement;
  legacyTarget.focus({preventScroll:true});legacyTarget.select();
  let copied=false;try{copied=legacyTarget.ownerDocument.execCommand("copy");}catch{/* Выделенный readonly текст остаётся доступен для ручного копирования. */}
  if(!copied)throw Error("CLIPBOARD_COPY_FAILED");
  if(previous&&previous!==(legacyTarget as unknown as Element)&&typeof (previous as HTMLElement).focus==="function")try{(previous as HTMLElement).focus({preventScroll:true});}catch{/* Удалённый триггер не меняет подтверждённый результат copy. */}
 }
}
