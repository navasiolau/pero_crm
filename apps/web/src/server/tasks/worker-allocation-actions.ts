'use server';
import {auth} from '@/auth';
import {revalidatePath} from 'next/cache';
import {revalidateProductPaths} from '@/server/products/revalidate';
import {dispatchEvent} from '@/server/plugins/events';
import {notifyPerson} from '@/server/notifications/notify';
import {createWorkerTaskAllocationCore,type WorkerTaskInput} from './worker-allocation-core';
export async function createWorkerWorkTask(input:WorkerTaskInput){
 const session=await auth();if(!session?.user)return{ok:false as const,kind:'forbidden' as const,error:'Не авторизован'};
 const result=await createWorkerTaskAllocationCore({id:session.user.id,name:session.user.name??'',roles:session.user.roles,source:'web'},input);
 if(!result.ok)return result;
 if(!result.repeated){
  try{if(result.eventId)await dispatchEvent(result.eventId);await notifyPerson({userId:result.assigneeId,type:'task.assigned',title:`Вам назначена задача: ${input.title}`,link:'/my'});}catch{console.warn(JSON.stringify({event:'worker-allocation.delivery-failed',requestId:result.clientMutationId}));}
 }
 try{await revalidateProductPaths(input.productId);revalidatePath('/my');}catch{/* Confirmed task remains confirmed if cache refresh fails. */}
 return result;
}
