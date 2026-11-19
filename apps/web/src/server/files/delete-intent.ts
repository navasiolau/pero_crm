import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import {createHash} from "node:crypto";
import {Prisma,type File} from "@prisma/client";
import {FILE_STORAGE_DELETE_EVENT,fileDeleteEventId,fileDeleteIntentSchema,fileDeleteKeys,fileDeleteIntentHash,type FileDeleteStorageIdentity,type FileDeleteResult} from "./delete-contract";
import {retainedFileReversal,retainedFileReversalState,type RetainedFileReversal} from "./retained-file-reversal";
import {lockFileStorageBinding} from "./storage-binding-fence";
import {operationJournalContext,journalSnapshot,journalUserReferences,systemJournalActor,FILE_JOURNAL_FIELDS} from '../tasks/journal';
type DeletedFile=Pick<File,"id"|"projectId"|"productId"|"taskId"|"uploadedById"|"storedName"|"hasThumb"|"fileName">&Partial<Pick<File,'mimeType'|'size'|'section'>>;
type Actor={id:string;name?:string|null};
export const fileDeleteFingerprint=(actorId:string,fileId:string)=>createHash("sha256").update(JSON.stringify({actorId,fileId})).digest("hex");
export async function lockFileDeletionRequest(tx:Pick<Prisma.TransactionClient,"$queryRaw">,clientMutationId:string){
 await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${fileDeleteEventId(clientMutationId)},0))`);
}
/** Вызывается только в transaction точного metadata/CAS delete; сетевых effects нет. */
export async function persistFileDeleteIntent(tx:Prisma.TransactionClient,actor:Actor,file:DeletedFile,clientMutationId:string,storage:FileDeleteStorageIdentity,
  deletedAt?:Date,pointer?:RetainedFileReversal["pointer"]){
 const eventId=fileDeleteEventId(clientMutationId);
 if(await tx.changeLog.findUnique({where:{id:eventId}}))throw Error("FILE_DELETE_RECEIPT_CONFLICT");
 await lockFileStorageBinding(tx,file.projectId,file.storedName);
 const intent=fileDeleteIntentSchema.parse({fileId:file.id,projectId:file.projectId,storedName:file.storedName,hasThumb:file.hasThumb,actorId:actor.id,clientMutationId,storage,keys:fileDeleteKeys(file)});
 const result:Extract<FileDeleteResult,{ok:true}>={ok:true,fileId:file.id,clientMutationId,projectId:file.projectId,productId:file.productId};
 await writeChangeLogInTransaction(tx, {id:eventId,actorType:"user",actorId:actor.id,actorName:actor.name??undefined,source:"web",entity:"file",entityId:file.id,action:"delete",
  ...(deletedAt ? { reversal:retainedFileReversal.command({files:[retainedFileReversalState(file,deletedAt,false)],pointer}) } : {}),oldValue:{fileName:file.fileName},newValue:JSON.parse(JSON.stringify({requestFingerprint:fileDeleteFingerprint(actor.id,file.id),intentHash:fileDeleteIntentHash(intent),context:{projectId:file.projectId,productId:file.productId,taskId:file.taskId,uploadedById:file.uploadedById},result}))},
  {...await operationJournalContext(tx,{type:'file',id:file.id,label:file.fileName},[file],await journalUserReferences(tx,[file.uploadedById])),before:journalSnapshot(file,FILE_JOURNAL_FIELDS),after:null,
    ...(actor.id==='kp-retention'?{...systemJournalActor(actor,'Очистка файлов по сроку хранения'),initiator:undefined}:{})});
 // Исторический обработчик КП создаёт эту квитанцию после доказанного отсутствия объекта.
 if (!deletedAt && actor.id === "kp-retention")
  await tx.domainEvent.create({data:{id:eventId,type:FILE_STORAGE_DELETE_EVENT,actor:"user:"+actor.id,
    payload:JSON.parse(JSON.stringify(intent)),processedAt:new Date()}});
 return{eventId,result};
}
