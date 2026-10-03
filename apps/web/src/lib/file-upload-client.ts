import {createRequestId} from "./request-id";
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
 const keys=["projectId","productId","taskId","category","stage","assignCover","expectedSketchFileId"];
 return keys.every(key=>(attempt.form.get(key)??undefined)===fields[key]);
}
export function localUploadFailure(message:string,phase:UploadPhase="validation",clientMutationId=createRequestId(),commitState:UploadCommitState="notCommitted",httpStatus?:number,requestId=clientMutationId):UploadFailure {
 const error=safeText(message,"Не удалось выполнить файловую операцию.",300);return {error,code:phase==="confirmation"?"UPLOAD_CONFIRMATION_REQUIRED":"CLIENT_VALIDATION",requestId,clientMutationId,httpStatus,commitState,details:{phase,message:error}};
}
function failure(attempt:UploadAttempt,options:{error:string;code:string;message:string;phase:UploadPhase;response?:Response;requestId?:unknown;kind?:unknown;commitState:UploadCommitState}):UploadResult {
 return {ok:false,failure:{error:safeText(options.error,"Не удалось загрузить файл.",300),code:safeId(options.code,"UPLOAD_FAILED"),requestId:safeId(options.requestId,safeId(options.response?.headers.get("x-request-id"),attempt.clientMutationId)),clientMutationId:attempt.clientMutationId,httpStatus:options.response?.status,kind:typeof options.kind==="string"?safeText(options.kind,"",40):undefined,commitState:options.commitState,details:{phase:options.phase,message:safeText(options.message,"Причина не указана")}}};
}
export type UploadEndpoint="/api/files/upload"|"/api/catalogue-media/upload";
export async function sendFileUpload(attempt:UploadAttempt,{fetcher=fetch,timeoutMs=60000,endpoint="/api/files/upload"}:{fetcher?:typeof fetch;timeoutMs?:number;endpoint?:UploadEndpoint}={}):Promise<UploadResult> {
 if(endpoint!=="/api/files/upload"&&endpoint!=="/api/catalogue-media/upload")return {ok:false,failure:localUploadFailure("Неверный адрес загрузки","request",attempt.clientMutationId)};
 const controller=new AbortController();let response:Response|undefined,timedOut=false,timer:ReturnType<typeof setTimeout>|undefined;
 const unknown=(code:string,error:string,message:string)=>failure(attempt,{code,error,message,phase:response?"confirmation":"request",response,commitState:"unknown"});
 const timeout=new Promise<UploadResult>(resolve=>{timer=setTimeout(()=>{timedOut=true;controller.abort();resolve(unknown("UPLOAD_TIMEOUT","Загрузка не завершилась вовремя. Повторите прежний запрос.","Время ожидания ответа истекло; результат записи не подтверждён."));},timeoutMs);});
 const work=(async():Promise<UploadResult>=>{
  try{
   response=await fetcher(endpoint,{method:"POST",body:attempt.form,headers:{"x-request-id":attempt.clientMutationId},signal:controller.signal});
   let data:unknown;try{data=await response.json();}catch{return unknown("UPLOAD_NON_JSON_RESPONSE","Сервер вернул неожиданный ответ. Повторите прежнюю загрузку.","Ответ сервера не удалось прочитать как JSON.");}
   if(plain(data)&&response.ok&&data.ok===true&&typeof data.id==="string"&&data.id&&data.clientMutationId===attempt.clientMutationId)return {ok:true,data:data as UploadSuccessData,httpStatus:response.status,requestId:safeId(data.requestId,safeId(response.headers.get("x-request-id"),attempt.clientMutationId))};
   if(plain(data)&&data.ok===false){const details=plain(data.details)?data.details:{};const phase=PHASES.includes(details.phase as UploadPhase)?details.phase as UploadPhase:"confirmation";const commitState=["notCommitted","committed","unknown"].includes(String(data.commitState))?data.commitState as UploadCommitState:response.status>=400&&response.status<500?"notCommitted":"unknown";
    return failure(attempt,{error:typeof data.error==="string"?data.error:"Не удалось загрузить файл.",code:safeId(data.code,`UPLOAD_HTTP_${response.status}`),message:typeof details.message==="string"?details.message:"Сервер отклонил загрузку; техническая причина не передана.",phase,response,requestId:data.requestId,kind:data.kind,commitState});}
   return unknown("UPLOAD_ACK_INVALID","Не получено подтверждение загрузки. Повторите прежний запрос.","Ожидался успешный ответ с id и исходным clientMutationId.");
  }catch(error){return timedOut?unknown("UPLOAD_TIMEOUT","Загрузка не завершилась вовремя. Повторите прежний запрос.","Время ожидания ответа истекло; результат записи не подтверждён."):unknown("UPLOAD_NETWORK","Не удалось связаться с сервером. Повторите прежнюю загрузку.",`Сетевая ошибка (${error instanceof Error?safeText(error.name,"Error",40):"Error"}); результат записи не подтверждён.`);}
 })();
 try{return await Promise.race([work,timeout]);}finally{if(timer)clearTimeout(timer);}
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
