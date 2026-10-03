import {liveProjectWhere} from "@/server/access/live-entities";
import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {MANAGER_ROLES,hasAnyRole} from '@/lib/roles';
import type {DomainActor} from './core';
import {projectStagePatchSchema,validateStageExtras,type ProjectStageResult} from './stage-contract';

/** Одна транзакция для селекта, доски и бота; проценты изделий не начисляет. */
export async function patchProjectStageTransaction(actor:DomainActor,input:unknown,tx:Prisma.TransactionClient):Promise<{result:ProjectStageResult;eventIds:string[];project?:{number:string;title:string};fromStage?:string}>{
 const parsed=projectStagePatchSchema.safeParse(input);
 if(!parsed.success)return{result:{ok:false,kind:'validation',error:'Обновите форму: необходимы исходный статус и идентификатор операции'},eventIds:[]};
 const patch=parsed.data;
 const fail=(kind:ProjectStageResult['kind'],error:string,extra:Partial<ProjectStageResult>={})=>({result:{ok:false,kind,error,clientMutationId:patch.clientMutationId,...extra},eventIds:[]});
 if(!hasAnyRole(actor.roles,MANAGER_ROLES))return fail('forbidden','Недостаточно прав');
 await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${patch.projectId} FOR UPDATE`;
 const project=await tx.project.findUnique({where:{...liveProjectWhere,id:patch.projectId},select:{id:true,stage:true,number:true,title:true}});
 if(!project)return fail('not-found','Проект не найден');
 const receiptId=`project-stage:${patch.clientMutationId}`;
 const fingerprint=createHash('sha256').update(JSON.stringify(patch)).digest('hex');
 const receipt=await tx.changeLog.findUnique({where:{id:receiptId}});
 if(receipt){
  const saved=receipt.newValue;
  if(receipt.actorType!=='user'||receipt.actorId!==actor.id||receipt.field!=='stage'||receipt.entity!=='project'||receipt.entityId!==patch.projectId||receipt.action!=='stage'||!saved||typeof saved!=='object'||Array.isArray(saved)||saved.fingerprint!==fingerprint)return fail('validation','Идентификатор операции уже использован');
  return{result:{ok:true,kind:'saved',clientMutationId:patch.clientMutationId,stage:patch.toStage,replayed:true},eventIds:[]};
 }
 if(project.stage!==patch.expectedStage)return fail('conflict','Статус изменён другим пользователем. Обновите карточку',{stage:project.stage});
 if(project.stage===patch.toStage)return{result:{ok:true,kind:'saved',clientMutationId:patch.clientMutationId,stage:project.stage,noOp:true},eventIds:[]};
 const errors=validateStageExtras(patch.toStage,patch.extras);
 if(Object.keys(errors).length)return fail('validation','Заполните обязательные сведения',{errors});
 const extras=patch.extras??{};
 const data:Prisma.ProjectUpdateManyMutationInput={stage:patch.toStage,stageChangedAt:new Date(),
  ...(patch.toStage==='REFUSED'?{refusalReason:extras.refusalReason!.trim(),refusalComment:extras.refusalComment?.trim()||null}:{}),
  ...(patch.toStage==='RECLAMATION'?{reclamationReason:extras.reclamationReason!.trim(),reclamationDescription:extras.reclamationDescription!.trim(),reclamationFault:extras.reclamationFault!.trim()}:{}),
 };
 const updated=await tx.project.updateMany({where:{id:patch.projectId,stage:patch.expectedStage},data});
 if(updated.count!==1)throw new Error('Статус изменён другим пользователем');
 await tx.projectStageHistory.create({data:{projectId:patch.projectId,fromStage:project.stage,toStage:patch.toStage,changedById:actor.id,comment:patch.toStage==='REFUSED'?extras.refusalReason!.trim():patch.toStage==='RECLAMATION'?extras.reclamationReason!.trim():undefined}});
 await tx.changeLog.create({data:{id:receiptId,actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'project',entityId:patch.projectId,action:'stage',field:'stage',oldValue:project.stage,newValue:{fingerprint,stage:patch.toStage}}});
 const event=await tx.domainEvent.create({data:{type:'project.stageChanged',actor:actor.id,payload:{projectId:patch.projectId,number:project.number,from:project.stage,to:patch.toStage}}});
 return{result:{ok:true,kind:'saved',clientMutationId:patch.clientMutationId,stage:patch.toStage},eventIds:[event.id],project,fromStage:project.stage};
}
