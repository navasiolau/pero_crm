import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import {liveProjectWhere} from "@/server/access/live-entities";
import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {MANAGER_ROLES,hasAnyRole} from '@/lib/roles';
import type {DomainActor} from './core';
import {projectStagePatchSchema,archivedProjectStagePatchSchema,validateStageExtras,type ProjectStageResult} from './stage-contract';
import {lockProjectRow} from './lock';
import {promoteProjectDrafts} from '@/server/products/draft-core';
import {applyProposalStageGateInTransaction} from '@/server/kp/stage-gate';
import {ProposalLifecycleError} from '@/server/kp/lifecycle-contract';
import {isActiveProjectStage} from '@/lib/stages';
import type {JournalPresentationHints} from '@/server/changelog/contract';
import {projectJournalContext} from './journal';

/** Одна транзакция для селекта, доски и бота; проценты изделий не начисляет. */
export async function patchProjectStageTransaction(actor:DomainActor,input:unknown,tx:Prisma.TransactionClient,journalHints?:JournalPresentationHints, operationRootId?: string):Promise<{result:ProjectStageResult;eventIds:string[];project?:{number:string;title:string};fromStage?:string;productIds?:string[]}>{
 const parsed=archivedProjectStagePatchSchema.safeParse(input);
 if(!parsed.success)return{result:{ok:false,kind:'validation',error:'Обновите форму: необходимы исходный статус и идентификатор операции'},eventIds:[]};
 const request=parsed.data;
 const fail=(kind:ProjectStageResult['kind'],error:string,extra:Partial<ProjectStageResult>={})=>({result:{ok:false,kind,error,clientMutationId:request.clientMutationId,...extra},eventIds:[]});
 if(!hasAnyRole(actor.roles,MANAGER_ROLES))return fail('forbidden','Недостаточно прав');
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
 await lockProjectRow(tx,request.projectId);
 const project=await tx.project.findUnique({where:{...liveProjectWhere,id:request.projectId},select:{id:true,stage:true,number:true,title:true,refusalReason:true,refusalComment:true}});
 if(!project)return fail('not-found','Проект не найден');
 const receiptId=`project-stage:${request.clientMutationId}`;
 const fingerprint=createHash('sha256').update(JSON.stringify(request)).digest('hex');
 const receipt=await tx.changeLog.findUnique({where:{id:receiptId}});
 if(receipt){
  const saved=receipt.newValue;
  if(receipt.actorType!=='user'||receipt.actorId!==actor.id||receipt.field!=='stage'||receipt.entity!=='project'||receipt.entityId!==request.projectId||receipt.action!=='stage'||!saved||typeof saved!=='object'||Array.isArray(saved)||saved.fingerprint!==fingerprint)return fail('validation','Идентификатор операции уже использован');
  return{result:{ok:true,kind:'saved',clientMutationId:request.clientMutationId,stage:request.toStage,replayed:true},eventIds:[]};
 }
 const active=projectStagePatchSchema.safeParse(request);
 if(!active.success)return fail('validation','Этот статус или параметры проекта больше не используются');
 const patch=active.data;
 if(!isActiveProjectStage(patch.toStage))return fail('validation','Этот статус проекта больше не используется');
 if(project.stage!==patch.expectedStage)return fail('conflict','Статус изменён другим пользователем. Обновите карточку',{stage:project.stage});
 if(project.stage===patch.toStage)return{result:{ok:true,kind:'saved',clientMutationId:patch.clientMutationId,stage:project.stage,noOp:true},eventIds:[]};
 const errors=validateStageExtras(patch.toStage,patch.extras);
 if(Object.keys(errors).length)return fail('validation','Заполните обязательные сведения',{errors});
 const extras=patch.extras??{};
 const changedAt=new Date();
 try{await applyProposalStageGateInTransaction(tx,{projectId:patch.projectId,fromStage:project.stage,toStage:patch.toStage,at:changedAt},actor,operationRootId)}
 catch(error){if(error instanceof ProposalLifecycleError)return fail('validation',error.message);throw error}
 const data:Prisma.ProjectUpdateManyMutationInput={stage:patch.toStage,stageChangedAt:changedAt,
  ...(patch.toStage==='REFUSED'?{refusalReason:extras.refusalReason!.trim(),refusalComment:extras.refusalComment?.trim()||null}:{}),
 };
 const updated=await tx.project.updateMany({where:{id:patch.projectId,stage:patch.expectedStage},data});
 if(updated.count!==1)throw new Error('Статус изменён другим пользователем');
 await tx.projectStageHistory.create({data:{projectId:patch.projectId,fromStage:project.stage,toStage:patch.toStage,changedById:actor.id,comment:patch.toStage==='REFUSED'?extras.refusalReason!.trim():undefined}});
 await writeChangeLogInTransaction(tx, {id:receiptId,actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'project',entityId:patch.projectId,action:'stage',operationRootId,field:'stage',oldValue:project.stage,newValue:{fingerprint,stage:patch.toStage}},
  {...projectJournalContext(project),...journalHints,before:{stage:project.stage,...(patch.toStage==='REFUSED'?{refusalReason:project.refusalReason,refusalComment:project.refusalComment}:{})},
   after:{stage:patch.toStage,...(patch.toStage==='REFUSED'?{refusalReason:data.refusalReason,refusalComment:data.refusalComment}:{})}});
 const promoted=patch.toStage==='CONTRACT'?await promoteProjectDrafts(tx,actor,patch.projectId,changedAt,operationRootId):{eventIds:[],productIds:[]};
 const event=await tx.domainEvent.create({data:{type:'project.stageChanged',actor:actor.id,payload:{projectId:patch.projectId,number:project.number,from:project.stage,to:patch.toStage}}});
 return{result:{ok:true,kind:'saved',clientMutationId:patch.clientMutationId,stage:patch.toStage},eventIds:[event.id,...promoted.eventIds],project,fromStage:project.stage,productIds:promoted.productIds};
}
