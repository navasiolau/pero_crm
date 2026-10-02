"use server";
import {unlink} from 'node:fs/promises';
import path from 'node:path';
import {auth} from '@/auth';
import {UPLOADS_ROOT,s3Enabled,s3Delete,fileKey,thumbKey} from '@/lib/s3';
import {revalidateProductPaths} from '@/server/products/revalidate';
import {withTaskTransaction} from '@/server/tasks/transaction';
import {bindProductSketchCore,deleteProductSketchCore,setProductCoverCore} from './cover-core';
import type {SketchBindInput,SketchDeleteInput,SketchResult,SketchStorageIntent} from './sketch-contract';
async function actor(){const session=await auth();return session?.user?{id:session.user.id,name:session.user.name,roles:session.user.roles}:null;}
async function removeIntent(intent:SketchStorageIntent){if(s3Enabled()){await s3Delete(fileKey(intent.projectId,intent.storedName)).catch(()=>{});if(intent.hasThumb)await s3Delete(thumbKey(intent.projectId,intent.storedName)).catch(()=>{});}else{await unlink(path.join(UPLOADS_ROOT,intent.projectId,intent.storedName)).catch(()=>{});if(intent.hasThumb)await unlink(path.join(UPLOADS_ROOT,intent.projectId,'thumbs',intent.storedName+'.jpg')).catch(()=>{});}}
export async function bindProductSketchAction(input:SketchBindInput):Promise<SketchResult>{const user=await actor();if(!user)return{ok:false,kind:'forbidden',error:'Не авторизован'};try{const result=await withTaskTransaction(tx=>bindProductSketchCore(tx,user,input));if(result.ok)await revalidateProductPaths(input.productId).catch(()=>{});return result;}catch{return{ok:false,kind:'failure',error:'Не удалось назначить эскиз'};}}
export async function deleteProductSketchAction(input:SketchDeleteInput):Promise<SketchResult>{const user=await actor();if(!user)return{ok:false,kind:'forbidden',error:'Не авторизован'};try{const result=await withTaskTransaction(tx=>deleteProductSketchCore(tx,user,input));if(result.ok){if(result.storageIntent)await removeIntent(result.storageIntent);await revalidateProductPaths(input.productId).catch(()=>{});const{storageIntent:_intent,...ack}=result;void _intent;return ack;}return result;}catch{return{ok:false,kind:'failure',error:'Не удалось удалить эскиз'};}}
export async function setProductCover(productId:string,fileId:string,baseline?:{expectedSketchFileId:null;clientMutationId:string}):Promise<SketchResult>{const user=await actor();if(!user)return{ok:false,kind:'forbidden',error:'Не авторизован'};try{const result=await withTaskTransaction(tx=>setProductCoverCore(tx,user,productId,fileId,baseline));if(result.ok)await revalidateProductPaths(productId).catch(()=>{});return result;}catch{return{ok:false,kind:'failure',error:'Не удалось назначить эскиз'};}}
