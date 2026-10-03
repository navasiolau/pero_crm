"use client";
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {Trash2,UploadCloud} from 'lucide-react';
import {ProductHeroImage} from './product-hero-image';
import {useFileViewer} from './file-viewer';
import {ConfirmDeleteDialog} from './confirm-delete-dialog';
import {UploadErrorDetails} from './upload-error-details';
import {sendFileUpload,localUploadFailure,type UploadAttempt,type UploadFailure} from '@/lib/file-upload-client';
import {projectCoverAttempt,confirmedProjectCover} from '@/lib/project-cover-upload';
import {createRequestId} from '@/lib/request-id';
import {deleteProjectCoverAction} from '@/server/projects/cover-actions';
import type {ProjectCoverPreview,ProjectCoverDelete} from '@/server/projects/cover-contract';
export function ProjectCover({projectId,cover:initial,canManage,beforeMutation,registerGuard}:{projectId:string;cover:ProjectCoverPreview|null;canManage:boolean;beforeMutation?:()=>Promise<boolean>;registerGuard?:(key:string,guard:()=>Promise<boolean>)=>()=>void}){
 const [storedCover,setCover]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[failure,setFailure]=useState<UploadFailure|null>(null),[confirm,setConfirm]=useState<ProjectCoverPreview|null>(null);
 const input=useRef<HTMLInputElement>(null),attempt=useRef<UploadAttempt|null>(null),deletion=useRef<ProjectCoverDelete|null>(null),active=useRef(false),ack=useRef<{id:string|null}|null>(null);
 const visualProject=useRef(projectId),currentProject=useRef(projectId);currentProject.current=projectId;const cover=visualProject.current===projectId?storedCover:initial;const router=useRouter(),viewer=useFileViewer('cover-fullscreen');
 const preflight=useRef(false);
 useEffect(()=>{if(visualProject.current!==projectId){visualProject.current=projectId;ack.current=null;attempt.current=null;deletion.current=null;setConfirm(null);setFailure(null);setError(null);setCover(initial);}},[projectId,initial]);
 useEffect(()=>registerGuard?.('project-cover',async()=>preflight.current||(!active.current&&!attempt.current&&!deletion.current)),[registerGuard]);
 async function flush(){preflight.current=true;try{return beforeMutation?await beforeMutation():true;}finally{preflight.current=false;}}
 useEffect(()=>{if(active.current||attempt.current||deletion.current)return;if(ack.current&&ack.current.id!==(initial?.id??null))return;ack.current=null;setCover(initial);},[initial]);
 async function upload(file:File){
  if(active.current||!canManage||cover)return;active.current=true;setBusy(true);setError(null);setFailure(null);
  const selectedProject=projectId;let current:UploadAttempt|undefined,confirmation:{httpStatus:number;requestId:string}|undefined,acknowledged=false;
  try{
   if(!await flush())throw Error('\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u043f\u0440\u043e\u0435\u043a\u0442\u0430');
   current=projectCoverAttempt(file,selectedProject);attempt.current=current;
   const result=await sendFileUpload(current);if(currentProject.current!==selectedProject)return;
   if(!result.ok){setFailure(result.failure);return;}
   confirmation={httpStatus:result.httpStatus,requestId:result.requestId};const confirmed=confirmedProjectCover(result.data,current.clientMutationId);acknowledged=true;ack.current={id:confirmed.id};setCover(confirmed);router.refresh();
  }catch(e){if(currentProject.current===selectedProject){const message=e instanceof Error?e.message:'\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043e\u0431\u043b\u043e\u0436\u043a\u0443';setFailure(localUploadFailure(message,current?'confirmation':'validation',current?.clientMutationId,acknowledged?'committed':current?'unknown':'notCommitted',confirmation?.httpStatus,confirmation?.requestId));}}

  finally{attempt.current=null;active.current=false;setBusy(false);}
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
  {cover?<><button type="button" aria-label="Открыть обложку проекта на весь экран" className="absolute inset-0" onClick={()=>viewer.open(cover)}><ProductHeroImage sketch={cover} preview="cover" alt="Обложка проекта" className="absolute inset-0 h-full w-full"/></button>{canManage?<button type="button" aria-label="Удалить обложку проекта" disabled={busy} className="absolute top-2 right-2 z-10 flex size-10 items-center justify-center rounded bg-background/90" onClick={()=>setConfirm(cover)}><Trash2 className="size-5 text-destructive"/></button>:null}</>:canManage?<div role="button" tabIndex={busy?-1:0} aria-label="Выбрать обложку проекта" aria-disabled={busy} className="absolute inset-0 flex cursor-pointer items-center justify-center p-4" onClick={()=>{if(!busy)input.current?.click();}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!busy)input.current?.click();}}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const file=e.dataTransfer.files[0];if(file&&!busy)void upload(file);}}><span className="inline-flex min-h-12 items-center gap-2 rounded-md bg-black px-5 py-3 text-center text-base font-semibold text-white"><UploadCloud className="size-5 shrink-0"/>Добавить обложку проекта</span></div>:<div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Обложка проекта не добавлена</div>}
  {busy?<p role="status" className="absolute bottom-2 left-2 rounded bg-background/90 p-2 text-sm">Сохраняется…</p>:null}
 </div><input ref={input} data-project-cover-input type="file" accept="image/*" className="hidden" disabled={busy||!canManage} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file);}}/>
 {failure?<UploadErrorDetails failure={failure}/>:null}{error?<p role="alert" className="break-words text-sm text-destructive">{error}</p>:null} {viewer.viewer}<ConfirmDeleteDialog open={!!confirm} entityLabel={`обложку проекта «${confirm?.fileName??''}»`} onOpenChange={open=>{if(!open&&!active.current)setConfirm(null);}} onConfirm={remove}/></div>;
}
