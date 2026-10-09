// Один offline control: настоящий Prisma DMMF и синтетический raw SQL spy.
// БД/HTTP/S3, PrismaClient, часы токенов и lifecycle здесь не запускаются.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {newFixturePlan,canonical} from './file-fixture113-protocol.mjs';
import {workData,createTaskWork,restoreTaskWork} from './task-work115-core.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
test('Work prerequisite rejects schema drift and unowned links; raw Task restores exactly without foreign or money writes',async()=>{
 const models=Prisma.dmmf.datamodel.models,workModel=models.find(model=>model.name==='Work'),taskModel=models.find(model=>model.name==='Task');assert.ok(workModel&&taskModel);
 const scalarFields=new Map(workModel.fields.filter(field=>field.kind!=='object').map(field=>[field.name,field]));
 function schemaData(data){
  for(const key of Object.keys(data))assert.ok(scalarFields.has(key),'UNKNOWN_WORK_FIELD_'+key);
  for(const field of scalarFields.values())if(field.isRequired&&!field.hasDefaultValue)assert.ok(Object.hasOwn(data,field.name),'MISSING_WORK_FIELD_'+field.name);
  assert.equal(data.paymentKind,'LEGACY');assert.equal(data.priceItemId,null);assert.equal(data.quantity,'1');assert.equal(data.priceSnapshot,'0');assert.equal(data.total,'0');
 }
 assert.ok(scalarFields.has('paymentKind'));assert.ok(!scalarFields.has('kind'));assert.equal(taskModel.fields.find(field=>field.name==='updatedAt').isUpdatedAt,true);assert.equal(taskModel.fields.find(field=>field.name==='workId').isRequired,false);assert.equal(taskModel.fields.find(field=>field.name==='work').relationOnDelete,'SetNull');
 const inbound=models.flatMap(model=>model.fields.filter(field=>field.kind==='object'&&field.type==='Work'&&field.relationFromFields?.length).map(field=>({model:model.name,fields:field.relationFromFields,target:field.relationToFields}))).sort((a,b)=>a.model.localeCompare(b.model));
 assert.deepEqual(inbound,[{model:'ProductStageSettlementShare',fields:['workId'],target:['id']},{model:'Task',fields:['workId'],target:['id']},{model:'TaskAllocationGroup',fields:['workId'],target:['id']},{model:'WorkPaymentConversion',fields:['workId'],target:['id']}]);
 assert.ok(models.find(model=>model.name==='PayrollEntry').fields.some(field=>field.name==='workId'&&field.kind==='scalar'));
 const p=newFixturePlan(randomUUID(),'a'.repeat(40));p.taskTitle='QA113 files '+p.runId;const workId=randomUUID(),data=workData(p,workId);schemaData(data);assert.throws(()=>schemaData({...data,kind:'LEGACY'}),/UNKNOWN_WORK_FIELD_kind/);
 const beforeTask=Object.fromEntries(taskModel.fields.filter(field=>field.kind!=='object').map(field=>[field.name,null]));
 Object.assign(beforeTask,{id:p.ids.task,projectId:p.ids.project,productId:p.ids.product,title:p.taskTitle,description:'offline untouched sentinel',status:'NEW',assigneeId:p.actors.engineer.id,workId:null,dueAt:'2026-10-09T11:22:33.654321',requiresPhoto:true,estimateMinutes:60,executorShare:1,physicalOnlyShare:false,splitRevision:0,createdAt:'2026-10-09T11:22:33.111111',updatedAt:'2026-10-09T11:22:33.123456'});
 const original=clone(beforeTask),trace=[],writes=[];let task=clone(beforeTask),work=null,unknownReference=false,unknownCatalog=false;
 const query=async(sql,...args)=>{
  trace.push({sql,args:clone(args)});
  if(sql.startsWith('SELECT t.relname::text "tableName"')){
   assert.deepEqual(args,[]);assert.match(sql,/FROM pg_constraint c/);assert.match(sql,/w\.relname='Work'/);const catalog=inbound.map(row=>({tableName:row.model,columnName:row.fields[0],targetColumn:row.target[0],deleteAction:{SetNull:'n',Restrict:'r'}[models.find(model=>model.name===row.model).fields.find(field=>field.type==='Work'&&field.relationFromFields?.length).relationOnDelete],keyCount:row.fields.length}));return unknownCatalog?[...catalog,{tableName:'UnexpectedWorkLink',columnName:'workId',targetColumn:'id',deleteAction:'n',keyCount:1}]:catalog;
  }
  const selected=/^SELECT to_jsonb\(t\) row FROM "(Task|Work)" t WHERE t\.id=\$1(?: FOR UPDATE)?$/.exec(sql);
  if(selected){assert.deepEqual(args,[selected[1]==='Task'?p.ids.task:workId]);const row=selected[1]==='Task'?task:work;return row?[{row:clone(row)}]:[];}
  if(sql.startsWith("SELECT 'Task'::text model,count(*)::int count")){
   assert.deepEqual(args,[workId,p.ids.task]);assert.match(sql,/WHERE "workId"=\$1 AND id<>\$2 UNION ALL/);const tables=[...sql.matchAll(/FROM "([^"]+)"/g)].map(match=>match[1]);assert.deepEqual(tables,['Task','TaskAllocationGroup','PayrollEntry','WorkPaymentConversion','ProductStageSettlementShare']);return tables.map(model=>({model,count:unknownReference&&model==='ProductStageSettlementShare'?1:0}));
  }
  if(sql.startsWith('UPDATE "Task" t SET "workId"=$1,"updatedAt"=clock_timestamp()')){
   assert.equal(sql,'UPDATE "Task" t SET "workId"=$1,"updatedAt"=clock_timestamp() WHERE t.id=$2 AND to_jsonb(t)=$3::jsonb RETURNING to_jsonb(t) row');assert.deepEqual(args.slice(0,2),[workId,p.ids.task]);assert.equal(canonical(JSON.parse(args[2])),canonical(task));assert.ok(work);writes.push('Task.workId+updatedAt.create');task={...task,workId,updatedAt:'2026-10-09T11:22:34.987654'};return [{row:clone(task)}];
  }
  if(sql.startsWith('UPDATE "Task" t SET "workId"=$1,"updatedAt"=$2::timestamp')){
   assert.equal(sql,'UPDATE "Task" t SET "workId"=$1,"updatedAt"=$2::timestamp WHERE t.id=$3 AND to_jsonb(t)=$4::jsonb RETURNING to_jsonb(t) row');assert.deepEqual(args.slice(0,3),[null,original.updatedAt,p.ids.task]);assert.equal(typeof args[1],'string');assert.match(args[1],/\.\d{6}$/);assert.equal(canonical(JSON.parse(args[3])),canonical(task));writes.push('Task.workId+updatedAt.restore');task={...task,workId:args[0],updatedAt:args[1]};return [{row:clone(task)}];
  }
  if(sql.startsWith('DELETE FROM "Work" t WHERE')){
   assert.equal(sql,'DELETE FROM "Work" t WHERE t.id=$1 AND to_jsonb(t)=$2::jsonb RETURNING id::text id');assert.equal(args[0],workId);assert.equal(canonical(JSON.parse(args[1])),canonical(work));assert.equal(canonical(task),canonical(original));writes.push('Work.exact.delete');work=null;return [{id:workId}];
  }
  assert.fail('FORBIDDEN_SQL: '+sql);
 };
 const tx=new Proxy({$queryRawUnsafe:query,work:{create:async({data:actual})=>{
  schemaData(actual);assert.deepEqual(actual,data);assert.equal(work,null);writes.push('Work.fresh.create');work={...Object.fromEntries([...scalarFields.values()].map(field=>[field.name,null])),...clone(actual),quantity:1,priceSnapshot:0,total:0,createdAt:'2026-10-09T11:22:34.765432'};return clone(work);
 }}},{get(target,key){assert.ok(Object.hasOwn(target,key),'FORBIDDEN_DELEGATE_'+String(key));return target[key];}});
 unknownCatalog=true;await assert.rejects(()=>createTaskWork(tx,p,beforeTask,workId),/UNEXPECTED_WORK_FK_CATALOG_STOP/);assert.deepEqual(writes,[]);assert.deepEqual(task,original);assert.equal(work,null);unknownCatalog=false;
 await assert.rejects(()=>createTaskWork(tx,p,{...beforeTask,id:randomUUID()},workId),/EXACT_OWN_UNBOUND_TASK_REQUIRED/);assert.ok(trace.every(row=>row.sql.startsWith('SELECT t.relname::text "tableName"')));assert.deepEqual(writes,[]);
 const prepared=await createTaskWork(tx,p,beforeTask,workId);assert.deepEqual(beforeTask,original);assert.equal(prepared.work.paymentKind,'LEGACY');assert.equal(prepared.work.createdById,p.actors.manager.id);assert.deepEqual(prepared.task,{...original,workId,updatedAt:'2026-10-09T11:22:34.987654'});
 unknownReference=true;const writesBeforeStop=clone(writes);await assert.rejects(()=>restoreTaskWork(tx,beforeTask,prepared.task,prepared.work),/UNOWNED_CHILD_WORK_REFERENCE_STOP/);assert.deepEqual(writes,writesBeforeStop);assert.deepEqual(task,prepared.task);assert.deepEqual(work,prepared.work);
 unknownReference=false;const restored=await restoreTaskWork(tx,beforeTask,prepared.task,prepared.work);assert.deepEqual(restored,{task:original,workDeleted:true});assert.deepEqual(task,original);assert.equal(work,null);assert.deepEqual(writes,['Work.fresh.create','Task.workId+updatedAt.create','Task.workId+updatedAt.restore','Work.exact.delete']);assert.deepEqual(beforeTask,original);
 assert.equal(trace.filter(row=>/^UPDATE "Task"/.test(row.sql)).length,2);assert.equal(trace.filter(row=>/^DELETE FROM "Work"/.test(row.sql)).length,1);assert.ok(trace.every(row=>!/\b(?:INSERT|ALTER|TRUNCATE)\b/.test(row.sql)));
});