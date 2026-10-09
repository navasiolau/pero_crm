// Только новый Work/собственная Task: без файлов, денег, таймеров и исходных строк.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при CAS/ownership mismatch.
import {need,canonical,validatePlan} from './file-fixture113-protocol.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const equal=(a,b,code)=>need(canonical(a)===canonical(b),code);
export function workData(plan,workId){
 validatePlan(plan);need(UUID.test(workId??'')&&!Object.values(plan.ids).includes(workId)&&!Object.values(plan.actors).some(row=>row.id===workId),'FRESH_CHILD_WORK_UUID_REQUIRED');
 return {id:workId,projectId:plan.ids.project,productId:plan.ids.product,priceItemId:null,title:'QA115 task files '+plan.runId,quantity:'1',quantityPerUnit:null,unitSnapshot:null,priceSnapshot:'0',total:'0',paymentKind:'LEGACY',stagePayPoolId:null,poolWeightUnits:null,createdById:plan.actors.manager.id,legacyId:null,legacyTable:null};
}
export function validateOwnTask(plan,task){
 need(task?.id===plan.ids.task&&task.projectId===plan.ids.project&&task.productId===plan.ids.product&&task.assigneeId===plan.actors.engineer.id&&task.workId===null&&typeof task.updatedAt==='string','EXACT_OWN_UNBOUND_TASK_REQUIRED');return task;
}
export function validatePreparedTask(before,after,workId){
 need(after?.workId===workId&&typeof after.updatedAt==='string','OWN_TASK_WORK_CAS_RESULT_REQUIRED');
 equal({...after,workId:before.workId,updatedAt:before.updatedAt},before,'UNEXPECTED_OWN_TASK_CHANGE');return after;
}
export function validateOwnWork(plan,row,workId){
 const data=workData(plan,workId);need(row&&row.id===workId&&typeof row.createdAt==='string','EXACT_OWN_CHILD_WORK_REQUIRED');
 for(const[key,value]of Object.entries(data))if(['quantity','priceSnapshot','total'].includes(key))need(row[key]!==null&&row[key]!==undefined&&Number(row[key])===Number(value),'CHILD_WORK_PRICE_OR_QUANTITY_CHANGED');else equal(row[key],value,'CHILD_WORK_FIELD_CHANGED_'+key.toUpperCase());return row;
}
async function raw(tx,table,id,lock=false){
 need(['Task','Work'].includes(table),'EXACT_CHILD_TABLE_REQUIRED');return tx.$queryRawUnsafe('SELECT to_jsonb(t) row FROM "'+table+'" t WHERE t.id=$1'+(lock?' FOR UPDATE':''),id);
}
export async function workForeignKeyGuard(tx){
 const rows=await tx.$queryRawUnsafe('SELECT t.relname::text "tableName",a.attname::text "columnName",ta.attname::text "targetColumn",c.confdeltype::text "deleteAction",array_length(c.conkey,1)::int "keyCount" FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class w ON w.oid=c.confrelid JOIN pg_namespace wn ON wn.oid=w.relnamespace JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1] JOIN pg_attribute ta ON ta.attrelid=c.confrelid AND ta.attnum=c.confkey[1] WHERE c.contype=\'f\' AND n.nspname=\'public\' AND wn.nspname=\'public\' AND w.relname=\'Work\' ORDER BY t.relname,a.attname');
 const expected={Task:'n',TaskAllocationGroup:'n',WorkPaymentConversion:'r',ProductStageSettlementShare:'r'};
 need(rows.length===4&&new Set(rows.map(row=>row.tableName)).size===4&&rows.every(row=>Object.hasOwn(expected,row.tableName)&&row.columnName==='workId'&&row.targetColumn==='id'&&row.keyCount===1&&row.deleteAction===expected[row.tableName]),'UNEXPECTED_WORK_FK_CATALOG_STOP');return true;
}
export async function createTaskWork(tx,plan,beforeTask,workId){
 await workForeignKeyGuard(tx);
 validateOwnTask(plan,beforeTask);const data=workData(plan,workId),current=await raw(tx,'Task',beforeTask.id,true);need(current.length===1,'OWN_TASK_MISSING');equal(current[0].row,beforeTask,'RAW_TASK_BEFORE_CAS_CHANGED');need((await raw(tx,'Work',workId,true)).length===0,'WORK_UUID_NOT_FRESH');
 await tx.work.create({data});const workRows=await raw(tx,'Work',workId);need(workRows.length===1,'OWN_WORK_CREATE_UNCONFIRMED');const work=validateOwnWork(plan,workRows[0].row,workId);
 const updated=await tx.$queryRawUnsafe('UPDATE "Task" t SET "workId"=$1,"updatedAt"=clock_timestamp() WHERE t.id=$2 AND to_jsonb(t)=$3::jsonb RETURNING to_jsonb(t) row',workId,beforeTask.id,JSON.stringify(beforeTask));need(updated.length===1,'FULL_RAW_TASK_CREATE_CAS_REQUIRED');
 return {work,task:validatePreparedTask(beforeTask,updated[0].row,workId)};
}
export async function restoreTaskWork(tx,beforeTask,expectedTask,workRow){
 await workForeignKeyGuard(tx);
 need(beforeTask?.workId===null&&workRow?.id===expectedTask?.workId&&typeof beforeTask.updatedAt==='string','EXACT_CHILD_RESTORE_BINDING_REQUIRED');validatePreparedTask(beforeTask,expectedTask,workRow.id);
 const currentTask=await raw(tx,'Task',beforeTask.id,true),currentWork=await raw(tx,'Work',workRow.id,true);need(currentTask.length===1&&currentWork.length===1,'KNOWN_CHILD_ROWS_REQUIRED');equal(currentTask[0].row,expectedTask,'CHILD_TASK_RAW_CAS_CHANGED');equal(currentWork[0].row,workRow,'CHILD_WORK_RAW_CAS_CHANGED');
 const refs=await tx.$queryRawUnsafe('SELECT \'Task\'::text model,count(*)::int count FROM "Task" WHERE "workId"=$1 AND id<>$2 UNION ALL SELECT \'TaskAllocationGroup\'::text,count(*)::int FROM "TaskAllocationGroup" WHERE "workId"=$1 UNION ALL SELECT \'PayrollEntry\'::text,count(*)::int FROM "PayrollEntry" WHERE "workId"=$1 UNION ALL SELECT \'WorkPaymentConversion\'::text,count(*)::int FROM "WorkPaymentConversion" WHERE "workId"=$1 UNION ALL SELECT \'ProductStageSettlementShare\'::text,count(*)::int FROM "ProductStageSettlementShare" WHERE "workId"=$1',workRow.id,beforeTask.id);
 need(refs.length===5&&refs.every(row=>row.count===0),'UNOWNED_CHILD_WORK_REFERENCE_STOP');
 const restored=await tx.$queryRawUnsafe('UPDATE "Task" t SET "workId"=$1,"updatedAt"=$2::timestamp WHERE t.id=$3 AND to_jsonb(t)=$4::jsonb RETURNING to_jsonb(t) row',beforeTask.workId,beforeTask.updatedAt,beforeTask.id,JSON.stringify(expectedTask));need(restored.length===1,'FULL_RAW_TASK_RESTORE_CAS_REQUIRED');equal(restored[0].row,beforeTask,'RAW_TASK_RESTORE_NOT_EXACT');
 const removed=await tx.$queryRawUnsafe('DELETE FROM "Work" t WHERE t.id=$1 AND to_jsonb(t)=$2::jsonb RETURNING id::text id',workRow.id,JSON.stringify(workRow));need(removed.length===1&&removed[0].id===workRow.id,'EXACT_KNOWN_WORK_DELETE_REQUIRED');return {task:restored[0].row,workDeleted:true};
}