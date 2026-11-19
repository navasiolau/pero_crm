"use server";
import {revalidatePath} from 'next/cache';
import {auth} from '@/auth';
import {withTaskTransaction} from '../tasks/transaction';
import {deleteProjectCoverCore} from './cover-core';
import type {ProjectCoverDelete,ProjectCoverResult} from './cover-contract';
export async function deleteProjectCoverAction(input:ProjectCoverDelete):Promise<ProjectCoverResult>{
 const session=await auth();if(!session?.user)return{ok:false,kind:'forbidden',error:'Не авторизован'};
 const actor=session.user;
 let result:ProjectCoverResult;try{result=await withTaskTransaction(tx=>deleteProjectCoverCore(tx,actor,input));}catch{return{ok:false,kind:'failure',error:'Не удалось подтвердить удаление обложки. Повторите тот же запрос.'};}
 if(!result.ok)return result;
 try{revalidatePath(`/projects/${input.projectId}`);}catch{}
 const {storageIntent:_intent,cleanupEventId:_event,...ack}=result;void _intent;void _event;
 return ack;
}
