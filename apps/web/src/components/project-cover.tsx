"use client";
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {Trash2,UploadCloud} from 'lucide-react';
import {ProductHeroImage} from './product-hero-image';
import {useFileViewer} from './file-viewer';
import {ConfirmDeleteDialog} from './confirm-delete-dialog';
import {UploadErrorDetails} from './upload-error-details';
import {sendFileUpload,uploadAttemptMatchesContext,type UploadAttempt,type UploadFailure} from '@/lib/file-upload-client';
import {projectCoverAttempt,confirmedProjectCover} from '@/lib/project-cover-upload';
import {createRequestId} from '@/lib/request-id';
import {deleteProjectCoverAction} from '@/server/projects/cover-actions';
import type {ProjectCoverPreview,ProjectCoverDelete} from '@/server/projects/cover-contract';
export function ProjectCover({projectId,cover:initial,canManage,beforeMutation,registerGuard}:{projectId:string;cover:ProjectCoverPreview|null;canManage:boolean;beforeMutation?:()=>Promise<boolean>;registerGuard?:(key:string,guard:()=>Promise<boolean>)=>()=>void}){
 const [cover,setCover]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[failure,setFailure]=useState<UploadFailure|null>(null),[confirm,setConfirm]=useState<ProjectCoverPreview|null>(null),[retry,setRetry]=useState(false);
 const input=useRef<HTMLInputElement>(null),attempt=useRef<UploadAttempt|null>(null),deletion=useRef<ProjectCoverDelete|null>(null),active=useRef(false),ack=useRef<{id:string|null}|null>(null);
 const router=useRouter(),viewer=useFileViewer('cover-fullscreen');
 const preflight=useRef(false);
 useEffect(()=>registerGuard?.('project-cover',async()=>preflight.current||(!active.current&&!attempt.current&&!deletion.current)),[registerGuard]);
 async function flush(){preflight.current=true;try{return beforeMutation?await beforeMutation():true;}finally{preflight.current=false;}}
 useEffect(()=>{if(active.current||attempt.current||deletion.current)return;if(ack.current&&ack.current.id!==(initial?.id??null))return;ack.current=null;setCover(initial);},[initial]);
 async function upload(file?:File){
  if(active.current||!canManage||cover)return;active.current=true;setBusy(true);setError(null);setFailure(null);
  try{
   if(!await flush())throw Error('Сначала сохраните изменения проекта');
   if(!attempt.current){if(!file)return;attempt.current=projectCoverAttempt(file,projectId);}else if(file)throw Error('Повторите прежнюю загрузку для проверки результата');
   const current=attempt.current;if(!uploadAttemptMatchesContext(current,{projectId}))throw Error('Сохранённая загрузка относится к другому проекту. Вернитесь к исходной карточке.');
   const result=await sendFileUpload(current);
   if(!result.ok){setFailure(result.failure);if(result.failure.commitState==='notCommitted'){attempt.current=null;setRetry(false);}else setRetry(true);return;}
   const confirmed=confirmedProjectCover(result.data,current.clientMutationId);ack.current={id:confirmed.id};setCover(confirmed);attempt.current=null;setRetry(false);router.refresh();
  }catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить обложку');if(attempt.current)setRetry(true);}
  finally{active.current=false;setBusy(false);}
 }
 async function remove(){
  if(active.current||!confirm||!canManage)return false;active.current=true;setBusy(true);setError(null);
  try{
   if(!await flush())throw Error('Сначала сохраните изменения проекта');
   deletion.current??={projectId,expectedCoverFileId:confirm.id,clientMutationId:createRequestId()};const current=deletion.current;
   if(current.projectId!==projectId||current.expectedCoverFileId!==confirm.id)throw Error('Подтверждение относится к другой обложке. Вернитесь к исходной карточке.');
   const result=await deleteProjectCoverAction(current);
   if(!result.ok)throw Error(result.error);
   if(result.clientMutationId!==current.clientMutationId||result.coverFileId!==null)throw Error('Не получено подтверждение удаления. Повторите запрос.');
   deletion.current=null;ack.current={id:null};setCover(null);router.refresh();return true;
  }catch(e){setError(e instanceof Error?e.message:'Не удалось удалить обложку');return false;}
  finally{active.current=false;setBusy(false);}
 }
 return <div className="min-w-0 space-y-2"><div data-project-cover data-cover-state={cover?'filled':'empty'} className="relative aspect-[4/3] min-w-0 overflow-hidden rounded-lg border bg-muted/20">
  {cover?<><button type="button" aria-label="Открыть обложку проекта на весь экран" className="absolute inset-0" onClick={()=>viewer.open(cover)}><ProductHeroImage sketch={cover} preview="cover" alt="Обложка проекта" className="absolute inset-0 h-full w-full"/></button>{canManage?<button type="button" aria-label="Удалить обложку проекта" disabled={busy} className="absolute top-2 right-2 z-10 flex size-10 items-center justify-center rounded bg-background/90" onClick={()=>setConfirm(cover)}><Trash2 className="size-5 text-destructive"/></button>:null}</>:canManage?<div role="button" tabIndex={busy?-1:0} aria-label="Выбрать обложку проекта" aria-disabled={busy} className="absolute inset-0 flex cursor-pointer items-center justify-center p-4" onClick={()=>{if(!busy&&!attempt.current)input.current?.click();}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!busy&&!attempt.current)input.current?.click();}}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const file=e.dataTransfer.files[0];if(file&&!busy)void upload(file);}}><span className="inline-flex min-h-12 items-center gap-2 rounded-md bg-black px-5 py-3 text-center text-base font-semibold text-white"><UploadCloud className="size-5 shrink-0"/>Добавить обложку проекта</span></div>:<div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Обложка проекта не добавлена</div>}
  {busy?<p role="status" className="absolute bottom-2 left-2 rounded bg-background/90 p-2 text-sm">Сохраняется…</p>:null}
 </div><input ref={input} data-project-cover-input type="file" accept="image/*" className="hidden" disabled={busy||!canManage} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file);}}/>
 {failure?<UploadErrorDetails failure={failure}/>:null}{error?<p role="alert" className="break-words text-sm text-destructive">{error}</p>:null}{retry?<button type="button" disabled={busy} className="min-h-11 rounded border px-4" onClick={()=>void upload()}>Повторить прежнюю загрузку</button>:null}
 {viewer.viewer}<ConfirmDeleteDialog open={!!confirm} entityLabel={`обложку проекта «${confirm?.fileName??''}»`} onOpenChange={open=>{if(!open&&!active.current)setConfirm(null);}} onConfirm={remove}/></div>;
}
