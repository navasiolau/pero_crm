'use server';
import {revalidatePath} from 'next/cache';
import {requireRole} from '@/server/require-role';
import {WAREHOUSE_DELETE_ROLES} from '@/lib/roles';
import {withTaskTransaction} from '@/server/tasks/transaction';
import {dispatchEvent} from '@/server/plugins/events';
import {deleteMovementInTransaction,previewMovementDeletionInTransaction} from './deletion-core';
import {revalidateWarehouse} from './revalidate';
import type {MovementDeletionInput} from './deletion-contracts';

export async function previewWarehouseMovementDeletion(movementId:string){
  const session=await requireRole(WAREHOUSE_DELETE_ROLES);
  try{
    const preview=await withTaskTransaction(tx=>previewMovementDeletionInTransaction(tx,{...session.user,name:session.user.name??'',source:'web'},movementId));
    return {ok:true as const,preview};
  }catch(error){return {ok:false as const,error:error instanceof Error?error.message:'Не удалось рассчитать удаление'};}
}
export async function deleteWarehouseMovement(input:MovementDeletionInput){
  const session=await requireRole(WAREHOUSE_DELETE_ROLES);
  let result;
  try{result=await withTaskTransaction(tx=>deleteMovementInTransaction(tx,{...session.user,name:session.user.name??'',source:'web'},input));}
  catch(error){return {ok:false as const,error:error instanceof Error?error.message:'Не удалось удалить движение'};}
  if(result.eventId)await dispatchEvent(result.eventId).catch(()=>{});
  await revalidateWarehouse();
  for(const product of new Map(result.productRefs.map(row=>[row.id,row])).values())await revalidateWarehouse(product.id,product.projectId);
  revalidatePath('/finance','layout');
  return {ok:true as const,deletionId:result.id,repeated:result.repeated};
}
