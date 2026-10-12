import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {MANAGER_ROLES,hasAnyRole} from '@/lib/roles';
import {isCoverImageMime} from '@/lib/product-cover';
import {assertWritableFileStorageKey} from '@/server/files/storage-binding-fence';
import {lockFileDeletionRequest,persistFileDeleteIntent} from '@/server/files/delete-intent';
import {currentFileDeleteStorageIdentity} from '@/server/files/delete-storage';
import type {FileDeleteStorageIdentity} from '@/server/files/delete-contract';
import {projectVisibilityWhere,type VisibilityActor} from '../access/visibility';
import {projectCoverUploadSchema,projectCoverDeleteSchema,type ProjectCoverUpload,type ProjectCoverDelete,type ProjectCoverResult} from './cover-contract';
type Tx=Prisma.TransactionClient;
type Actor=VisibilityActor&{name?:string|null};
type UploadFile={fileName:string;storedName:string;mimeType:string;size:number;hasThumb:boolean;contentHash:string};
const fail=(kind:Extract<ProjectCoverResult,{ok:false}>['kind'],error:string,currentCoverFileId?:string|null):ProjectCoverResult=>({ok:false,kind,error,...(currentCoverFileId===undefined?{}:{currentCoverFileId})});
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json=(value:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(value));
async function permission(tx:Tx,actor:Actor,projectId:string){
 if(!hasAnyRole(actor.roles,MANAGER_ROLES))return null;
 return tx.project.findFirst({where:{AND:[{id:projectId},projectVisibilityWhere(actor)]},select:{id:true,number:true,coverFileId:true}});
}
async function replay(tx:Tx,actor:Actor,projectId:string,mutationId:string,fingerprint:string,currentCoverFileId:string|null){
 const row=await tx.changeLog.findUnique({where:{id:`project-cover:${mutationId}`}});if(!row)return null;
 const saved=row.newValue;
 if(row.actorId!==actor.id||row.entity!=='project'||row.entityId!==projectId||row.action!=='cover.receipt'||!saved||typeof saved!=='object'||Array.isArray(saved)||saved.fingerprint!==fingerprint||!saved.result||typeof saved.result!=='object')return fail('conflict','Идентификатор операции уже использован');
 const result=saved.result as unknown as Extract<ProjectCoverResult,{ok:true}>;
 if(result.ok!==true||result.clientMutationId!==mutationId||(result.coverFileId!==null&&(typeof result.coverFileId!=='string'||result.id!==result.coverFileId)))return fail('conflict','Идентификатор операции уже использован');
 if(result.coverFileId!==currentCoverFileId)return fail('conflict','Обложка проекта уже изменена',currentCoverFileId);
 return{...result,repeated:true};
}
async function receipt(tx:Tx,actor:Actor,projectId:string,mutationId:string,fingerprint:string,result:ProjectCoverResult){
 await tx.changeLog.create({data:{id:`project-cover:${mutationId}`,actorType:'user',actorId:actor.id,actorName:actor.name??undefined,entity:'project',entityId:projectId,action:'cover.receipt',field:'coverFileId',newValue:json({fingerprint,result})}});
}
export async function authorizeProjectCoverUpload(tx:Tx,actor:Actor,input:ProjectCoverUpload){
 if(!projectCoverUploadSchema.safeParse(input).success)return{ok:false as const,kind:'validation' as const,error:'Обновите форму обложки проекта'};
 const project=await permission(tx,actor,input.projectId);if(!project)return{ok:false as const,kind:'forbidden' as const,error:'Недостаточно прав'};
 const existing=await tx.changeLog.findUnique({where:{id:`project-cover:${input.clientMutationId}`}});
 if(existing){
  const saved=existing.newValue,result=saved&&typeof saved==='object'&&!Array.isArray(saved)?saved.result:null;
  if(existing.actorId!==actor.id||existing.entity!=='project'||existing.entityId!==input.projectId||existing.action!=='cover.receipt'||!result||typeof result!=='object'||Array.isArray(result)||result.ok!==true||result.clientMutationId!==input.clientMutationId||typeof result.coverFileId!=='string'||!result.coverFileId||result.id!==result.coverFileId||result.storageIntent!==undefined)return{ok:false as const,kind:'conflict' as const,error:'Идентификатор операции уже использован'};
  if(result.coverFileId!==project.coverFileId)return{ok:false as const,kind:'conflict' as const,error:'Обложка проекта уже изменена',currentCoverFileId:project.coverFileId};
  return{ok:true as const,project,replayHint:true};
 }
 if(project.coverFileId!==null)return{ok:false as const,kind:'conflict' as const,error:'Обложка проекта уже изменена',currentCoverFileId:project.coverFileId};
 return{ok:true as const,project,replayHint:false};
}
export async function persistProjectCoverUpload(tx:Tx,actor:Actor,input:ProjectCoverUpload,file:UploadFile):Promise<ProjectCoverResult>{
 if(['category','stage','caption'].some(key=>Object.hasOwn(file,key)))return fail('validation','Обновите форму: метаданные файлов больше не используются');
 if(!projectCoverUploadSchema.safeParse(input).success||!isCoverImageMime(file.mimeType)||!file.contentHash)return fail('validation','Нужно изображение поддерживаемого формата');
 await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${input.projectId} FOR UPDATE`;
 const project=await permission(tx,actor,input.projectId);if(!project)return fail('forbidden','Недостаточно прав');
 const fingerprint=digest({operation:'upload',...input,fileName:file.fileName,mimeType:file.mimeType,size:file.size,contentHash:file.contentHash});
 const previous=await replay(tx,actor,input.projectId,input.clientMutationId,fingerprint,project.coverFileId);if(previous)return previous;
 if(project.coverFileId!==null)return fail('conflict','Обложка проекта уже изменена',project.coverFileId);
 await assertWritableFileStorageKey(tx,input.projectId,file.storedName);
 const row=await tx.file.create({data:{projectId:input.projectId,productId:null,taskId:null,section:'GENERAL',fileName:file.fileName,storedName:file.storedName,mimeType:file.mimeType,size:file.size,hasThumb:file.hasThumb,uploadedById:actor.id}});
 if((await tx.project.updateMany({where:{id:input.projectId,coverFileId:null},data:{coverFileId:row.id}})).count!==1)throw Error('PROJECT_COVER_CAS_RACE');
 await tx.changeLog.create({data:{actorType:'user',actorId:actor.id,actorName:actor.name??undefined,entity:'file',entityId:row.id,action:'create',newValue:{project:project.number,fileName:file.fileName,section:'GENERAL'}}});
 await tx.changeLog.create({data:{actorType:'user',actorId:actor.id,actorName:actor.name??undefined,entity:'project',entityId:project.id,action:'cover.upload',field:'coverFileId',oldValue:{coverFileId:null},newValue:{coverFileId:row.id}}});
 const result:ProjectCoverResult={ok:true,id:row.id,coverFileId:row.id,clientMutationId:input.clientMutationId};
 await receipt(tx,actor,project.id,input.clientMutationId,fingerprint,result);return result;
}
export async function deleteProjectCoverCore(tx:Tx,actor:Actor,input:ProjectCoverDelete,storage?:FileDeleteStorageIdentity):Promise<ProjectCoverResult>{
 if(!projectCoverDeleteSchema.safeParse(input).success)return fail('validation','Подтвердите точный файл обложки');
 await lockFileDeletionRequest(tx,input.clientMutationId);
 await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${input.projectId} FOR UPDATE`;
 const project=await permission(tx,actor,input.projectId);if(!project)return fail('forbidden','Недостаточно прав');
 const fingerprint=digest({operation:'delete',...input}),previous=await replay(tx,actor,project.id,input.clientMutationId,fingerprint,project.coverFileId);if(previous)return previous;
 if(project.coverFileId!==input.expectedCoverFileId)return fail('conflict','Обложка проекта уже изменена',project.coverFileId);
 await tx.$queryRaw`SELECT id FROM "File" WHERE id=${input.expectedCoverFileId} FOR UPDATE`;
 const file=await tx.file.findUnique({where:{id:input.expectedCoverFileId}});
 if(!file)return fail('not-found','Файл не найден');
 if(file.projectId!==project.id||file.productId!==null||file.taskId!==null||!isCoverImageMime(file.mimeType))return fail('validation','Файл не является обложкой этого проекта');
 const identity=storage??currentFileDeleteStorageIdentity();
 const cleanup=await persistFileDeleteIntent(tx,actor,file,input.clientMutationId,identity);
 if((await tx.project.updateMany({where:{id:project.id,coverFileId:file.id},data:{coverFileId:null}})).count!==1)throw Error('PROJECT_COVER_DELETE_CAS_RACE');
 await tx.file.delete({where:{id:file.id}});
 await tx.changeLog.create({data:{actorType:'user',actorId:actor.id,actorName:actor.name??undefined,entity:'project',entityId:project.id,action:'cover.delete',field:'coverFileId',oldValue:{coverFileId:file.id},newValue:{coverFileId:null}}});
 const result:ProjectCoverResult={ok:true,coverFileId:null,clientMutationId:input.clientMutationId,cleanupEventId:cleanup.eventId};
 await receipt(tx,actor,project.id,input.clientMutationId,fingerprint,result);return result;
}
