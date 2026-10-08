import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import type {PrismaClient} from '@prisma/client';
import {createTaskTransaction} from '../src/server/tasks/transaction';
import {warehouseMove} from '../src/server/warehouse/accounting';
import {createDeletionFixture,deleteDeletionFixture,deletionBaseline} from './helpers/warehouse-deletion-fixture';
import {warehouseTestState} from './helpers/warehouse-test-state';
import type {MovementDeletionPreview} from '../src/server/warehouse/deletion-contracts';

export function deletionActionIds(manifest:{node:Record<string,{exportedName?:string;filename?:string}>}){
 const wanted=['previewWarehouseMovementDeletion','deleteWarehouseMovement'],ids:Record<string,string>={};
 for(const [id,entry] of Object.entries(manifest.node))if(wanted.includes(entry.exportedName??'')){
  assert.match(entry.filename?.replaceAll('\\','/')??'',/(?:^|\/)server\/warehouse\/deletion-actions\.ts$/);
  assert.match(id,/^[a-f0-9]{40,42}$/);assert.equal(ids[entry.exportedName!],undefined);ids[entry.exportedName!]=id;
 }
 assert.equal(Object.keys(ids).length,2);return ids;
}
type ActionReply={ok:boolean;error?:string;preview?:MovementDeletionPreview;deletionId?:string;repeated?:boolean};
function reply(text:string):ActionReply|null{
 const results:ActionReply[]=[];
 for(const line of text.split('\n')){const index=line.indexOf(':');if(index<1)continue;
  try{const value=JSON.parse(line.slice(index+1));if(value&&typeof value==='object'&&typeof value.ok==='boolean')results.push(value);}catch{/* Остальные Flight records не исполняются. */}}
 assert.ok(results.length<=1);return results[0]??null;
}
export async function runWarehouseDeletionHttp(db:PrismaClient,ids:Record<string,string>,request:(path:string,actorId:string,options?:RequestInit)=>Promise<Response>,allowLocal=false){
 const before=await deletionBaseline(db),marker='qa109-http-'+randomUUID(),transaction=createTaskTransaction(db),state=await warehouseTestState(db,marker,allowLocal);
 try{
  // Не вызываем произвольные внешние hook-подписки из QA.
  assert.equal(await db.plugin.count({where:{enabled:true,id:{not:'file-stages'}}}),0,'EXTERNAL_PLUGIN_HOOK_GUARD');
  const f=await transaction(tx=>createDeletionFixture(state.wrap(tx),marker));
  const call=async(name:string,args:unknown[])=>{
   const response=await request('/warehouse/movements',marker,{method:'POST',headers:{'content-type':'application/json','next-action':ids[name]},body:JSON.stringify(args)});
   return {status:response.status,value:reply(await response.text())};
  };
  const adminPage=await request('/warehouse/movements',marker);assert.equal(adminPage.status,200,'ADMIN_SSR');assert.ok((await adminPage.text()).includes('Удалить'));
  for(const role of ['DIRECTOR','PROCUREMENT','ACCOUNTANT','MANAGER'] as const){
   await db.user.update({where:{id:marker},data:{roles:[role]}});
   const page=await request('/warehouse/movements',marker);
   if(role==='ACCOUNTANT')assert.ok([302,307].includes(page.status));else assert.equal(page.status,200);
   assert.ok(!(await page.text()).includes('>Удалить<'));
   const denied=await call('previewWarehouseMovementDeletion',[f.receipt.receipt.movementId]);assert.notEqual(denied.value?.ok,true);
   const deniedDelete=await call('deleteWarehouseMovement',[{movementId:f.receipt.receipt.movementId,clientMutationId:randomUUID(),planFingerprint:'f'.repeat(64)}]);assert.notEqual(deniedDelete.value?.ok,true);
  }
  await db.user.update({where:{id:marker},data:{roles:['ADMIN']}});
  const initial=await call('previewWarehouseMovementDeletion',[f.receipt.receipt.movementId]);assert.equal(initial.status,200,'ADMIN_PREVIEW_HTTP');
  if(state.mode==='LOCAL_READ_FIXTURE'){
   assert.equal(initial.value?.ok,false);assert.match(initial.value?.error??'',/Склад временно закрыт/);
   return {status:'PASS',roles:'REAL_SERVER_ACTIONS_AND_SSR',localPhase:'UNINITIALIZED_NO_GLOBAL_CHANGE',acceptedMutation:'STAGING_ONLY',providerMessages:0};
  }
  assert.equal(initial.value?.ok,true);const preview=initial.value!.preview!;assert.equal(preview.refunds[0].amount,'3700.00');
  await transaction(tx=>warehouseMove(tx,f.actor,{kind:'EXPENSE',productId:marker,materialId:marker,quantity:'1',clientMutationId:randomUUID()}));
  const stale=await call('deleteWarehouseMovement',[{movementId:preview.movementId,clientMutationId:randomUUID(),planFingerprint:preview.planFingerprint}]);
  assert.equal(stale.value?.ok,false);assert.match(stale.value?.error??'',/Обновите расчёт/);
  const refreshed=await call('previewWarehouseMovementDeletion',[preview.movementId]);assert.equal(refreshed.value?.ok,true);
  assert.equal(refreshed.value!.preview!.movements.length,2);
  const input={movementId:preview.movementId,clientMutationId:randomUUID(),planFingerprint:refreshed.value!.preview!.planFingerprint};
  const deleted=await call('deleteWarehouseMovement',[input]);assert.equal(deleted.status,200,'ADMIN_DELETE_HTTP');assert.equal(deleted.value?.ok,true);
  const retry=await call('deleteWarehouseMovement',[input]);assert.equal(retry.value?.ok,true);assert.equal(retry.value?.deletionId,deleted.value?.deletionId);assert.equal(retry.value?.repeated,true);
  assert.equal(await db.stockMovement.count({where:{materialId:marker,deletionId:deleted.value!.deletionId}}),2);
  assert.equal((await db.warehouseBalance.findUniqueOrThrow({where:{materialId:marker}})).quantity.toString(),'0');
  const after=await request('/warehouse/movements',marker);assert.equal(after.status,200);assert.ok(!(await after.text()).includes(preview.movementId));
  return {status:'PASS',roles:'REAL_SERVER_ACTIONS_AND_SSR',preview:'CASCADE2_REFUND3700',stale:'REJECTED',deleted:'SOFT',retry:'ONCE',providerMessages:0};
 }finally{await transaction(tx=>deleteDeletionFixture(tx,marker));assert.deepEqual(await deletionBaseline(db),before,'HTTP_ORIGINAL_DATA_CHANGED');}
}
