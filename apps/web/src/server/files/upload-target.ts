import {isFileSection} from "@/lib/file-sections";
import {isCoverImageMime} from "@/lib/product-cover";
import {sketchUploadTargetSchema,type SketchUploadTarget} from "@/server/products/sketch-contract";
import {authorizeProductCoverUpload} from "@/server/products/cover-core";
import {projectCoverUploadSchema,type ProjectCoverUpload} from "@/server/projects/cover-contract";
import {authorizeProjectCoverUpload} from "@/server/projects/cover-core";
import {resolveUploadContext} from "./upload-context";
import {uploadMutationPattern} from "./upload-core";
import {UploadError} from "./upload-result";
import type {UploadRequestFields} from "@/lib/upload-request-context";
type Database=Parameters<typeof authorizeProductCoverUpload>[0];
type Actor=Parameters<typeof authorizeProductCoverUpload>[1];
type Failure={ok:false;status:number;body:Record<string,unknown>};
export type UploadTarget={projectId:string;requestedProductId:string|null;taskId:string|null;section:"GENERAL"|"MEASUREMENT"|"PRODUCTION"|"INSTALLATION";clientMutationId:string;mode:"ordinary"|"sketch"|"project-cover";coverTarget?:SketchUploadTarget;projectCoverTarget?:ProjectCoverUpload};
const failure=(status:number,body:Record<string,unknown>):Failure=>({ok:false,status,body});
const obsolete=()=>failure(422,{ok:false,kind:"validation",code:"UPLOAD_FORM_OUTDATED",error:"Обновите форму загрузки: категории, этапы и комментарии файлов больше не используются"});
/** Одна проверка метаданных для early declaration, late multipart и текущей финализации. */
export function parseUploadTarget(fields:UploadRequestFields,mimeType?:string):{ok:true;target:UploadTarget}|Failure {
 if(typeof fields.projectId!=="string")return failure(400,{error:"Нужны file и projectId"});
 if(["category","stage","caption"].some(key=>Object.hasOwn(fields,key)))return obsolete();
 if(Object.hasOwn(fields,"section")&&!isFileSection(fields.section))return failure(422,{error:"Обновите форму: неизвестный раздел файла"});
 const section=fields.section===undefined?"GENERAL":fields.section as UploadTarget["section"];
 const target:UploadTarget={projectId:fields.projectId,requestedProductId:fields.productId||null,taskId:fields.taskId||null,section,clientMutationId:fields.clientMutationId??"",mode:"ordinary"};
 const coverPresent=Object.hasOwn(fields,"assignCover"),projectCoverPresent=Object.hasOwn(fields,"assignProjectCover");
 if(coverPresent&&fields.assignCover!=="1")return failure(400,{error:"Неверный режим загрузки обложки"});
 if(projectCoverPresent){
  if(fields.assignProjectCover!=="1"||coverPresent||Object.hasOwn(fields,"productId")||Object.hasOwn(fields,"taskId")||section!=="GENERAL")return failure(422,{error:"Неверный контекст обложки проекта"});
  if(mimeType!==undefined&&!isCoverImageMime(mimeType))return failure(415,{error:"Нужно изображение поддерживаемого формата"});
  const parsed=projectCoverUploadSchema.safeParse({projectId:target.projectId,expectedCoverFileId:fields.expectedCoverFileId==="null"?null:undefined,clientMutationId:fields.clientMutationId});
  if(!parsed.success)return failure(422,{error:"Обновите форму обложки проекта"});
  target.mode="project-cover";target.projectCoverTarget=parsed.data;
 }
 if(coverPresent){
  if(!target.requestedProductId||target.taskId||section!=="PRODUCTION")return failure(400,{error:"Для эскиза нужны изделие и раздел Производство без задачи"});
  if(mimeType!==undefined&&!isCoverImageMime(mimeType))return failure(415,{error:"Нужно изображение поддерживаемого формата"});
  const parsed=sketchUploadTargetSchema.safeParse({projectId:target.projectId,productId:target.requestedProductId,expectedSketchFileId:fields.expectedSketchFileId==="null"?null:fields.expectedSketchFileId??undefined,clientMutationId:fields.clientMutationId});
  if(!parsed.success)return failure(422,{ok:false,kind:"validation",error:"Обновите форму эскиза"});
  target.mode="sketch";target.coverTarget=parsed.data;
 }
 return {ok:true,target};
}
export async function authorizeUploadTarget(db:Database,actor:Actor,target:UploadTarget){
 let replayCover=false,replayProjectCover=false;
 if(target.projectCoverTarget){
  const permission=await authorizeProjectCoverUpload(db,actor,target.projectCoverTarget);
  if(!permission.ok)return failure(permission.kind==="conflict"?409:404,permission);
  replayProjectCover=permission.replayHint;
 }
 if(target.coverTarget){
  const permission=await authorizeProductCoverUpload(db,actor,target.coverTarget);
  if(!permission.ok)return failure(permission.kind==="conflict"?409:404,permission);
  replayCover=permission.replayHint;
 }
 const context=await resolveUploadContext(db,actor,{projectId:target.projectId,productId:target.requestedProductId,taskId:target.taskId});
 if(!context)return failure(404,{error:"Проект, изделие или задача не найдены"});
 if(!uploadMutationPattern.test(target.clientMutationId))return failure(422,{error:"Обновите форму загрузки",code:"UPLOAD_MUTATION_REQUIRED"});
 return {ok:true as const,context,replayCover,replayProjectCover};
}
/** File в текстовом поле сохраняет прежний отказ формы; чужую вторую загрузку не принимаем. */
export function rejectFileUploadField(name:string):never{
 if(["category","stage","caption"].includes(name))throw new UploadError("UPLOAD_FORM_OUTDATED",422,"request",obsolete().body.error as string,"validation");
 if(name==="section")throw new UploadError("UPLOAD_HTTP_422",422,"request","Обновите форму: неизвестный раздел файла","validation");
 if(name==="projectId")throw new UploadError("UPLOAD_HTTP_400",400,"request","Нужны file и projectId","validation");
 if(name==="assignCover")throw new UploadError("UPLOAD_HTTP_400",400,"request","Неверный режим загрузки обложки","validation");
 throw new UploadError("UPLOAD_HTTP_422",422,"request","Обновите форму загрузки: поле должно быть текстом","validation");
}
