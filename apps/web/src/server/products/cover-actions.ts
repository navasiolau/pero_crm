"use server";
import {auth} from '@/auth';
import {cleanupDeletedFile} from '@/server/files/delete-cleanup';
import {fileDeleteEventId} from '@/server/files/delete-contract';
import {revalidateProductPaths} from '@/server/products/revalidate';
import {withTaskTransaction} from '@/server/tasks/transaction';
import {bindProductSketchCore,deleteProductSketchCore,setProductCoverCore} from './cover-core';
import type {SketchBindInput,SketchDeleteInput,SketchResult} from './sketch-contract';
async function actor(){const session=await auth();return session?.user?{id:session.user.id,name:session.user.name,roles:session.user.roles}:null;}
export async function bindProductSketchAction(input:SketchBindInput):Promise<SketchResult>{const user=await actor();if(!user)return{ok:false,kind:'forbidden',error:'Не авторизован'};try{const result=await withTaskTransaction(tx=>bindProductSketchCore(tx,user,input));if(result.ok)await revalidateProductPaths(input.productId).catch(()=>{});return result;}catch{return{ok:false,kind:'failure',error:'Не удалось назначить эскиз'};}}
export async function deleteProductSketchAction(input:SketchDeleteInput):Promise<SketchResult>{
 const user=await actor();if(!user)return{ok:false,kind:'forbidden',error:'Не авторизован'};
 let result:SketchResult;try{result=await withTaskTransaction(tx=>deleteProductSketchCore(tx,user,input));}catch{return{ok:false,kind:'failure',error:'Не удалось удалить эскиз'};}
 if(!result.ok)return result;
 const durable=result.cleanupEventId===fileDeleteEventId(input.clientMutationId);
 const completed=durable?await cleanupDeletedFile(result.cleanupEventId!).catch(()=>false):false;
 await revalidateProductPaths(input.productId).catch(()=>{});
 const{storageIntent:_intent,cleanupEventId:_event,...ack}=result;void _intent;void _event;
 return{...ack,cleanupPending:!completed,cleanupReconciliation:!durable};
}
export async function setProductCover(productId:string,fileId:string,baseline?:{expectedSketchFileId:null;clientMutationId:string}):Promise<SketchResult>{const user=await actor();if(!user)return{ok:false,kind:'forbidden',error:'Не авторизован'};try{const result=await withTaskTransaction(tx=>setProductCoverCore(tx,user,productId,fileId,baseline));if(result.ok)await revalidateProductPaths(productId).catch(()=>{});return result;}catch{return{ok:false,kind:'failure',error:'Не удалось назначить эскиз'};}}
