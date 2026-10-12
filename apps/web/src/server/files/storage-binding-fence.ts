import {Prisma} from "@prisma/client";
import {FILE_STORAGE_DELETE_EVENT,validateFileDeleteEvent,fileDeleteIntentHash} from "./delete-contract";
import {UploadError} from "./upload-result";

const canonical=(projectId:string,storedName:string)=>[projectId.toLowerCase(),storedName.toLowerCase()];
/** Одна lock identity у delete и всех runtime creators; original/thumbnail — один объект. */
export async function lockFileStorageBinding(tx:Pick<Prisma.TransactionClient,"$queryRaw">,projectId:string,storedName:string){
 const key="file-storage-binding:"+JSON.stringify(canonical(projectId,storedName));
 await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key},0))`);
}
/** COMPLЕTED intent остаётся tombstone: повторная привязка удалённого key не поддерживается. */
export async function assertWritableFileStorageKey(tx:Pick<Prisma.TransactionClient,"$queryRaw"|"changeLog">,projectId:string,storedName:string){
 await lockFileStorageBinding(tx,projectId,storedName);
 const [project,name]=canonical(projectId,storedName);
 const retired=await tx.$queryRaw<{id:string;type:string;actor:string;payload:unknown}[]>(Prisma.sql`SELECT "id","type","actor","payload" FROM "DomainEvent"
  WHERE "type"=${FILE_STORAGE_DELETE_EVENT} AND lower("payload"->>'projectId')=${project} AND lower("payload"->>'storedName')=${name}`);
 for(const event of retired){
  const intent=validateFileDeleteEvent(event),receipt=await tx.changeLog.findUnique({where:{id:event.id}}),value=receipt?.newValue;
  if(!receipt||receipt.actorId!==intent.actorId||receipt.entity!=="file"||receipt.entityId!==intent.fileId||receipt.action!=="delete"||!value||typeof value!=="object"||Array.isArray(value)||value.intentHash!==fileDeleteIntentHash(intent))throw Error("FILE_STORAGE_RETIREMENT_INVALID");
 }
 if(retired.length)throw new UploadError("FILE_STORAGE_KEY_RETIRED",409,"persist","Файл уже удалён. Загрузите его заново.","conflict");
}
