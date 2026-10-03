"use server";
import {unlink} from 'node:fs/promises';
import path from 'node:path';
import {revalidatePath} from 'next/cache';
import {auth} from '@/auth';
import {withTaskTransaction} from '../tasks/transaction';
import {s3Enabled,s3Delete,fileKey,thumbKey,UPLOADS_ROOT} from '@/lib/s3';
import {deleteProjectCoverCore} from './cover-core';
import type {ProjectCoverDelete,ProjectCoverResult} from './cover-contract';
export async function deleteProjectCoverAction(input:ProjectCoverDelete):Promise<ProjectCoverResult>{
 const session=await auth();if(!session?.user)return{ok:false,kind:'forbidden',error:'Не авторизован'};
 try{
  const useS3=s3Enabled();
  const result=await withTaskTransaction(tx=>deleteProjectCoverCore(tx,session.user,input));if(!result.ok)return result;
  if(result.storageIntent){const intent=result.storageIntent;const keys=[fileKey(intent.projectId,intent.storedName),...(intent.hasThumb?[thumbKey(intent.projectId,intent.storedName)]:[])];
   await Promise.all(keys.map(key=>useS3?s3Delete(key):unlink(path.join(UPLOADS_ROOT,key)).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;})));
  }
  revalidatePath(`/projects/${input.projectId}`);
  const {storageIntent:_intent,...ack}=result;void _intent;return ack;
 }catch{return{ok:false,kind:'failure',error:'Не удалось подтвердить удаление обложки. Повторите тот же запрос.'};}
}
