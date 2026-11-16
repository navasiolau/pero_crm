import {Prisma} from '@prisma/client';
import type {JournalContext,JournalEntityReference,JournalPresentationHints,JournalValue} from '@/server/changelog/contract';
import {sanitizeJournalValue} from '@/server/changelog/presentation';

export type JournalOwnership={projectId?:string|null;productId?:string|null;taskId?:string|null;workId?:string|null;projectNumber?:string|null;productNumber?:string|null;
  project?:{id?:string;number?:string}|null;product?:{id?:string;number?:string}|null};
type Reader=Pick<Prisma.TransactionClient,'$queryRaw'>;

/** Контексты — затронутые ленты; родительская ссылка сама по себе не добавляет проектную ленту. */
export async function operationJournalContext(tx:Reader,entity:JournalEntityReference,owners:readonly JournalOwnership[],references:readonly JournalEntityReference[]=[]):Promise<JournalPresentationHints>{
  const contexts=new Map<string,JournalContext>(),links=new Map<string,JournalEntityReference>();
  for(const owner of owners){
    let productId=owner.productId??null,projectId=owner.projectId??owner.project?.id??null;
    let productNumber=owner.productNumber??(!owner.product?.id||owner.product.id===productId?owner.product?.number:undefined);
    let projectNumber=owner.projectNumber??(!owner.project?.id||owner.project.id===projectId?owner.project?.number:undefined);
    if(owner.workId){const rows=await tx.$queryRaw<{id:string;title:string}[]>`SELECT id,title FROM "Work" WHERE id=${owner.workId}`;const work=rows.find(row=>row.id===owner.workId);
      if(work)links.set(`work:${work.id}`,{type:'work',id:work.id,label:work.title});}
    if(owner.taskId){
      const rows=await tx.$queryRaw<{id:string;title:string;projectId:string;productId:string|null}[]>`SELECT id,title,"projectId","productId" FROM "Task" WHERE id=${owner.taskId}`;
      const task=rows.find(row=>row.id===owner.taskId);
      if(task){links.set(`task:${task.id}`,{type:'task',id:task.id,label:task.title});
        if(!productId&&(!projectId||projectId===task.projectId)){productId=task.productId;projectId=task.projectId;}}
    }
    if(productId){
      if(!productNumber){const rows=await tx.$queryRaw<{id:string;number:string}[]>`SELECT id,number FROM "Product" WHERE id=${productId}`;productNumber=rows.find(row=>row.id===productId)?.number;}
      const reference={id:productId,label:productNumber?`Изделие ${productNumber}`:'Изделие',href:`/products/${encodeURIComponent(productId)}`};
      contexts.set(`product:${productId}`,{kind:'product',...reference});links.set(`product:${productId}`,{type:'product',...reference});
    }
    if(projectId){
      if(!projectNumber){const rows=await tx.$queryRaw<{id:string;number:string}[]>`SELECT id,number FROM "Project" WHERE id=${projectId}`;projectNumber=rows.find(row=>row.id===projectId)?.number;}
      const reference={id:projectId,label:projectNumber?`Проект ${projectNumber}`:'Проект',href:`/projects/${encodeURIComponent(projectId)}`};
      if(!productId)contexts.set(`project:${projectId}`,{kind:'project',...reference});
      links.set(`project:${projectId}`,{type:'project',...reference});
    }
  }
  for(const reference of references)links.set(`${reference.type}:${reference.id}`,reference);
  return {entity,contexts:[...contexts.values()],links:[...links.values()]};
}

export async function journalUserReferences(tx:Reader,ids:readonly (string|null|undefined)[]):Promise<JournalEntityReference[]>{
  const keys=[...new Set(ids.filter((id):id is string=>!!id))];if(!keys.length)return[];
  const rows=await tx.$queryRaw<{id:string;name:string}[]>(Prisma.sql`SELECT id,name FROM "User" WHERE id IN (${Prisma.join(keys)})`);
  return keys.map(id=>({type:'user',id,label:rows.find(row=>row.id===id)?.name??'Имя пользователя не сохранено'}));
}

export async function journalTaskReferences(tx:Reader,ids:readonly string[]):Promise<JournalEntityReference[]>{
  const keys=[...new Set(ids)];if(!keys.length)return[];
  const rows=await tx.$queryRaw<{id:string;title:string}[]>(Prisma.sql`SELECT id,title FROM "Task" WHERE id IN (${Prisma.join(keys)})`);
  return keys.map(id=>({type:'task',id,label:rows.find(row=>row.id===id)?.title??'Название задачи не сохранено'}));
}

export function journalSnapshot(value:object,fields:readonly string[]):Record<string,JournalValue>{
  const row=value as Record<string,unknown>;
  return sanitizeJournalValue(Object.fromEntries(fields.filter(field=>row[field]!==undefined).map(field=>[field,row[field]]))) as Record<string,JournalValue>;
}
export function systemJournalActor(actor:{id:string;name?:string|null},reason:string):JournalPresentationHints{
  return{actor:{type:'system',id:'system',name:'Система'},initiator:{id:actor.id,name:actor.name??'Имя пользователя не сохранено'},reason};
}
export const TASK_JOURNAL_FIELDS=['title','type','projectId','productId','workId','assigneeId','quantity','status','dueAt','requiresPhoto','executorShare','allocationGroupId','shareUnits','shareAmount','doneAt','doneById'] as const;
export const WORK_JOURNAL_FIELDS=['title','projectId','productId','priceItemId','quantity','quantityPerUnit','unitSnapshot','priceSnapshot','total','paymentKind'] as const;
export const FILE_JOURNAL_FIELDS=['fileName','mimeType','size','section','projectId','productId','taskId','uploadedById'] as const;
export const PAYROLL_JOURNAL_FIELDS=['userId','taskId','workId','projectId','productId','amount','bynAmount','projectAmount','projectCurrency','currency','scheme','month','comment'] as const;
