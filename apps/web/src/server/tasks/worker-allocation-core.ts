import {createHash,randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {hasAnyRole,FIELD_ROLES} from '@/lib/roles';
import {fieldProductStatuses} from '@/lib/field-product-visibility';
import {productVisibilityWhere,resolveVisibilityActor} from '@/server/access/visibility';
import {assertProjectMoneyCurrency} from '@/lib/internal-currency';
import {allocatedWorkQuantity,quantityAtoms,quantityFromAtoms} from '@/lib/work-shares';
import {liveProductWhere,liveProjectWhere,liveChildWhere} from '@/server/access/live-entities';
import type {DomainActor} from '@/server/projects/core';
import {withTaskTransaction,type TaskTransaction} from './transaction';

const id=z.string().min(1).max(128);
export const workerTaskAllocationSchema=z.object({projectId:id,productId:id,workId:id,assigneeId:id,title:z.string().trim().min(1).max(200),type:z.string().trim().min(1).max(80),quantity:z.string().trim().min(1).max(32),dueAt:z.string().min(1).max(64),estimateMinutes:z.number().int().min(1).max(525600).optional(),requiresPhoto:z.boolean().default(false),dependencyIds:z.array(id).max(100).default([]),clientMutationId:z.uuid()}).strict();
export type WorkerTaskInput=z.input<typeof workerTaskAllocationSchema>;
export const ownWorkTaskSchema=workerTaskAllocationSchema.omit({assigneeId:true});
export type OwnWorkTaskInput=z.input<typeof ownWorkTaskSchema>;
export type WorkerTaskResult={ok:true;id:string;quantity:string;assigneeId:string;clientMutationId:string;repeated?:boolean;eventId?:string}|{ok:false;kind:'validation'|'forbidden'|'conflict'|'failure';error:string};
class AllocationRule extends Error{constructor(message:string,readonly kind:Extract<WorkerTaskResult,{ok:false}>['kind']='validation'){super(message);}}
function deny(message:string,kind:Extract<WorkerTaskResult,{ok:false}>['kind']='validation'):never{throw new AllocationRule(message,kind);}
function record(value:unknown):Record<string,unknown>|null{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}

export async function createWorkerTaskAllocationCore(actor:DomainActor,input:unknown,transaction:TaskTransaction=withTaskTransaction):Promise<WorkerTaskResult>{
 const parsed=workerTaskAllocationSchema.safeParse(input);if(!parsed.success)return{ok:false,kind:'validation',error:parsed.error.issues[0]?.message??'Проверьте данные задачи'};
 const data=parsed.data;
 let amount:bigint;try{amount=quantityAtoms(data.quantity);}catch{return{ok:false,kind:'validation',error:'Количество должно содержать не больше двух знаков после точки'};}
 if(amount<=BigInt(0))return{ok:false,kind:'validation',error:'Количество должно быть больше нуля'};
 const dueAt=new Date(data.dueAt);if(!Number.isFinite(dueAt.getTime()))return{ok:false,kind:'validation',error:'Укажите корректный срок'};
 const quantity=quantityFromAtoms(amount),dependencyIds=[...new Set(data.dependencyIds)].sort();
 const fingerprint=createHash('sha256').update(JSON.stringify({...data,quantity,dueAt:dueAt.toISOString(),dependencyIds})).digest('hex');
 try{return await transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR UPDATE`;
  const current=await tx.user.findUnique({where:{id:actor.id},select:{id:true,name:true,active:true,roles:true}});
   if(!current?.active||!hasAnyRole(current.roles,FIELD_ROLES))deny('Недостаточно прав','forbidden');
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${data.productId} FOR UPDATE`;
  const visibility=await resolveVisibilityActor(tx,current);
  const product=await tx.product.findFirst({where:{...liveProductWhere,id:data.productId,projectId:data.projectId,AND:[productVisibilityWhere(visibility)]},select:{id:true,projectId:true,status:true}});
  if(!product||product.projectId!==data.projectId||!fieldProductStatuses(current.roles).includes(product.status))deny('Выберите доступное изделие для своей производственной роли','forbidden');
  const project=await tx.project.findUnique({where:{...liveProjectWhere,id:data.projectId},select:{id:true,currency:true}});
  if(!project)deny('Проект недоступен','forbidden');
  try{assertProjectMoneyCurrency(project.currency);}catch{deny('Цены проекта должны быть подготовлены в BYN');}
  await tx.$queryRaw`SELECT id FROM "Work" WHERE id=${data.workId} FOR UPDATE`;
  const work=await tx.work.findUnique({where:{...liveChildWhere,id:data.workId},include:{tasks:{select:{id:true,quantity:true,allocationGroupId:true}},_count:{select:{paymentConversions:true,settlementShares:true}}}});
  if(!work||work.projectId!==data.projectId||work.productId!==data.productId||work.paymentKind!=='LEGACY'||work.stagePayPoolId!==null||work.poolWeightUnits!=null||work._count?.paymentConversions||work._count?.settlementShares||work.priceSnapshot===null)deny('Выберите обычную работу этого изделия со снимком цены');
  const previous=await tx.changeLog.findUnique({where:{id:`worker-task:${data.clientMutationId}`}});
  if(previous){
   const saved=record(previous.newValue),result=record(saved?.result);
   if(previous.actorId!==current.id||previous.entity!=='task'||saved?.fingerprint!==fingerprint||result?.ok!==true||typeof result.id!=='string'||typeof result.quantity!=='string'||typeof result.assigneeId!=='string')deny('Идентификатор операции уже использован');
   const task=await tx.task.findUnique({where:{id:result.id},select:{id:true,projectId:true,productId:true,workId:true,quantity:true,assigneeId:true,createdById:true}});
   if(!task||task.projectId!==data.projectId||task.productId!==data.productId||task.workId!==data.workId||task.createdById!==current.id||task.assigneeId!==result.assigneeId||quantityFromAtoms(quantityAtoms(task.quantity??0))!==result.quantity)deny('Назначение уже изменено; обновите карточку','conflict');
   return{ok:true as const,id:task.id,quantity:result.quantity,assigneeId:result.assigneeId,clientMutationId:data.clientMutationId,repeated:true};
  }
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${data.assigneeId} FOR UPDATE`;
  const recipient=await tx.user.findUnique({where:{id:data.assigneeId},select:{id:true,active:true,roles:true}});
   if(!recipient?.active||!hasAnyRole(recipient.roles,FIELD_ROLES)||!fieldProductStatuses(recipient.roles).includes(product.status))deny('Выберите активного исполнителя с доступом к статусу этого изделия');
  if(work.tasks.some(task=>task.quantity===null))deny('В старой задаче не определён объём; распределение недоступно');
  let remaining:bigint;try{remaining=quantityAtoms(work.quantity)-quantityAtoms(allocatedWorkQuantity(work.tasks));}catch{deny('Объём ранее распределённой работы не согласован');}
  if(amount>remaining)deny(`В работе осталось ${quantityFromAtoms(remaining>BigInt(0)?remaining:BigInt(0))}; больше распределить нельзя`,'conflict');
  let estimate=data.estimateMinutes;
  if(estimate===undefined){const rows=await tx.$queryRaw<{avg:number|null}[]>`SELECT AVG(s.m)::float AS avg FROM (SELECT SUM(te."minutes") AS m FROM "TimeEntry" te JOIN "Task" t ON t.id=te."taskId" WHERE t.type=${data.type} AND t.status='DONE' AND te."stoppedAt" IS NOT NULL GROUP BY t.id) s`;if(rows[0]?.avg&&rows[0].avg>0)estimate=Math.round(rows[0].avg);}
  if(!estimate)deny('Укажите оценку времени (мин) — истории по таким задачам нет');
  let dependencies:string[]=[];
  if(dependencyIds.length){
   const selected=await tx.task.findMany({where:{id:{in:dependencyIds},projectId:data.projectId,productId:data.productId},select:{id:true,projectId:true,productId:true,allocationGroupId:true}});
   if(selected.length!==dependencyIds.length)deny('Одна из зависимостей недоступна');
   const groups=[...new Set(selected.flatMap(task=>task.allocationGroupId?[task.allocationGroupId]:[]))];
   const parts=groups.length?await tx.task.findMany({where:{allocationGroupId:{in:groups}},select:{id:true,projectId:true,productId:true}}):[];
   if([...selected,...parts].some(task=>task.projectId!==data.projectId||task.productId!==data.productId))deny('Зависимость принадлежит другому изделию');
   dependencies=[...new Set([...selected,...parts].map(task=>task.id))];
  }
  const task=await tx.task.create({data:{id:randomUUID(),projectId:data.projectId,productId:data.productId,workId:work.id,title:data.title,type:data.type,quantity,status:'NEW',assigneeId:recipient.id,createdById:current.id,dueAt,estimateMinutes:estimate,requiresPhoto:data.requiresPhoto||data.type==='Замер',dependencies:{create:dependencies.map(dependsOnId=>({dependsOnId}))}}});
  await tx.changeLog.create({data:{actorType:'user',actorId:current.id,actorName:current.name,source:actor.source,entity:'task',entityId:task.id,action:'create',newValue:{title:task.title,workId:work.id,productId:data.productId,quantity,assigneeId:recipient.id}}});
  const event=await tx.domainEvent.create({data:{type:'task.assigned',actor:current.id,payload:{taskId:task.id,projectId:data.projectId,productId:data.productId,assigneeId:recipient.id}}});
  const result={ok:true as const,id:task.id,quantity,assigneeId:recipient.id,clientMutationId:data.clientMutationId,eventId:event.id};
  await tx.changeLog.create({data:{id:`worker-task:${data.clientMutationId}`,actorType:'user',actorId:current.id,actorName:current.name,source:actor.source,entity:'task',entityId:task.id,action:'worker-allocation.receipt',newValue:JSON.parse(JSON.stringify({fingerprint,result})) as Prisma.InputJsonValue}});
  return result;
 });}catch(error){return error instanceof AllocationRule?{ok:false,kind:error.kind,error:error.message}:{ok:false,kind:'failure',error:'Не удалось подтвердить назначение. Повторите прежний запрос.'};}
}

export async function createOwnWorkTaskCore(actor:DomainActor,input:unknown,transaction:TaskTransaction=withTaskTransaction):Promise<WorkerTaskResult>{
 const parsed=ownWorkTaskSchema.safeParse(input);if(!parsed.success)return{ok:false,kind:'validation',error:parsed.error.issues[0]?.message??'Проверьте данные задачи'};
 return createWorkerTaskAllocationCore(actor,{...parsed.data,assigneeId:actor.id},transaction);
}
