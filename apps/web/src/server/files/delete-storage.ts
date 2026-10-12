import {lstat,unlink} from "node:fs/promises";
import path from "node:path";
import type {PrismaClient} from "@prisma/client";
import {UPLOADS_ROOT,storageConfiguration,s3Delete} from "@/lib/s3";
import {EventDeliveryError,type QueuedDomainEvent} from "../plugins/event-queue-contract";
import type {EventDeliveryContext} from "../plugins/event-queue-core";
import {validateFileDeleteEvent,fileDeleteIntentHash,type FileDeleteStorageIdentity} from "./delete-contract";

export function currentFileDeleteStorageIdentity():FileDeleteStorageIdentity{
 const config=storageConfiguration();return config.mode==="local"?{mode:"local",root:path.resolve(UPLOADS_ROOT)}:{mode:"s3",endpoint:config.endpoint,bucket:config.bucket};
}
async function noSymlink(target:string){try{if((await lstat(target)).isSymbolicLink())throw Error("FILE_DELETE_STORAGE_PATH_INVALID");}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
export async function removeLocalFileDeleteKey(root:string,key:string){
 const target=path.resolve(root,key),relative=path.relative(root,target);
 if(!relative||relative===".."||relative.startsWith(".."+path.sep)||path.isAbsolute(relative))throw Error("FILE_DELETE_STORAGE_PATH_INVALID");
 const targets:string[]=[];for(let current=target;;current=path.dirname(current)){targets.unshift(current);if(current===path.parse(current).root)break;}
 for(const current of targets)await noSymlink(current);
 try{await unlink(target);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
}
export async function removeFileDeleteKey(identity:FileDeleteStorageIdentity,key:string){if(identity.mode==="local")await removeLocalFileDeleteKey(identity.root,key);else await s3Delete(key);}
export async function executeFileDeleteCleanup(event:QueuedDomainEvent,db:Pick<PrismaClient,"file"|"changeLog">,ownership:EventDeliveryContext,
 remove:(identity:FileDeleteStorageIdentity,key:string)=>Promise<void>=removeFileDeleteKey,
 currentIdentity:()=>FileDeleteStorageIdentity=currentFileDeleteStorageIdentity):Promise<void>{
 try{
  const intent=validateFileDeleteEvent(event),receipt=await db.changeLog.findUnique({where:{id:event.id}});
  const value=receipt?.newValue;
  if(!receipt||receipt.actorId!==intent.actorId||receipt.entity!=="file"||receipt.entityId!==intent.fileId||receipt.action!=="delete"||!value||typeof value!=="object"||Array.isArray(value)||value.intentHash!==fileDeleteIntentHash(intent))throw Error("FILE_DELETE_RECEIPT_REQUIRED");
  for(const key of intent.keys){
   if(!ownership.isActive()||!await ownership.ensureOwned())throw new EventDeliveryError("EVENT_CLAIM_LOST");
   if(JSON.stringify(currentIdentity())!==JSON.stringify(intent.storage))throw Error("FILE_DELETE_STORAGE_IDENTITY_CHANGED");
   if(await db.file.findFirst({where:{OR:[{id:intent.fileId},{projectId:intent.projectId,storedName:intent.storedName}]},select:{id:true}}))throw Error("FILE_DELETE_STORAGE_REFERENCED");
   await remove(intent.storage,key);
  }
 }catch(error){if(error instanceof EventDeliveryError)throw error;throw new EventDeliveryError("EVENT_DELIVERY_FAILED");}
}
