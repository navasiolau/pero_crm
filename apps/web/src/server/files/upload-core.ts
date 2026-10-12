import {createHash} from 'node:crypto';
import type {Prisma, FileSection} from '@prisma/client';
import {UploadError} from './upload-result';
import {assertWritableFileStorageKey} from './storage-binding-fence';

export const uploadMutationPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function uploadFingerprint(input:{actorId:string;projectId:string;productId:string|null;taskId:string|null;section:FileSection;fileName:string;mimeType:string;size:number;contentHash:string}){
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
export type UploadReceipt={id:string;repeated:boolean;clientMutationId:string};
export async function readUploadReceipt(tx:Pick<Prisma.TransactionClient,'changeLog'|'file'>,actorId:string,clientMutationId:string,fingerprint:string):Promise<UploadReceipt|null>{
  const receipt=await tx.changeLog.findUnique({where:{id:`file-upload:${clientMutationId}`}});
  if(!receipt)return null;
  const value=receipt.newValue as {uploadFingerprint?:string}|null;
  if(receipt.actorId!==actorId||receipt.entity!=='file'||receipt.action!=='create'||value?.uploadFingerprint!==fingerprint)
    throw new UploadError('UPLOAD_REPLAY_CONFLICT',409,'persist','Этот запрос загрузки уже использован с другим файлом.','conflict');
  if(!await tx.file.findUnique({where:{id:receipt.entityId},select:{id:true}}))
    throw new UploadError('UPLOAD_FILE_DELETED',409,'persist','Файл этого запроса уже удалён.','conflict');
  return{id:receipt.entityId,repeated:true,clientMutationId};
}
export async function persistOrdinaryUpload(tx:Prisma.TransactionClient,actor:{id:string;name?:string|null},input:{clientMutationId:string;fingerprint:string;projectNumber:string;data:Prisma.FileUncheckedCreateInput}):Promise<UploadReceipt>{
  const prior=await readUploadReceipt(tx,actor.id,input.clientMutationId,input.fingerprint);
  if(prior)return prior;
  await assertWritableFileStorageKey(tx,input.data.projectId,input.data.storedName);
  const file=await tx.file.create({data:input.data});
  await tx.changeLog.create({data:{id:`file-upload:${input.clientMutationId}`,actorType:'user',actorId:actor.id,actorName:actor.name??undefined,
    source:'web',entity:'file',entityId:file.id,action:'create',newValue:{project:input.projectNumber,fileName:file.fileName,section:file.section,
      uploadFingerprint:input.fingerprint,clientMutationId:input.clientMutationId}}});
  return{id:file.id,repeated:false,clientMutationId:input.clientMutationId};
}
