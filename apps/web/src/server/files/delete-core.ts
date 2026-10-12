import {Prisma} from "@prisma/client";
import {fileVisibilityWhere,projectVisibilityWhere,resolveVisibilityActor,type VisibilityActor} from "../access/visibility";
import {mayDeleteStoredFile} from "./delete-permission";
import {lockFileStorageBinding} from "./storage-binding-fence";
import {fileDeleteEventId,type FileDeleteStorageIdentity,type FileDeleteRequest,type FileDeleteResult} from "./delete-contract";
import {fileDeleteFingerprint,lockFileDeletionRequest,persistFileDeleteIntent} from "./delete-intent";

type Actor=VisibilityActor&{name?:string|null};
const failure=(error:string):FileDeleteResult=>({ok:false,error});
export async function deleteOrdinaryFileCore(tx:Prisma.TransactionClient,identity:Actor,input:FileDeleteRequest,storage:FileDeleteStorageIdentity):Promise<FileDeleteResult>{
 await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id=${identity.id} FOR SHARE`);
 const user=await tx.user.findUnique({where:{id:identity.id},select:{id:true,name:true,roles:true,active:true}});
 if(!user?.active)return failure("Недостаточно прав");
 const actor=await resolveVisibilityActor(tx,{id:user.id,roles:user.roles}),eventId=fileDeleteEventId(input.clientMutationId),requestFingerprint=fileDeleteFingerprint(actor.id,input.fileId);
 await lockFileDeletionRequest(tx,input.clientMutationId);
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
 await tx.file.delete({where:{id:file.id}});
 return(await persistFileDeleteIntent(tx,{id:actor.id,name:user.name},file,input.clientMutationId,storage)).result;
}
