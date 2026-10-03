"use client";
import {useEffect,useRef,useState} from "react";
import Image from "next/image";
import {useRouter} from "next/navigation";
import {Trash2,UploadCloud} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Dialog,DialogContent,DialogHeader,DialogTitle} from "@/components/ui/dialog";
import {ConfirmDeleteDialog} from "@/components/confirm-delete-dialog";
import {UploadErrorDetails} from "@/components/upload-error-details";
import {useFileViewer} from "@/components/file-viewer";
import {catalogueMediaUrl} from "@/lib/catalogue-media-url";
import {createUploadAttempt,sendFileUpload,localUploadFailure,type UploadAttempt,type UploadFailure} from "@/lib/file-upload-client";
import {createRequestId} from "@/lib/request-id";
import type {CatalogueSampleView,SampleTarget} from "@/server/catalogue-media/contracts";

type Props={finishId:string;revision:number;sampleAssetId:string|null;asset:CatalogueSampleView|null;canManage:boolean};
type Confirmed={revision:number;sampleAssetId:string|null;asset:CatalogueSampleView|null};
type Attempt={kind:"upload"|"delete";target:SampleTarget;transport:UploadAttempt};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME=new Set(["image/png","image/jpeg","image/webp","image/avif","image/gif"]);
export function latestCatalogueSample(old:Confirmed,props:Confirmed,ack?:Confirmed):Confirmed{
 const latest=props.revision>=old.revision?props:old;
 return ack&&ack.revision>=latest.revision?ack:latest;
}
export function readCatalogueSampleAck(value:unknown,target:SampleTarget):Confirmed{
 if(!value||typeof value!=="object")throw Error("Не получено подтверждение изображения. Повторите прежний запрос.");
 const result=value as Record<string,unknown>,asset=result.asset as CatalogueSampleView|null;
 if(result.ok!==true||result.finishId!==target.finishId||result.clientMutationId!==target.clientMutationId||!Number.isSafeInteger(result.finishRevision)||Number(result.finishRevision)<target.expectedRevision||Number(result.finishRevision)>2147483647||!(result.sampleAssetId===null||typeof result.sampleAssetId==="string"&&UUID.test(result.sampleAssetId))||(result.sampleAssetId===null?asset!==null:!asset||asset.id!==result.sampleAssetId||!UUID.test(asset.id)||typeof asset.fileName!=="string"||!asset.fileName||!MIME.has(asset.mimeType)||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>25*1024*1024))throw Error("Не получено подтверждение изображения. Повторите прежний запрос.");
 return{revision:Number(result.finishRevision),sampleAssetId:result.sampleAssetId as string|null,asset};
}
export function CatalogueSampleThumbnail({asset}:{asset:CatalogueSampleView|null}){
 const viewer=useFileViewer("cover-fullscreen");
 return <>{asset?<button type="button" className="inline-flex size-16 items-center justify-center overflow-hidden rounded border bg-muted/20" aria-label={`Открыть образец ${asset.fileName}`} onClick={event=>{event.stopPropagation();viewer.open({...asset,scope:"catalogue-media"});}}><Image src={catalogueMediaUrl(asset.id,"thumbnail")} width={64} height={64} unoptimized className="size-16 object-contain" alt={asset.fileName}/></button>:null}{viewer.viewer}</>;
}
export function CatalogueSampleControl({finishId,revision,sampleAssetId,asset,canManage}:Props){
 const router=useRouter(),input=useRef<HTMLInputElement>(null),active=useRef<Attempt|null>(null),pending=useRef(false);
 const[current,setCurrent]=useState<Confirmed>({revision,sampleAssetId,asset}),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[open,setOpen]=useState(false),[removeOpen,setRemoveOpen]=useState(false),[failure,setFailure]=useState<UploadFailure|null>(null);
 const latestProps=useRef<Confirmed>({revision,sampleAssetId,asset});latestProps.current={revision,sampleAssetId,asset};
 useEffect(()=>{setCurrent(old=>latestCatalogueSample(old,{revision,sampleAssetId,asset}));},[revision,sampleAssetId,asset]);
 async function submit(attempt:Attempt){
  if(pending.current)return false;pending.current=true;setBusy(true);setFailure(null);active.current=attempt;
  try{
   const result=await sendFileUpload(attempt.transport,{endpoint:"/api/catalogue-media/upload",...(attempt.kind==="delete"?{fetcher:async(_url:RequestInfo|URL,init?:RequestInit)=>fetch("/api/catalogue-media/sample",{...init,method:"DELETE",headers:{...init?.headers,"content-type":"application/json"},body:JSON.stringify(attempt.target)})}:{} )});
   if(!result.ok){setFailure(result.failure);const uncertain=result.failure.commitState!=="notCommitted";setUnknown(uncertain);if(!uncertain)active.current=null;if(attempt.kind==="delete")setRemoveOpen(false);return false;}
   const confirmed=readCatalogueSampleAck(result.data,attempt.target);
   setCurrent(old=>latestCatalogueSample(old,latestProps.current,confirmed));active.current=null;setUnknown(false);setOpen(false);setRemoveOpen(false);router.refresh();return true;
  }catch(error){setUnknown(true);setFailure(localUploadFailure(error instanceof Error?error.message:"Не удалось подтвердить изображение","confirmation",attempt.target.clientMutationId,"unknown"));if(attempt.kind==="delete")setRemoveOpen(false);return false;}
  finally{pending.current=false;setBusy(false);}
 }
 function upload(file:File){
  if(pending.current||active.current)return;
  if(!["image/png","image/jpeg","image/webp","image/avif","image/gif"].includes(file.type)||file.size<=0||file.size>25*1024*1024){setFailure(localUploadFailure("Выберите изображение до 25 МБ"));return;}
  const target:SampleTarget={finishId,expectedSampleAssetId:current.sampleAssetId,expectedRevision:current.revision,clientMutationId:createRequestId()},form=new FormData();
  form.append("file",file);form.append("finishId",finishId);form.append("expectedSampleAssetId",target.expectedSampleAssetId??"null");form.append("expectedRevision",String(target.expectedRevision));
  void submit({kind:"upload",target,transport:createUploadAttempt(form,target.clientMutationId)});
 }
 async function remove(){
  if(pending.current)return false;if(active.current)return submit(active.current);
  if(!current.sampleAssetId)return false;
  const target:SampleTarget={finishId,expectedSampleAssetId:current.sampleAssetId,expectedRevision:current.revision,clientMutationId:createRequestId()},form=new FormData();return submit({kind:"delete",target,transport:createUploadAttempt(form,target.clientMutationId)});
 }
 const retry=unknown&&active.current?<Button type="button" variant="outline" disabled={busy} onClick={()=>void submit(active.current!)}>Проверить прежний запрос</Button>:null;
 return <div className="flex min-w-0 flex-wrap items-center gap-2" onClick={event=>event.stopPropagation()}>
  <CatalogueSampleThumbnail asset={current.asset}/>
  {canManage?<><Button type="button" size="sm" disabled={busy||unknown} className="bg-black text-white hover:bg-black/90" onClick={()=>{setFailure(null);setOpen(true);}}><UploadCloud className="size-4"/>{current.asset?"Заменить":"Добавить изображение"}</Button>{current.asset?<Button type="button" variant="destructive" size="icon-sm" disabled={busy||unknown} aria-label="Удалить изображение образца" onClick={()=>{setFailure(null);setRemoveOpen(true);}}><Trash2 className="size-4"/></Button>:null}</>:null}
  {!open&&!removeOpen?<><UploadErrorDetails failure={failure}/>{retry}</>:null}
  <Dialog open={open} onOpenChange={value=>{if(!busy&&!unknown)setOpen(value);}}><DialogContent showCloseButton={!busy&&!unknown} onPaste={event=>{const file=event.clipboardData.files[0];if(file&&!busy&&!unknown){event.preventDefault();upload(file);}}}><DialogHeader><DialogTitle>{current.asset?"Заменить образец":"Добавить изображение образца"}</DialogTitle></DialogHeader><UploadErrorDetails failure={failure}/><Button type="button" disabled={busy||unknown} onClick={()=>input.current?.click()}><UploadCloud className="size-4"/>Выбрать файл</Button><div role="button" tabIndex={busy||unknown?-1:0} aria-label="Выбрать изображение образца" className="flex min-h-40 items-center justify-center rounded border-2 border-dashed p-6 text-center" onClick={()=>{if(!busy&&!unknown)input.current?.click();}} onKeyDown={event=>{if(!busy&&!unknown&&(event.key==="Enter"||event.key===" ")){event.preventDefault();input.current?.click();}}} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const file=event.dataTransfer.files[0];if(file&&!busy&&!unknown)upload(file);}}>Перетащите изображение</div>{busy?<p aria-live="polite">Сохраняется…</p>:null}{retry}</DialogContent></Dialog>
  <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" className="hidden" disabled={busy||unknown} onChange={event=>{const file=event.target.files?.[0];if(file)upload(file);event.target.value="";}}/>
  <ConfirmDeleteDialog open={removeOpen} onOpenChange={value=>{if(!busy&&!unknown)setRemoveOpen(value);}} entityLabel="изображение образца" onConfirm={remove}/>
  {removeOpen?<div className="min-w-0"><UploadErrorDetails failure={failure}/>{retry}</div>:null}
 </div>;
}
