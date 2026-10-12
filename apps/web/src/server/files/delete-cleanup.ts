import type {PrismaClient} from "@prisma/client";
import {prisma} from "@/lib/prisma";
import {getEventQueueSettings,type EventQueueStore,type QueuedDomainEvent} from "../plugins/event-queue-contract";
import {createEventQueueProcessor} from "../plugins/event-queue-core";
import {createPostgresEventQueueStore} from "../plugins/event-queue-store";
import {validateFileDeleteEvent,type FileDeleteStorageIdentity} from "./delete-contract";
import {executeFileDeleteCleanup,removeFileDeleteKey,currentFileDeleteStorageIdentity} from "./delete-storage";
type Database=Pick<PrismaClient,"$queryRaw"|"file"|"changeLog">;
export async function cleanupDeletedFile(eventId:string,db:Database=prisma,remove:(identity:FileDeleteStorageIdentity,key:string)=>Promise<void>=removeFileDeleteKey,injectedStore?:EventQueueStore,currentIdentity:()=>FileDeleteStorageIdentity=currentFileDeleteStorageIdentity):Promise<boolean>{
 try{
  const settings=getEventQueueSettings(),store=injectedStore??createPostgresEventQueueStore(db,settings,[eventId]),initial=await store.read(eventId);if(!initial)return false;
  validateFileDeleteEvent(initial);
  const verifyIntent=(event:QueuedDomainEvent)=>{validateFileDeleteEvent(event);return event.id===initial.id&&event.type===initial.type&&event.actor===initial.actor&&event.createdAt.getTime()===initial.createdAt.getTime()&&JSON.stringify(event.payload)===JSON.stringify(initial.payload);};
  const processor=createEventQueueProcessor({store,settings,deliver:async(event,ownership)=>{if(!verifyIntent(event))throw Error("FILE_DELETE_INTENT_CHANGED");await executeFileDeleteCleanup(event,db,ownership,remove,currentIdentity);}});
  await processor.dispatchOne(eventId,true);return processor.waitForCompletion(eventId,{verifyIntent});
 }catch{return false;}
}
