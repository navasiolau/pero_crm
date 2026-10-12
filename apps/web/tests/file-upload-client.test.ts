import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createUploadAttempt,sendFileUpload,formatUploadDiagnostics,copyUploadDiagnostics,localUploadFailure,uploadAttemptMatchesContext,type LegacyCopyTarget} from "../src/lib/file-upload-client";
import {UploadErrorDetails} from "../src/components/upload-error-details";
Object.assign(globalThis,{React});
const cid="11111111-1111-4111-8111-111111111111";
function attempt(){const form=new FormData();form.append("file",new File([new Uint8Array([1,2,3])],"photo.png",{type:"image/png"}));form.append("projectId","project");form.append("section","MEASUREMENT");return createUploadAttempt(form,cid);}
test("JSON failure preserves actual HTTP/code/requestId/phase and safe cause",async()=>{
 const result=await sendFileUpload(attempt(),{fetcher:async()=>new Response(JSON.stringify({ok:false,error:"Не удалось сохранить файл",code:"STORAGE_FAILED",requestId:"request-47",details:{phase:"storage-original",message:"Хранилище недоступно"},commitState:"notCommitted"}),{status:503})});
 assert.equal(result.ok,false);if(result.ok)return;const details=formatUploadDiagnostics(result.failure);assert.match(details,/HTTP: 503/);assert.match(details,/STORAGE_FAILED/);assert.match(details,/request-47/);assert.match(details,/storage-original/);assert.match(details,/Хранилище недоступно/);assert.equal(result.failure.commitState,"notCommitted");
 const committed=await sendFileUpload(attempt(),{fetcher:async()=>new Response(JSON.stringify({ok:false,error:"Повторите прежний запрос",commitState:"committed",details:{phase:"confirmation",message:"Auth: Bearer private-token\n at hidden-stack"}}),{status:500})});assert.equal(committed.ok,false);if(!committed.ok){assert.equal(committed.failure.commitState,"committed");assert.doesNotMatch(formatUploadDiagnostics(committed.failure),/private-token|hidden-stack/);}
});
test("HTML/nonJSON/invalid success do not leak bodies and retain unknown commit status",async()=>{
 for(const response of [new Response('<html>secret=hidden-token</html>',{status:502,headers:{'content-type':'text/html'}}),new Response('{bad',{status:500}),new Response(JSON.stringify({ok:true,id:"file",clientMutationId:"wrong"}),{status:200})]){const result=await sendFileUpload(attempt(),{fetcher:async()=>response});assert.equal(result.ok,false);if(result.ok)continue;assert.equal(result.failure.commitState,"unknown");assert.doesNotMatch(formatUploadDiagnostics(result.failure),/hidden-token|<html>|\{bad/);}
});
test("same attempt retries original bytes/context/CID only on explicit second call",async()=>{
 const original=attempt(),bodies:FormData[]=[];let calls=0;
 const fetcher:typeof fetch=async(_url,init)=>{calls++;bodies.push(init!.body as FormData);if(calls===1)throw Error("network lost Authorization: Bearer live-secret");return new Response(JSON.stringify({ok:true,id:"file",clientMutationId:cid,repeated:true}),{status:200});};
 const lost=await sendFileUpload(original,{fetcher});assert.equal(calls,1);assert.equal(lost.ok,false);if(!lost.ok){assert.equal(lost.failure.commitState,"unknown");assert.doesNotMatch(formatUploadDiagnostics(lost.failure),/live-secret/);}
 const repeated=await sendFileUpload(original,{fetcher});assert.equal(repeated.ok,true);assert.equal(calls,2);assert.equal(bodies[0],bodies[1]);assert.equal(bodies[1].get("clientMutationId"),cid);assert.equal(bodies[1].get("projectId"),"project");assert.deepEqual(new Uint8Array(await (bodies[1].get("file") as File).arrayBuffer()),new Uint8Array([1,2,3]));
 assert.equal(uploadAttemptMatchesContext(original,{projectId:"project",section:"MEASUREMENT"}),true);assert.equal(uploadAttemptMatchesContext(original,{projectId:"other",section:"MEASUREMENT"}),false);assert.equal(uploadAttemptMatchesContext(original,{projectId:"project",section:"INSTALLATION"}),false);
});
test("timeout abort is explicit unknown and JSON validation/conflict preserve definite semantics",async()=>{
 const result=await sendFileUpload(attempt(),{timeoutMs:5,fetcher:async(_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener("abort",()=>reject(Object.assign(Error("aborted"),{name:"AbortError"}))))});assert.equal(result.ok,false);if(!result.ok){assert.equal(result.failure.code,"UPLOAD_TIMEOUT");assert.equal(result.failure.commitState,"unknown");}
 const conflict=await sendFileUpload(attempt(),{fetcher:async()=>new Response(JSON.stringify({ok:false,error:"Эскиз изменился",kind:"conflict",code:"COVER_CONFLICT",details:{phase:"context",message:"Проверьте актуальный эскиз"},commitState:"notCommitted"}),{status:409})});assert.equal(conflict.ok,false);if(!conflict.ok){assert.equal(conflict.failure.kind,"conflict");assert.equal(conflict.failure.httpStatus,409);assert.equal(conflict.failure.commitState,"notCommitted");}
});
test("collapsed accessible diagnostics textarea has icon-only copy and copies exact sanitized content",async()=>{
 const failure=localUploadFailure("Ошибка","validation",cid);const markup=renderToStaticMarkup(createElement(UploadErrorDetails,{failure}));assert.match(markup,/<details/);assert.doesNotMatch(markup,/<details[^>]* open/);assert.match(markup,/Технические подробности/);assert.match(markup,/readonly=""/i);assert.match(markup,/font-mono/);assert.match(markup,/aria-label="Копировать технические подробности"/);assert.match(markup,/min-w-0/);
 let copied="";await copyUploadDiagnostics(failure,async value=>{copied=value;});assert.equal(copied,formatUploadDiagnostics(failure));await assert.rejects(copyUploadDiagnostics(failure,async()=>{throw Error("clipboard unavailable");}));
});
test("HTTP unavailable/denied clipboard uses existing readonly textarea legacy copy and restores focus",async()=>{
 const failure=localUploadFailure("Ошибка","validation",cid);const calls:string[]=[];
 const previous={focus(options:FocusOptions){assert.equal(options.preventScroll,true);calls.push("return-focus");}};
 const target={focus(options:FocusOptions){assert.equal(options.preventScroll,true);calls.push("textarea-focus");},select(){calls.push("select");},ownerDocument:{activeElement:previous,execCommand(command:string){assert.equal(command,"copy");calls.push("copy");return true;}}} as unknown as LegacyCopyTarget;
 await copyUploadDiagnostics(failure,undefined,target);assert.deepEqual(calls,["textarea-focus","select","copy","return-focus"]);calls.length=0;
 await copyUploadDiagnostics(failure,async()=>{throw Error("denied");},target);assert.deepEqual(calls,["textarea-focus","select","copy","return-focus"]);
 target.ownerDocument.execCommand=()=>false;await assert.rejects(copyUploadDiagnostics(failure,async()=>{throw Error("denied");},target),/CLIPBOARD_COPY_FAILED/);
});
test("quoted JSON camelCase credentials and raw signed URL fields never reach displayed/copied diagnostics",async()=>{
 const secretMessage='{"password":"pw-sensitive","token":"tok-sensitive","Authorization":"Bearer auth-sensitive","secretAccessKey":"secret-sensitive","accessKeyId":"key-sensitive"} X-Amz-Signature=sig-sensitive&X-Amz-Credential=cred-sensitive&X-Amz-Security-Token=security-sensitive';
 const result=await sendFileUpload(attempt(),{fetcher:async()=>new Response(JSON.stringify({ok:false,error:secretMessage,details:{phase:"storage-original",message:secretMessage},commitState:"notCommitted"}),{status:500})});assert.equal(result.ok,false);if(result.ok)return;assert.doesNotMatch(result.failure.error,/sensitive/);assert.doesNotMatch(formatUploadDiagnostics(result.failure),/sensitive/);let copied="";await copyUploadDiagnostics(result.failure,async text=>{copied=text;});assert.doesNotMatch(copied,/sensitive/);
});

test("declared target header preserves the same form and nonce without reading file bytes",async()=>{
 const original=attempt(),file=original.form.get("file") as File;let byteReads=0,streamReads=0,called=false;
 file.arrayBuffer=async()=>{byteReads++;throw Error("FILE_BYTES_BEFORE_FETCH");};
 file.stream=()=>{streamReads++;throw Error("FILE_STREAM_BEFORE_FETCH");};
 const result=await sendFileUpload(original,{fetcher:async(_url,init)=>{
  called=true;assert.equal(init!.body,original.form);const headers=new Headers(init!.headers);
  assert.equal(headers.get("x-request-id"),cid);
  const header=headers.get("x-pero-upload-context");assert.ok(header,"declared context must be sent");
  assert.ok(/^[\x20-\x7e]+$/.test(header));assert.ok(Buffer.byteLength(header)<=4096);
  assert.deepEqual(JSON.parse(decodeURIComponent(header)),{version:1,fields:{projectId:"project",section:"MEASUREMENT",clientMutationId:cid}});
  assert.equal(byteReads,0);assert.equal(streamReads,0);
  return new Response(JSON.stringify({ok:true,id:"file",clientMutationId:cid}),{status:200});
 }});
 assert.equal(called,true);assert.equal(result.ok,true);assert.equal(byteReads,0);assert.equal(streamReads,0);
});