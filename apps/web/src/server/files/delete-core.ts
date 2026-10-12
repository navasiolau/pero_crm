import {createHash} from "node:crypto";
import {Prisma} from "@prisma/client";
import {fileVisibilityWhere,projectVisibilityWhere,resolveVisibilityActor,type VisibilityActor} from "../access/visibility";
import {mayDeleteStoredFile} from "./delete-permission";
import {lockFileStorageBinding} from "./storage-binding-fence";
import {FILE_STORAGE_DELETE_EVENT,fileDeleteEventId,fileDeleteIntentSchema,fileDeleteKeys,fileDeleteIntentHash,type FileDeleteStorageIdentity,type FileDeleteRequest,type FileDeleteResult} from "./delete-contract";

type Actor=VisibilityActor&{name?:string|null};
const fingerprint=(actorId:string,fileId:string)=>createHash("sha256").update(JSON.stringify({actorId,fileId})).digest("hex");
const failure=(error:string):FileDeleteResult=>({ok:false,error});
const json=(value:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(value));
export async function deleteOrdinaryFileCore(tx:Prisma.TransactionClient,identity:Actor,input:FileDeleteRequest,storage:FileDeleteStorageIdentity):Promise<FileDeleteResult>{
 await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id=${identity.id} FOR SHARE`);
 const user=await tx.user.findUnique({where:{id:identity.id},select:{id:true,name:true,roles:true,active:true}});
 if(!user?.active)return failure("Недостаточно прав");
 const actor=await resolveVisibilityActor(tx,{id:user.id,roles:user.roles}),eventId=fileDeleteEventId(input.clientMutationId),requestFingerprint=fingerprint(actor.id,input.fileId);
 await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${eventId},0))`);
 const prior=await tx.changeLog.findUnique({where:{id:eventId}});
 if(prior){
  const saved=prior.newValue;
  if(prior.actorId!==actor.id||prior.entity!=="file"||prior.entityId!==input.fileId||prior.action!=="delete"||!saved||typeof saved!=="object"||Array.isArray(saved)||saved.requestFingerprint!==requestFingerprint)return failure("Идентификатор операции уже использован");
  const context=saved.context,result=saved.result;
  if(!context||typeof context!=="object"||Array.isArray(context)||typeof context.projectId!=="string"||(context.productId!==null&&typeof context.productId!=="string")||(context.taskId!==null&&typeof context.taskId!=="string")||(context.uploadedById!==null&&typeof context.uploadedById!=="string")||!result||typeof result!=="object"||Array.isArray(result)||result.ok!==true||result.fileId!==input.fileId||result.clientMutationId!==input.clientMutationId)throw Error("FILE_DELETE_RECEIPT_INVALID");
  const fileContext={projectId:context.projectId,productId:context.productId,taskId:context.taskId,uploadedById:context.uploadedById};
  if(!await tx.project.findFirst({where:{AND:[{id:context.projectId},projectVisibilityWhere(actor)]},select:{id:true}})||!await mayDeleteStoredFile(tx,actor,fileContext))return failure("Недостаточно прав");
  return{ok:true,fileId:input.fileId,clientMutationId:input.clientMutationId,projectId:context.projectId,productId:context.productId,repeated:true};
 }
 await tx.$queryRaw(Prisma.sql`SELECT id FROM "File" WHERE id=${input.fileId} FOR UPDATE`);
 const file=await tx.file.findFirst({where:{AND:[{id:input.fileId},fileVisibilityWhere(actor)]}});
 if(!file)return failure("Файл не найден");
 if(!await mayDeleteStoredFile(tx,actor,file))return failure("Недостаточно прав");
 await lockFileStorageBinding(tx,file.projectId,file.storedName);
 const intent=fileDeleteIntentSchema.parse({fileId:file.id,projectId:file.projectId,storedName:file.storedName,hasThumb:file.hasThumb,actorId:actor.id,clientMutationId:input.clientMutationId,storage,keys:fileDeleteKeys(file)});
 const result:FileDeleteResult={ok:true,fileId:file.id,clientMutationId:input.clientMutationId,projectId:file.projectId,productId:file.productId};
 await tx.file.delete({where:{id:file.id}});
 await tx.changeLog.create({data:{id:eventId,actorType:"user",actorId:actor.id,actorName:user.name,source:"web",entity:"file",entityId:file.id,action:"delete",oldValue:{fileName:file.fileName},newValue:json({requestFingerprint,intentHash:fileDeleteIntentHash(intent),context:{projectId:file.projectId,productId:file.productId,taskId:file.taskId,uploadedById:file.uploadedById},result})}});
 await tx.domainEvent.create({data:{id:eventId,type:FILE_STORAGE_DELETE_EVENT,actor:"user:"+actor.id,payload:json(intent)}});
 return result;
}
