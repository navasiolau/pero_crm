import {revalidatePath} from 'next/cache';
import {withTaskTransaction} from '@/server/tasks/transaction';
import {dispatchEvent} from '@/server/plugins/events';
import {notifyOrg} from '@/server/notifications/notify';
import {stageLabels} from '@/lib/stages';
import {revalidateProductPaths} from '@/server/products/revalidate';
import type {ProjectStage} from '@prisma/client';
import type {DomainActor} from './core';
import {patchProjectStageTransaction} from './stage-core';
import {projectStagePatchSchema,type ProjectStageResult} from './stage-contract';
export async function patchProjectStageCore(actor:DomainActor,input:unknown):Promise<ProjectStageResult>{
 const parsed=projectStagePatchSchema.safeParse(input);
 if(!parsed.success)return{ok:false,kind:'validation',error:'Обновите форму: необходимы исходный статус и идентификатор операции'};
 let committed;
 try{committed=await withTaskTransaction(tx=>patchProjectStageTransaction(actor,parsed.data,tx));}
 catch{return{ok:false,kind:'failure',clientMutationId:parsed.data.clientMutationId,error:'Не удалось изменить статус'};}
 if(!committed.result.ok||!committed.eventIds.length)return committed.result;
 for(const id of committed.eventIds)await dispatchEvent(id).catch(()=>{});
 await notifyOrg({type:'project.stageChanged',title:`${committed.project!.number}: ${stageLabels[committed.fromStage as ProjectStage]} → ${stageLabels[parsed.data.toStage]}`,body:committed.project!.title,link:`/projects/${parsed.data.projectId}`,exceptUserId:actor.id}).catch(()=>{});
 // Инвалидация выполняется до ACK, как у прежней статусной операции.
 revalidatePath(`/projects/${parsed.data.projectId}`);revalidatePath('/projects');
 if(committed.productIds?.length){revalidatePath('/products');for(const productId of committed.productIds)await revalidateProductPaths(productId);}
 return committed.result;
}
