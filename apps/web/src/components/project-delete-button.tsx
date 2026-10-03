"use client";
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {Trash2} from 'lucide-react';
import {Button} from './ui/button';
import {ConfirmDeleteDialog} from './confirm-delete-dialog';
import {useProjectInline} from './project-inline-provider';
import {createRequestId} from '@/lib/request-id';
import {PROJECT_DELETE_WARNING,isConfirmedProjectDelete} from '@/lib/project-delete-ui';
import {readProjectDeleteBaseline,deleteProjectAction} from '@/server/projects/delete-actions';
import type {ProjectDeleteBaseline,ProjectDeleteInput} from '@/server/projects/delete-contract';
export function ProjectDeleteButton({projectId,canManage}:{projectId:string;canManage:boolean}){
 const [baseline,setBaseline]=useState<ProjectDeleteBaseline|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const active=useRef(false),attempt=useRef<ProjectDeleteInput|null>(null),preflight=useRef(false),inline=useProjectInline(),router=useRouter();
 useEffect(()=>inline.registerGuard('project-delete',async()=>preflight.current||(!active.current&&!attempt.current)),[inline]);
 async function open(){if(active.current||!canManage)return;active.current=true;setBusy(true);setError(null);try{
  if(attempt.current){if(attempt.current.projectId!==projectId)throw Error('Подтверждение относится к другому проекту');return;}
  preflight.current=true;try{if(!await inline.flush())throw Error('Сначала сохраните изменения проекта');}finally{preflight.current=false;}
  const result=await readProjectDeleteBaseline(projectId);if(!result.ok)throw Error(result.error);setBaseline(result.baseline);
 }catch(e){setError(e instanceof Error?e.message:'Не удалось открыть подтверждение');}finally{active.current=false;setBusy(false);}}
 async function confirm(){if(active.current||!baseline||!canManage)return false;active.current=true;setBusy(true);setError(null);try{
  attempt.current??={projectId:baseline.projectId,expectedUpdatedAt:baseline.expectedUpdatedAt,expectedProductsVersion:baseline.expectedProductsVersion,clientMutationId:createRequestId()};const current=attempt.current;
  if(current.projectId!==projectId)throw Error('Подтверждение относится к другому проекту');
  const result=await deleteProjectAction(current);
  if(!result.ok){if(result.kind!=='failure')attempt.current=null;throw Error(result.error);}
  if(!isConfirmedProjectDelete(result,current))throw Error('Не получено подтверждение удаления. Повторите тот же запрос');
  attempt.current=null;router.push('/projects');router.refresh();return true;
 }catch(e){setError(e instanceof Error?e.message:'Не получено подтверждение удаления');return false;}finally{active.current=false;setBusy(false);}}
 if(!canManage)return null;
 return <div className="min-w-0"><Button variant="destructive" disabled={busy} className="min-h-11 gap-2" onClick={()=>void open()}><Trash2 className="size-4"/>Удалить</Button>{error?<p role="alert" className="mt-2 break-words text-sm text-destructive">{error}</p>:null}
 <ConfirmDeleteDialog open={!!baseline} entityLabel={`проект ${baseline?.number??''} «${baseline?.title??''}» (изделий: ${baseline?.productCount??0})`} warning={PROJECT_DELETE_WARNING} onOpenChange={value=>{if(!value&&!active.current&&!attempt.current)setBaseline(null);}} onConfirm={confirm}/></div>;
}
