"use client";
import {useEffect,useRef,useState} from 'react';
import type {ProjectStage} from '@prisma/client';
import {toast} from 'sonner';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {STAGES,stageLabels} from '@/lib/stages';
import {patchProjectStage} from '@/server/projects/stage-actions';
import type {ProjectStagePatch,StageExtras} from '@/server/projects/stage-contract';
import {StageFormDialog,type StageFormRequest} from '@/app/(app)/projects/stage-form-dialog';
export function ProjectStageControl({projectId,stage,canManage,onBeforeChange,onConfirmed}:{projectId:string;stage:ProjectStage;canManage:boolean;onBeforeChange?:()=>Promise<boolean>;onConfirmed?:(stage:ProjectStage)=>void}){
 const [confirmed,setConfirmed]=useState(stage);const[pending,setPending]=useState(false);const[request,setRequest]=useState<StageFormRequest|null>(null);const[errors,setErrors]=useState<Record<string,string>>({});
 const retry=useRef<ProjectStagePatch|null>(null);
 useEffect(()=>{setConfirmed(stage)},[stage]);
 async function save(toStage:ProjectStage,extras?:StageExtras,expectedStage=confirmed){
  if(pending)return false;setPending(true);setErrors({});
  try{
   if(onBeforeChange&&!await onBeforeChange())return false;
   const candidate={projectId,toStage,expectedStage,extras};
   if(!retry.current||JSON.stringify({...retry.current,clientMutationId:undefined})!==JSON.stringify(candidate))retry.current={...candidate,clientMutationId:crypto.randomUUID()};
   const result=await patchProjectStage(retry.current);
   if(!result.ok){setErrors(result.errors??{});toast.error(result.error??'Не удалось сменить этап');retry.current=null;return false}
   setConfirmed(result.stage??toStage);onConfirmed?.(result.stage??toStage);retry.current=null;setRequest(null);return true;
  }catch{toast.error('Ответ не получен. Повторите сохранение');return false}finally{setPending(false)}
 }
 return <><Select value={confirmed} disabled={!canManage||pending} onValueChange={value=>{if(!value||value===confirmed)return;const next=value as ProjectStage;if(next==='REFUSED'||next==='RECLAMATION'){setErrors({});setRequest({projectId,fromStage:confirmed,toStage:next})}else void save(next)}}><SelectTrigger aria-label="Статус"><SelectValue>{stageLabels[confirmed]}</SelectValue></SelectTrigger><SelectContent>{STAGES.map(item=><SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select><StageFormDialog request={request} errors={errors} onClose={()=>setRequest(null)} onSubmit={(item,values)=>save(item.toStage,values,item.fromStage)}/></>;
}
