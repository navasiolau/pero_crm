import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {canSetProductCover,isCoverImageMime,validateProductCoverFile,type CoverProduct} from '@/lib/product-cover';
import {MANAGER_ROLES,hasAnyRole,hasRole} from '@/lib/roles';
import {fileVisibilityWhere,productEditWhere,resolveVisibilityActor,type VisibilityActor} from '@/server/access/visibility';
import {productDraftAccessSelect} from '@/server/access/product-draft-context';
import {mayDeleteStoredFile} from '@/server/files/delete-permission';
import {assertWritableFileStorageKey} from '@/server/files/storage-binding-fence';
import {lockFileDeletionRequest,persistFileDeleteIntent} from '@/server/files/delete-intent';
import {currentFileDeleteStorageIdentity} from '@/server/files/delete-storage';
import type {FileDeleteStorageIdentity} from '@/server/files/delete-contract';
import {OBSOLETE_SKETCH_EVENT,obsoleteSketchEventId,obsoleteSketchIntentSchema} from './sketch-cleanup-contract';
import {sketchUploadTargetSchema,sketchBindSchema,sketchDeleteSchema,type SketchUploadTarget,type SketchBindInput,type SketchDeleteInput,type SketchResult} from './sketch-contract';
type Tx=Prisma.TransactionClient;
export type CoverMutationActor=VisibilityActor&{name?:string|null};
export type CoverUploadTarget=SketchUploadTarget;
export type CoverUploadFileInput={fileName:string;storedName:string;mimeType:string;size:number;hasThumb:boolean;uploadedById:string;contentHash?:string};
const fail=(kind:Extract<SketchResult,{ok:false}>['kind'],error:string,currentSketchFileId?:string|null):SketchResult=>({ok:false,kind,error,...(currentSketchFileId===undefined?{}:{currentSketchFileId})});
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json=(value:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(value));
async function permission(tx:Tx,actor:CoverMutationActor,productId:string,projectId?:string){
 if(!hasAnyRole(actor.roles,MANAGER_ROLES)&&!hasRole(actor.roles,'ENGINEER'))return null;
 const visibility=await resolveVisibilityActor(tx,actor);const product=await tx.product.findFirst({where:{AND:[{id:productId,...(projectId?{projectId}:{})},productEditWhere(visibility)]},select:{...productDraftAccessSelect,id:true,engineerId:true,status:true,sketchFileId:true}});
 return product&&canSetProductCover(visibility,product)?{product,visibility}:null;
}
async function replay(tx:Tx,actor:CoverMutationActor,productId:string,mutationId:string,fingerprint:string,currentSketchFileId:string|null):Promise<SketchResult|null>{const row=await tx.changeLog.findUnique({where:{id:`product-sketch:${mutationId}`}});if(!row)return null;const saved=row.newValue;if(row.actorId!==actor.id||row.entity!=='product'||row.entityId!==productId||!saved||typeof saved!=='object'||Array.isArray(saved)||saved.fingerprint!==fingerprint||!saved.result||typeof saved.result!=='object')return fail('validation','Идентификатор операции уже использован');const result=saved.result as unknown as Extract<SketchResult,{ok:true}>;if(result.sketchFileId!==currentSketchFileId)return fail('conflict','Эскиз уже изменён другим пользователем',currentSketchFileId);return{...result,repeated:true};}
async function receipt(tx:Tx,actor:CoverMutationActor,productId:string,mutationId:string,action:string,fingerprint:string,result:SketchResult){await tx.changeLog.create({data:{id:`product-sketch:${mutationId}`,actorType:'user',actorId:actor.id,actorName:actor.name??undefined,entity:'product',entityId:productId,action,field:'sketchFileId',newValue:json({fingerprint,result})}})}
async function replacementFile(tx:Tx,actor:VisibilityActor,product:CoverProduct,baseline:string|null,lock=false){
 if(baseline===null)return {ok:true as const,file:null};
 if(lock)await tx.$queryRaw`SELECT id FROM "File" WHERE id=${baseline} FOR UPDATE`;
 const file=await tx.file.findFirst({where:{AND:[{id:baseline},fileVisibilityWhere(actor)]},select:{
  id:true,projectId:true,productId:true,mimeType:true,fileName:true,storedName:true,
  sketchForProduct:{select:{id:true}},coverForProject:{select:{id:true}}
 }});
 if(!file)return {ok:false as const,kind:'not-found' as const,error:'Исходный эскиз не найден'};
 const invalid=validateProductCoverFile(product,file);
 if(invalid)return {ok:false as const,kind:'validation' as const,error:invalid};
 if(file.coverForProject||(file.sketchForProduct&&file.sketchForProduct.id!==product.id)||
   await tx.file.count({where:{projectId:file.projectId,storedName:file.storedName,id:{not:file.id}}})!==0)
  return {ok:false as const,kind:'validation' as const,error:'Исходный эскиз используется другой обложкой или вложением'};
 if(!obsoleteSketchIntentSchema.shape.projectId.safeParse(file.projectId).success||
   !obsoleteSketchIntentSchema.shape.storedName.safeParse(file.storedName).success)
  return {ok:false as const,kind:'validation' as const,error:'Нельзя безопасно удалить исходный эскиз'};
 return {ok:true as const,file};
}
export async function authorizeProductCoverUpload(tx:Tx,actor:CoverMutationActor,input:CoverUploadTarget){
 const parsed=sketchUploadTargetSchema.safeParse(input);
 if(!parsed.success)return{ok:false as const,kind:'validation' as const,error:'Обновите форму: необходимы исходный эскиз и идентификатор операции'};
 const allowed=await permission(tx,actor,input.productId,input.projectId);
 if(!allowed)return{ok:false as const,kind:'forbidden' as const,error:'Недостаточно прав'};
 const existing=await tx.changeLog.findUnique({where:{id:`product-sketch:${input.clientMutationId}`}});
 if(existing&&existing.actorId===actor.id&&existing.entityId===input.productId&&existing.action==='cover.upload'){
  const saved=existing.newValue;
  const result=saved&&typeof saved==='object'&&!Array.isArray(saved)?saved.result:null;
  if(result&&typeof result==='object'&&!Array.isArray(result)&&result.ok===true&&result.sketchFileId!==allowed.product.sketchFileId)return{ok:false as const,kind:'conflict' as const,error:'Эскиз уже изменён другим пользователем',currentSketchFileId:allowed.product.sketchFileId};
  return{ok:true as const,product:allowed.product,replayHint:true};
 }
 if(allowed.product.sketchFileId!==input.expectedSketchFileId)return{ok:false as const,kind:'conflict' as const,error:'Эскиз уже изменён другим пользователем',currentSketchFileId:allowed.product.sketchFileId};
 const baseline=await replacementFile(tx,allowed.visibility,allowed.product,input.expectedSketchFileId);
 if(!baseline.ok)return baseline;
 return{ok:true as const,product:allowed.product,replayHint:false};
}
export async function persistUploadedProductCover(tx:Tx,actor:CoverMutationActor,input:CoverUploadTarget,file:CoverUploadFileInput):Promise<SketchResult>{
 if(['category','stage','caption'].some(key=>Object.hasOwn(file,key)))return fail('validation','Обновите форму: метаданные файлов больше не используются');
 const parsed=sketchUploadTargetSchema.safeParse(input);
 if(!parsed.success)return fail('validation','Обновите форму эскиза');
 await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${input.productId} FOR UPDATE`;
 const allowed=await permission(tx,actor,input.productId,input.projectId);
 if(!allowed)return fail('forbidden','Недостаточно прав');
 if(!isCoverImageMime(file.mimeType)||!Number.isSafeInteger(file.size)||file.size<=0||file.size>25*1024*1024||file.uploadedById!==actor.id||!/^[a-f0-9]{64}$/.test(file.contentHash??''))return fail('validation','Нужно изображение до 25 МБ');
 const fingerprint=digest({operation:'upload',...input,fileName:file.fileName,mimeType:file.mimeType,size:file.size,contentHash:file.contentHash});
 const previous=await replay(tx,actor,input.productId,input.clientMutationId,fingerprint,allowed.product.sketchFileId);
 if(previous)return previous;
 if(allowed.product.sketchFileId!==input.expectedSketchFileId)return fail('conflict','Эскиз уже изменён другим пользователем',allowed.product.sketchFileId);
 const baseline=await replacementFile(tx,allowed.visibility,allowed.product,input.expectedSketchFileId,true);
 if(!baseline.ok)return baseline;
 if(baseline.file?.storedName===file.storedName)return fail('validation','Новый эскиз должен иметь отдельный ключ хранения');
 await assertWritableFileStorageKey(tx,input.projectId,file.storedName);
 const created=await tx.file.create({data:{projectId:input.projectId,productId:input.productId,taskId:null,section:'PRODUCTION',fileName:file.fileName,storedName:file.storedName,mimeType:file.mimeType,size:file.size,hasThumb:file.hasThumb,uploadedById:actor.id},select:{id:true}});
 const changed=await tx.product.updateMany({where:{id:input.productId,sketchFileId:input.expectedSketchFileId},data:{sketchFileId:created.id}});
 if(changed.count!==1)throw Error('SKETCH_CAS_RACE');
 await tx.changeLog.create({data:{actorType:'user',actorId:actor.id,actorName:actor.name??undefined,entity:'file',entityId:created.id,action:'create',newValue:{projectId:input.projectId,productId:input.productId,fileName:file.fileName,section:'PRODUCTION'}}});
 await tx.changeLog.create({data:{actorType:'user',actorId:actor.id,actorName:actor.name??undefined,entity:'product',entityId:input.productId,action:'cover.change',field:'sketchFileId',oldValue:{sketchFileId:input.expectedSketchFileId},newValue:{sketchFileId:created.id,uploaded:true}}});
 let cleanupEventId:string|undefined;
 if(baseline.file){
  const old=baseline.file;
  cleanupEventId=obsoleteSketchEventId(input.clientMutationId);
  const intent=obsoleteSketchIntentSchema.parse({projectId:old.projectId,productId:input.productId,fileId:old.id,storedName:old.storedName,newFileId:created.id,clientMutationId:input.clientMutationId});
  await tx.file.delete({where:{id:old.id}});
  await tx.changeLog.create({data:{actorType:'user',actorId:actor.id,actorName:actor.name??undefined,entity:'file',entityId:old.id,action:'delete',oldValue:{fileName:old.fileName,replacedById:created.id}}});
  await tx.domainEvent.create({data:{id:cleanupEventId,type:OBSOLETE_SKETCH_EVENT,actor:actor.id,payload:json(intent)}});
 }
 const result:SketchResult={ok:true,id:created.id,sketchFileId:created.id,clientMutationId:input.clientMutationId,...(cleanupEventId?{cleanupEventId}:{})};
 await receipt(tx,actor,input.productId,input.clientMutationId,'cover.upload',fingerprint,result);
 return result;
}
export async function bindProductSketchCore(tx:Tx,actor:CoverMutationActor,input:SketchBindInput):Promise<SketchResult>{const parsed=sketchBindSchema.safeParse(input);if(!parsed.success)return fail('validation','Обновите форму эскиза');await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${input.productId} FOR UPDATE`;const allowed=await permission(tx,actor,input.productId);if(!allowed)return fail('forbidden','Недостаточно прав');const fingerprint=digest({operation:'bind',...input}),previous=await replay(tx,actor,input.productId,input.clientMutationId,fingerprint,allowed.product.sketchFileId);if(previous)return previous;if(allowed.product.sketchFileId!==null)return fail('conflict','Эскиз уже изменён другим пользователем',allowed.product.sketchFileId);const file=await tx.file.findFirst({where:{AND:[{id:input.fileId},fileVisibilityWhere(allowed.visibility)]},select:{id:true,projectId:true,productId:true,mimeType:true}});if(!file)return fail('not-found','Файл не найден');const invalid=validateProductCoverFile(allowed.product,file);if(invalid)return fail('validation',invalid);const changed=await tx.product.updateMany({where:{id:input.productId,sketchFileId:null},data:{sketchFileId:file.id}});if(changed.count!==1)throw Error('SKETCH_CAS_RACE');await tx.changeLog.create({data:{actorType:'user',actorId:actor.id,actorName:actor.name??undefined,entity:'product',entityId:input.productId,action:'cover.change',field:'sketchFileId',oldValue:{sketchFileId:null},newValue:{sketchFileId:file.id}}});const result:SketchResult={ok:true,id:file.id,sketchFileId:file.id,clientMutationId:input.clientMutationId};await receipt(tx,actor,input.productId,input.clientMutationId,'cover.bind',fingerprint,result);return result;}
export async function deleteProductSketchCore(tx:Tx,actor:CoverMutationActor,input:SketchDeleteInput,storage?:FileDeleteStorageIdentity):Promise<SketchResult>{
 const parsed=sketchDeleteSchema.safeParse(input);if(!parsed.success)return fail('validation','Подтвердите точный файл эскиза');
 await lockFileDeletionRequest(tx,input.clientMutationId);
 await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${input.productId} FOR UPDATE`;
 const allowed=await permission(tx,actor,input.productId);if(!allowed)return fail('forbidden','Недостаточно прав');
 const fingerprint=digest({operation:'delete',...input}),previous=await replay(tx,actor,input.productId,input.clientMutationId,fingerprint,allowed.product.sketchFileId);if(previous)return previous;
 if(allowed.product.sketchFileId!==input.expectedSketchFileId)return fail('conflict','Эскиз изменён другим пользователем',allowed.product.sketchFileId);
 await tx.$queryRaw`SELECT id FROM "File" WHERE id=${input.expectedSketchFileId} FOR UPDATE`;
 const file=await tx.file.findFirst({where:{AND:[{id:input.expectedSketchFileId},fileVisibilityWhere(allowed.visibility)]}});if(!file)return fail('not-found','Файл не найден');
 const invalid=validateProductCoverFile(allowed.product,file);if(invalid)return fail('validation',invalid);if(!await mayDeleteStoredFile(tx,allowed.visibility,file))return fail('forbidden','Недостаточно прав для удаления файла');
 const identity=storage??currentFileDeleteStorageIdentity();
 const cleanup=await persistFileDeleteIntent(tx,actor,file,input.clientMutationId,identity);
 const changed=await tx.product.updateMany({where:{id:input.productId,sketchFileId:input.expectedSketchFileId},data:{sketchFileId:null}});if(changed.count!==1)throw Error('SKETCH_DELETE_CAS_RACE');
 await tx.file.delete({where:{id:file.id}});
 await tx.changeLog.create({data:{actorType:'user',actorId:actor.id,actorName:actor.name??undefined,entity:'product',entityId:input.productId,action:'cover.delete',field:'sketchFileId',oldValue:{sketchFileId:file.id},newValue:{sketchFileId:null}}});
 const result:SketchResult={ok:true,sketchFileId:null,clientMutationId:input.clientMutationId,cleanupEventId:cleanup.eventId};
 await receipt(tx,actor,input.productId,input.clientMutationId,'cover.delete.receipt',fingerprint,result);return result;
}
/** Legacy callers must supply a real empty baseline/UUID; no gallery replacement bypass. */
export async function setProductCoverCore(tx:Tx,actor:CoverMutationActor,productId:string,fileId:string,baseline?:{expectedSketchFileId:null;clientMutationId:string}):Promise<SketchResult>{if(!baseline)return fail('validation','Обновите карточку: требуется исходный эскиз');return bindProductSketchCore(tx,actor,{productId,fileId,...baseline});}
