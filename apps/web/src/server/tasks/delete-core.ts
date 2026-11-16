import type {Prisma} from '@prisma/client';
import type {DomainActor} from '@/server/actor';
import {MANAGER_ROLES,hasAnyRole} from '@/lib/roles';
import {liveChildWhere} from '@/server/access/live-entities';
import {taskVisibilityWhere} from '@/server/access/visibility';
import {writeChangeLogInTransaction} from '@/server/changelog/writer';
import {operationJournalContext,journalSnapshot,journalTaskReferences,journalUserReferences,systemJournalActor,TASK_JOURNAL_FIELDS,FILE_JOURNAL_FIELDS} from './journal';

/** Удаление, сохранение вложений и обязательный аудит завершаются вместе. */
export async function deleteTaskInTransaction(tx:Prisma.TransactionClient,actor:DomainActor,taskId:string){
  if(!hasAnyRole(actor.roles,MANAGER_ROLES))throw Error('Недостаточно прав');
  const task=await tx.task.findUnique({where:{...liveChildWhere,id:taskId,AND:[taskVisibilityWhere(actor)]},
    include:{project:{select:{id:true,number:true,currency:true}},product:{select:{id:true,number:true}},
      work:{select:{paymentKind:true}},dependencies:{select:{dependsOnId:true}},_count:{select:{payrollEntries:true,timeEntries:true}}}});
  if(!task)return{ok:false as const,error:'Задача не найдена'};
  if(task.work?.paymentKind==='ENGINEERING')return{ok:false as const,error:'Задача входит в распределение инженерного фонда — её долю можно передать или перераспределить'};
  if(task.allocationGroupId)return{ok:false as const,error:'Отдельную долю общей работы удалить нельзя — её объём и бюджет должны сохраниться'};
  if(task.status==='DONE'||task._count.payrollEntries>0)return{ok:false as const,error:'Выполненную задачу удалить нельзя — там начисления и история'};
  if(task._count.timeEntries>0)return{ok:false as const,error:'Задачу с историческими записями времени удалить нельзя'};
  const files=await tx.file.findMany({where:{taskId}});
  const fileJournals=await Promise.all(files.map(file=>operationJournalContext(tx,{type:'file',id:file.id,label:file.fileName},
    [{...file,productId:file.productId??task.productId,product:task.product,project:task.project},{...file,taskId:null,project:task.project}])));
  const journal=await operationJournalContext(tx,{type:'task',id:task.id,label:task.title},[task],
    [...await journalTaskReferences(tx,(task.dependencies??[]).map(edge=>edge.dependsOnId)),...await journalUserReferences(tx,[task.assigneeId])]);
  const dependents=await tx.$queryRaw<{id:string;title:string;projectId:string;productId:string|null;dependencyIds:string[]}[]>`
    SELECT t.id,t.title,t."projectId",t."productId",ARRAY(SELECT d."dependsOnId" FROM "TaskDependency" d WHERE d."taskId"=t.id ORDER BY d."dependsOnId") AS "dependencyIds"
    FROM "Task" t JOIN "TaskDependency" edge ON edge."taskId"=t.id WHERE edge."dependsOnId"=${taskId}`;
  const dependencyJournals=await Promise.all(dependents.map(async row=>operationJournalContext(tx,{type:'task',id:row.id,label:row.title},[row],
    await journalTaskReferences(tx,row.dependencyIds))));
  await tx.taskDependency.deleteMany({where:{OR:[{taskId},{dependsOnId:taskId}]}});
  await tx.file.updateMany({where:{taskId},data:{taskId:null}});
  await tx.task.delete({where:{id:taskId}});
  for(const [index,file] of files.entries())await writeChangeLogInTransaction(tx,
    {actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'file',entityId:file.id,action:'update',field:'taskId',oldValue:{taskId},newValue:{taskId:null}},
    {...fileJournals[index],...systemJournalActor(actor,'Удаление связанной задачи'),
      before:journalSnapshot(file,FILE_JOURNAL_FIELDS),after:journalSnapshot({...file,taskId:null},FILE_JOURNAL_FIELDS)});
  for(const [index,dependent] of dependents.entries())await writeChangeLogInTransaction(tx,
    {actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'task',entityId:dependent.id,action:'update',field:'dependencyIds',
      oldValue:{dependencyIds:dependent.dependencyIds},newValue:{dependencyIds:dependent.dependencyIds.filter(id=>id!==taskId)}},
    {...dependencyJournals[index],links:[...(dependencyJournals[index].links??[]),{type:'task',id:task.id,label:task.title}],
      ...systemJournalActor(actor,'Удаление предшествующей задачи')});
  await writeChangeLogInTransaction(tx,{actorType:'user',actorId:actor.id,actorName:actor.name,entity:'task',entityId:taskId,action:'delete',
    oldValue:{title:task.title,project:task.project.number}},
    {...journal,before:{...journalSnapshot(task,TASK_JOURNAL_FIELDS),dependencyIds:(task.dependencies??[]).map(edge=>edge.dependsOnId)},after:null});
  return{ok:true as const,task};
}
