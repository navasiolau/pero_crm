import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {createProjectInTransaction} from '../../src/server/projects/core';
import {createProductInTransaction} from '../../src/server/products/core';
import {addWorkCore} from '../../src/server/works/core';
import {updateWorkCore} from '../../src/server/works/update-core';
import {workPlanRevision} from '../../src/server/works/plan';
import {createWorkerTaskAllocationCore} from '../../src/server/tasks/worker-allocation-core';
import {changeTaskStatusCore} from '../../src/server/tasks/completion-core';
import {deleteTaskInTransaction} from '../../src/server/tasks/delete-core';
import {transferPieceworkShareCore} from '../../src/server/tasks/piecework-core';
import {persistOrdinaryUpload} from '../../src/server/files/upload-core';
import {deleteOrdinaryFileCore} from '../../src/server/files/delete-core';
import {parseJournalPresentation} from '../../src/server/changelog/presentation';

/** Никакого подключения/COMMIT/I/O: root передаёт свою проверенную rollback-only транзакцию. */
export async function runJournal226NativeCases(tx:Prisma.TransactionClient,options:{runId:string;rollbackOnly:true;expectedDatabase:string}){
  if(options.rollbackOnly!==true||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.runId)||!options.expectedDatabase)
    throw Error('JOURNAL226_ROLLBACK_DECLARATION_REQUIRED');
  if(typeof (tx as unknown as {$transaction?:unknown}).$transaction==='function')throw Error('JOURNAL226_TRANSACTION_CLIENT_REQUIRED');
  const [identity]=await tx.$queryRaw<{database:string}[]>`SELECT current_database() AS database`;
  if(identity?.database!==options.expectedDatabase)throw Error('JOURNAL226_DATABASE_GUARD_MISMATCH');
  const prefix=`journal226_${options.runId.replaceAll('-','')}`;
  const manager={id:`${prefix}_manager`,name:`QA ${prefix}`,roles:['MANAGER' as const],source:'web' as const};
  const worker={id:`${prefix}_worker`,name:'QA исполнитель',roles:['WORKER' as const],source:'web' as const};
  const recipient={id:`${prefix}_recipient`,name:'QA второй исполнитель',roles:['WORKER' as const],source:'web' as const};
  for(const actor of [manager,worker,recipient])await tx.user.create({data:{id:actor.id,email:`${actor.id}@example.invalid`,name:actor.name,roles:actor.roles,payScheme:actor.id===manager.id?'NONE':'PIECE',passwordHash:'disabled-journal-native-password'}});
  const client=await tx.client.create({data:{id:`${prefix}_client`,name:prefix,phone:'QA'}});
  const {project}=await createProjectInTransaction(tx,manager,{title:prefix,clientId:client.id});
  await tx.project.update({where:{id:project.id},data:{stage:'IN_WORK'}});
  const madeProduct=await createProductInTransaction(tx,manager,{projectId:project.id,title:'QA изделие',quantity:1});
  assert.equal(madeProduct.ok,true);if(!madeProduct.ok)throw Error('JOURNAL226_PRODUCT_FIXTURE');
  const product=await tx.product.update({where:{id:madeProduct.product.id},data:{status:'PRODUCTION'}});
  const price=await tx.priceItem.create({data:{id:`${prefix}_price`,name:'QA работа',unit:'шт',price:'100'}});
  const transaction:Parameters<typeof addWorkCore>[2]=async run=>run(tx);
  const workRequest={projectId:project.id,productId:product.id,priceItemId:price.id,quantityPerUnit:2,clientMutationId:randomUUID()};
  const workResult=await addWorkCore(manager,workRequest,transaction);if(!workResult.ok)throw Error(workResult.error);
  const work=await tx.work.findUniqueOrThrow({where:{id:workResult.workId},include:{tasks:true}});
  const changed=await updateWorkCore(manager,{projectId:project.id,productId:product.id,workId:work.id,quantityPerUnit:3,
    expectedRevision:workPlanRevision(work),clientMutationId:randomUUID()},transaction);assert.equal(changed.ok,true);
  const workLog=await tx.changeLog.findFirstOrThrow({where:{entity:'work',entityId:work.id,action:'update'}});
  assert.ok(JSON.stringify(parseJournalPresentation(workLog.presentation)?.changes).includes('300'),'JOURNAL226_WORK_FULL_TOTAL');
  assert.deepEqual(parseJournalPresentation(workLog.presentation)?.contexts.map(({kind,id})=>({kind,id})),[{kind:'product',id:product.id}]);

  const taskRequest={projectId:project.id,productId:product.id,workId:work.id,assigneeId:worker.id,title:'QA выполнение',type:'Производство',quantity:'1',dueAt:'2030-01-01T00:00:00Z',clientMutationId:randomUUID()};
  const assignment=await createWorkerTaskAllocationCore(worker,taskRequest,transaction);if(!assignment.ok)throw Error(assignment.error);
  const statusRequest={clientMutationId:randomUUID(),expectedActorId:worker.id};
  const completed=await changeTaskStatusCore(worker,assignment.id,'DONE',undefined,transaction,statusRequest);assert.equal(completed.ok,true);
  const entry=await tx.payrollEntry.findFirstOrThrow({where:{taskId:assignment.id}});assert.equal(entry.amount.toFixed(2),'100.00');
  const payrollLog=await tx.changeLog.findFirstOrThrow({where:{entity:'payrollEntry',entityId:entry.id,action:'accrue'}});
  const payrollView=parseJournalPresentation(payrollLog.presentation);assert.equal(payrollView?.actor.type,'system');assert.equal(payrollView?.initiator?.id,worker.id);
  assert.deepEqual(payrollView?.contexts.map(({kind,id})=>({kind,id})),[{kind:'product',id:product.id}]);
  const count=await tx.changeLog.count({where:{actorId:worker.id}});
  await changeTaskStatusCore(worker,assignment.id,'DONE',undefined,transaction,statusRequest);
  assert.equal(await tx.changeLog.count({where:{actorId:worker.id}}),count);assert.equal(await tx.payrollEntry.count({where:{taskId:assignment.id}}),1);

  const pending=await createWorkerTaskAllocationCore(worker,{...taskRequest,title:'QA удаление',clientMutationId:randomUUID()},transaction);
  if(!pending.ok)throw Error(pending.error);
  const dependent=await tx.task.create({data:{id:`${prefix}_dependent`,projectId:project.id,title:'QA общепроектная зависимость',type:'Производство',createdById:manager.id,
    dependencies:{create:{dependsOnId:pending.id}}}});
  const upload={clientMutationId:randomUUID(),fingerprint:`${prefix}_upload`,projectNumber:project.number,data:{projectId:project.id,productId:product.id,taskId:pending.id,
    fileName:'Полное имя QA модели.b3d',storedName:`${prefix}.b3d`,mimeType:'application/octet-stream',size:12500,section:'PRODUCTION' as const,hasThumb:false,uploadedById:manager.id}};
  const file=await persistOrdinaryUpload(tx,manager,upload);
  const fileLog=await tx.changeLog.findUniqueOrThrow({where:{id:`file-upload:${upload.clientMutationId}`}});
  assert.ok(JSON.stringify(parseJournalPresentation(fileLog.presentation)?.changes).includes('12500'),'JOURNAL226_UPLOAD_FULL_SIZE');
  const deleted=await deleteTaskInTransaction(tx,manager,pending.id);assert.equal(deleted.ok,true);
  const deletedTaskLog=await tx.changeLog.findFirstOrThrow({where:{entity:'task',entityId:pending.id,action:'delete'}});
  assert.equal(parseJournalPresentation(deletedTaskLog.presentation)?.changes.find(change=>change.path==='assigneeId')?.before,worker.name,'JOURNAL226_DELETED_TASK_ASSIGNEE_NAME');
  assert.equal((await tx.file.findUniqueOrThrow({where:{id:file.id}})).taskId,null);
  const detach=await tx.changeLog.findFirstOrThrow({where:{entity:'file',entityId:file.id,action:'update',field:'taskId'}});
  assert.equal(parseJournalPresentation(detach.presentation)?.actor.type,'system');
  assert.equal(await tx.taskDependency.count({where:{taskId:dependent.id,dependsOnId:pending.id}}),0);
  const dependencyLog=await tx.changeLog.findFirstOrThrow({where:{entity:'task',entityId:dependent.id,field:'dependencyIds'}});
  assert.equal(parseJournalPresentation(dependencyLog.presentation)?.actor.type,'system');
  assert.deepEqual(parseJournalPresentation(dependencyLog.presentation)?.contexts.map(({kind,id})=>({kind,id})),[{kind:'project',id:project.id}]);
  const deletionRequest={fileId:file.id,clientMutationId:randomUUID()},storage={mode:'s3' as const,endpoint:'https://journal-native.invalid',bucket:'journal-native'};
  const removed=await deleteOrdinaryFileCore(tx,manager,deletionRequest,storage);assert.equal(removed.ok,true);
  const removal=await tx.changeLog.findUniqueOrThrow({where:{id:`file-delete:${deletionRequest.clientMutationId}`}});
  assert.ok(JSON.stringify(parseJournalPresentation(removal.presentation)?.changes).includes(upload.data.fileName),'JOURNAL226_DELETE_FULL_FILENAME');
  const beforeReplay=removal.newValue;assert.equal((await deleteOrdinaryFileCore(tx,manager,deletionRequest,storage)).ok,true);
  assert.deepEqual((await tx.changeLog.findUniqueOrThrow({where:{id:removal.id}})).newValue,beforeReplay);

  const another=await createProductInTransaction(tx,manager,{projectId:project.id,title:'QA другое изделие',quantity:1});
  if(!another.ok)throw Error('JOURNAL226_SECOND_PRODUCT_FIXTURE');
  const splitSource=await createWorkerTaskAllocationCore(worker,{...taskRequest,title:'QA деление',clientMutationId:randomUUID()},transaction);
  if(!splitSource.ok)throw Error(splitSource.error);
  const splitDependents=await Promise.all([null,another.product.id].map((productId,index)=>tx.task.create({data:{id:`${prefix}_split_dep_${index}`,
    projectId:project.id,productId,title:`QA зависимая ${index}`,type:'Производство',createdById:manager.id,dependencies:{create:{dependsOnId:splitSource.id}}}})));
  const splitRequest={taskId:splitSource.id,recipientId:recipient.id,percent:'25',expectedRevision:0,clientMutationId:randomUUID()};
  const split=await transferPieceworkShareCore(worker,splitRequest,transaction);if(!split.ok)throw Error(split.error);
  const childId=split.taskIds[1];
  for(const task of splitDependents){
    const log=await tx.changeLog.findFirstOrThrow({where:{entity:'task',entityId:task.id,field:'dependencyIds'}});
    assert.deepEqual(log.oldValue,{dependencyIds:[splitSource.id]});assert.deepEqual(log.newValue,{dependencyIds:[splitSource.id,childId].sort()});
    const view=parseJournalPresentation(log.presentation);assert.equal(view?.actor.type,'system');assert.equal(view?.initiator?.id,worker.id);
    assert.deepEqual(view?.contexts.map(({kind,id})=>({kind,id})),[{kind:task.productId?'product':'project',id:task.productId??project.id}]);
  }
  const splitReceipt=await tx.changeLog.findUniqueOrThrow({where:{id:`piecework-v1:${splitRequest.clientMutationId}`}});
  const beforeSplitReplay=await tx.changeLog.count({where:{actorId:worker.id}});
  const repeatedSplit=await transferPieceworkShareCore(worker,splitRequest,transaction);assert.equal(repeatedSplit.ok,true);
  assert.equal(await tx.changeLog.count({where:{actorId:worker.id}}),beforeSplitReplay);
  assert.deepEqual((await tx.changeLog.findUniqueOrThrow({where:{id:splitReceipt.id}})).newValue,splitReceipt.newValue);
  assert.equal((await tx.task.findUniqueOrThrow({where:{id:splitSource.id}})).shareAmount?.toFixed(2),'75.00');
  assert.equal((await tx.task.findUniqueOrThrow({where:{id:childId}})).shareAmount?.toFixed(2),'25.00');

  const faultTask=await createWorkerTaskAllocationCore(worker,{...taskRequest,title:'QA отказ аудита',clientMutationId:randomUUID()},transaction);
  if(!faultTask.ok)throw Error(faultTask.error);
  await tx.$executeRawUnsafe('SAVEPOINT journal226_audit_fault');
  const failing=new Proxy(tx,{get(target,key){if(key==='changeLog')return new Proxy(target.changeLog,{get(delegate,method){
    if(method==='create')return async()=>{throw Error('JOURNAL226_AUDIT_FAULT');};return Reflect.get(delegate,method);}});
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  await assert.rejects(()=>deleteTaskInTransaction(failing,manager,faultTask.id),/JOURNAL226_AUDIT_FAULT/);
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT journal226_audit_fault');await tx.$executeRawUnsafe('RELEASE SAVEPOINT journal226_audit_fault');
  assert.ok(await tx.task.findUnique({where:{id:faultTask.id}}),'JOURNAL226_DELETE_ROLLBACK_RESTORED_TASK');
  return{ok:true,scenario:'journal-226',checks:['work-full-diff','task-create','system-payroll','payroll-replay','file-metadata','file-detach','dependent-task-audit','file-delete-replay','deleted-assignee-label','split-cross-owner-dependencies','split-replay-money','delete-audit-rollback'],projectId:project.id,productId:product.id};
}
