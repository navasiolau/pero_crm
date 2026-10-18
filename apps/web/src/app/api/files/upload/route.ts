import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { auth } from "@/auth";
import {canAccessOperationalPath} from "@/lib/operational-access";
import {ASSIGNEE_ROLES,hasAnyRole} from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { UPLOADS_ROOT, s3Enabled, s3Put, s3Delete, fileKey, thumbKey } from "@/lib/s3";
import { type SketchResult } from "@/server/products/sketch-contract";
import { persistUploadedProductCover } from "@/server/products/cover-core";
import { cleanupObsoleteSketch } from "@/server/products/sketch-cleanup";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { resolveUploadContext } from "@/server/files/upload-context";
import { persistOrdinaryUpload, readUploadReceipt, uploadFingerprint } from "@/server/files/upload-core";
import { afterUploadCommit, uploadFailure, UploadError, type UploadPhase, type CommitState } from "@/server/files/upload-result";
import { notifyOrg } from "@/server/notifications/notify";
import { withTaskTransaction } from "@/server/tasks/transaction";
import {persistProjectCoverUpload} from "@/server/projects/cover-core";
import {revalidatePath} from "next/cache";
import {UPLOAD_CONTEXT_HEADER,parseUploadContextHeader,matchesDeclaredUploadContext} from "@/lib/upload-request-context";
import {parseUploadTarget,authorizeUploadTarget,rejectFileUploadField} from "@/server/files/upload-target";
import {spoolMultipartUpload} from "@/server/files/multipart-upload";
import {publishUploadOriginal,knownStorageRejection} from "@/server/files/upload-storage";
function sanitizeFileName(name: string): string {
  return name.replace(/[^\wа-яА-ЯёЁ.-]+/g, "_").slice(-80);
}

async function committedSketchReply(result:Extract<SketchResult,{ok:true}>,productId:string,requestId:string){
  await afterUploadCommit(()=>revalidateProductPaths(productId),requestId);
  if(result.cleanupEventId&&!await cleanupObsoleteSketch(result.cleanupEventId))
    throw new UploadError("SKETCH_CLEANUP_PENDING",503,"confirmation",
      "Новый эскиз сохранён. Удаление прежнего эскиза не завершено; повторите тот же запрос.","failure","committed");
  const current=await withTaskTransaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${productId} FOR UPDATE`;
    const product=await tx.product.findUnique({where:{id:productId},select:{sketchFileId:true}});
    if(!product||product.sketchFileId!==result.id)return{sketch:null,currentSketchFileId:product?.sketchFileId??null};
    const sketch=await tx.file.findUnique({where:{id:result.id},select:{id:true,fileName:true,mimeType:true,size:true,hasThumb:true,section:true,uploadedById:true}});
    return{sketch,currentSketchFileId:product.sketchFileId};
  });
  if(!current.sketch)return NextResponse.json({ok:false,kind:"conflict",error:"Эскиз уже изменён другим пользователем",currentSketchFileId:current.currentSketchFileId},{status:409});
  const {cleanupEventId:_cleanup,...ack}=result;void _cleanup;
  return NextResponse.json({...ack,sketch:current.sketch});
}

type UploadTransaction=Parameters<Parameters<typeof withTaskTransaction>[0]>[0];
type UploadActor=Parameters<typeof persistUploadedProductCover>[1];
async function currentUploadActor(expectedId:string,signal:AbortSignal):Promise<UploadActor>{
  if(signal.aborted)throw new UploadError("UPLOAD_ABORTED",400,"context","Загрузка прервана","validation");
  const session=await auth();
  if(!session?.user||session.user.id!==expectedId||!canAccessOperationalPath(session.user.roles,"/api/files/upload")||!hasAnyRole(session.user.roles,ASSIGNEE_ROLES))
    throw new UploadError("UPLOAD_CONTEXT_CHANGED",409,"context","Права или состояние пользователя изменились. Обновите карточку.","conflict");
  return session.user;
}

// POST /api/files/upload — multipart/form-data:
// file, projectId, productId?, section?, taskId?
export async function POST(request: Request) {
  const requestId=randomUUID();
  const state:{phase:UploadPhase;commitState:CommitState}={phase:"auth",commitState:"notCommitted"};
  try {
    const response=await upload(request,state,requestId);
    const data=await response.json();
    if(!response.ok){
      const message=typeof data.error==="string"?data.error:"Не удалось загрузить файл";
      return NextResponse.json({...data,ok:false,kind:data.kind??(response.status<500?"validation":"failure"),
        code:data.code??`UPLOAD_HTTP_${response.status}`,requestId,
        details:data.details??{phase:state.phase,message},commitState:data.commitState??state.commitState},
        {status:response.status,headers:{"x-request-id":requestId}});
    }
    return NextResponse.json({...data,requestId},{status:response.status,headers:{"x-request-id":requestId}});
  } catch(error) {
    const failure=uploadFailure(requestId,state.phase,error,state.commitState);
    console.warn(JSON.stringify({event:"file.upload.failed",requestId,code:failure.body.code,phase:failure.body.details.phase,commitState:failure.body.commitState}));
    return NextResponse.json(failure.body,{status:failure.status,headers:{"x-request-id":requestId}});
  }
}

async function upload(request:Request,state:{phase:UploadPhase;commitState:CommitState},requestId:string){
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  // This endpoint avoids the framework's Node middleware body-cloning race.
  // auth() still refreshes active/sessionVersion/roles; both broad operational
  // isolation and narrower context permissions remain server-side.
  if(!canAccessOperationalPath(session.user.roles,"/api/files/upload")||!hasAnyRole(session.user.roles,ASSIGNEE_ROLES))
    throw new UploadError("UPLOAD_FORBIDDEN",403,"auth","Недостаточно прав для загрузки файлов","forbidden");

  state.phase="request";
  const declared=parseUploadContextHeader(request.headers.get(UPLOAD_CONTEXT_HEADER));
  if(declared===false)throw new UploadError("UPLOAD_CONTEXT_INVALID",400,"request","Неверный контекст загрузки","validation");
  if(declared){
    const parsed=parseUploadTarget(declared);
    if(!parsed.ok)return NextResponse.json(parsed.body,{status:parsed.status});
    state.phase="context";
    const permission=await authorizeUploadTarget(prisma,session.user,parsed.target);
    if(!permission.ok)return NextResponse.json(permission.body,{status:permission.status});
  }
  state.phase="request";
  const multipart=await spoolMultipartUpload(request,{onFileField:rejectFileUploadField});
  try{
  const file=multipart.file;
  if(declared&&!matchesDeclaredUploadContext(declared,multipart.fields))throw new UploadError("UPLOAD_CONTEXT_MISMATCH",422,"context","Контекст файла не совпадает с объявленной загрузкой","validation");
  const parsed=parseUploadTarget(multipart.fields,file.type);
  if(!parsed.ok)return NextResponse.json(parsed.body,{status:parsed.status});
  const target=parsed.target;
  state.phase="context";
  const actor=await currentUploadActor(session.user.id,request.signal);
  const permission=await authorizeUploadTarget(prisma,actor,target);
  if(!permission.ok)return NextResponse.json(permission.body,{status:permission.status});
  const {projectId,requestedProductId,taskId,section,clientMutationId,coverTarget,projectCoverTarget}=target;
  const {project,productId}=permission.context;
  const {replayCover,replayProjectCover}=permission;
  const assignCover=target.mode==="sketch",assignProjectCover=target.mode==="project-cover";
  const transaction=<T>(work:(tx:UploadTransaction,actor:UploadActor)=>Promise<T>)=>withTaskTransaction(async tx=>work(tx,await currentUploadActor(actor.id,request.signal)));
  state.phase="validation";
  const useS3=s3Enabled();

  const storedName = `${randomUUID()}-${sanitizeFileName(file.name)}`;

  const contentHash = file.contentHash;
  const fingerprint=uploadFingerprint({actorId:actor.id,projectId,productId,taskId,section,
    fileName:file.name,mimeType:file.type,size:file.size,contentHash});
  if(!assignCover&&!assignProjectCover){
    const prior=await readUploadReceipt(prisma,actor.id,clientMutationId,fingerprint);
    if(prior)return NextResponse.json({ok:true,...prior});
  }
  if(assignProjectCover&&replayProjectCover&&projectCoverTarget){
    const result=await transaction((tx,freshActor)=>persistProjectCoverUpload(tx,freshActor,projectCoverTarget!,{fileName:file.name,storedName,mimeType:file.type,size:file.size,hasThumb:false,contentHash}));
    if(!result.ok)return NextResponse.json(result,{status:result.kind==="conflict"?409:422});
    state.commitState="committed";
    const cover=await prisma.file.findUnique({where:{id:result.id},select:{id:true,fileName:true,mimeType:true,hasThumb:true}});
    if(!cover)return NextResponse.json({error:"Обложка этого запроса уже удалена",kind:"conflict"},{status:409});
    return NextResponse.json({...result,cover});
  }
  if (assignCover && replayCover && coverTarget) {
    const result = await transaction((tx,freshActor) => persistUploadedProductCover(tx,freshActor,coverTarget!,{
      fileName:file.name,storedName,mimeType:file.type,size:file.size,hasThumb:false,uploadedById:actor.id,contentHash}));
    if (!result.ok) return NextResponse.json(result,{status:result.kind==="conflict"?409:422});
    state.commitState="committed";state.phase="confirmation";
    return await committedSketchReply(result,coverTarget.productId,requestId);
  }
  // Превью для изображений
  let hasThumb = false;
  let thumbBuffer: Buffer | null = null;
  if (file.type.startsWith("image/")) {
    state.phase="image";
    try {
      const image = sharp(await file.imageBuffer());
      thumbBuffer = await (assignCover||assignProjectCover ? image.rotate() : image)
        .resize(480, 480, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      hasThumb = true;
    } catch {
      if (assignCover||assignProjectCover) {
        return NextResponse.json({ error: "Не удалось прочитать изображение обложки" }, { status: 422 });
      }
      hasThumb = false; // битая картинка — отдадим оригинал
    }
  }

  const compensateOwnCover = async () => {
    try {
      if(useS3){await s3Delete(fileKey(projectId,storedName));if(thumbBuffer)await s3Delete(thumbKey(projectId,storedName));}
      else {await unlink(path.join(UPLOADS_ROOT,projectId,storedName));if(thumbBuffer)await unlink(path.join(UPLOADS_ROOT,projectId,"thumbs",storedName+".jpg"));}
    }catch{console.warn(JSON.stringify({event:"file.upload.compensation_failed",requestId,phase:state.phase}));}
  };
  try {
  state.phase="storage-original";
  if (useS3) {
    // S3 (MinIO) — основное хранилище (§13)
    await publishUploadOriginal(file,{projectId,storedName,useS3,signal:request.signal});
    if (thumbBuffer) {
      state.phase="storage-thumb";
      await s3Put(thumbKey(projectId, storedName), thumbBuffer, "image/jpeg");
    }
  } else {
    // Локальный фолбэк (dev без S3)
    const projectDir = path.join(UPLOADS_ROOT, projectId);
    await publishUploadOriginal(file,{projectId,storedName,useS3,signal:request.signal});
    if (thumbBuffer) {
      state.phase="storage-thumb";
      const thumbDir = path.join(projectDir, "thumbs");
      await mkdir(thumbDir, { recursive: true });
      await writeFile(path.join(thumbDir, `${storedName}.jpg`), thumbBuffer);
    }
  }

  } catch (error) {
    if(knownStorageRejection(error)){await compensateOwnCover();throw error;}
    state.commitState="unknown";
    const failure=uploadFailure(requestId,state.phase,error,"unknown");
    throw new UploadError(failure.body.code,failure.status,state.phase,failure.body.error,"failure","unknown");
  }

  state.phase="persist";
  state.commitState="unknown";
  if(assignProjectCover&&projectCoverTarget){
    let callbackCompleted=false;
    let result:Awaited<ReturnType<typeof persistProjectCoverUpload>>;
    try{result=await transaction(async(tx,freshActor)=>{const saved=await persistProjectCoverUpload(tx,freshActor,projectCoverTarget!,{fileName:file.name,storedName,mimeType:file.type,size:file.size,hasThumb,contentHash});callbackCompleted=true;return saved;});}
    catch(error){if(!callbackCompleted){state.commitState="notCommitted";await compensateOwnCover();}throw error;}
    if(!result.ok){state.commitState="notCommitted";await compensateOwnCover();return NextResponse.json(result,{status:result.kind==="conflict"?409:404});}
    if(result.repeated)await compensateOwnCover();
    state.commitState="committed";state.phase="confirmation";
    await afterUploadCommit(async()=>{revalidatePath(`/projects/${projectId}`);},requestId);
    if(!result.repeated)await afterUploadCommit(()=>notifyOrg({type:"file.added",title:`Обложка проекта ${project.number}`,body:file.name,link:`/projects/${projectId}`,exceptUserId:actor.id}),requestId);
    const cover=await prisma.file.findUnique({where:{id:result.id},select:{id:true,fileName:true,mimeType:true,hasThumb:true}});
    return NextResponse.json({...result,cover});
  }
  if (assignCover && requestedProductId) {
    let result: Awaited<ReturnType<typeof persistUploadedProductCover>>;
    let callbackCompleted=false;
    try {
      result = await transaction(async(tx,freshActor) => {const saved=await persistUploadedProductCover(tx, freshActor,
        coverTarget!, {
          fileName: file.name, storedName, mimeType: file.type, size: file.size,
          hasThumb, uploadedById: actor.id, contentHash,
        });callbackCompleted=true;return saved;});
    } catch {
      if(!callbackCompleted){state.commitState="notCommitted";await compensateOwnCover();}
      return NextResponse.json({ error: "Не удалось сохранить обложку" }, { status: 500 });
    }
    if (!result.ok) { state.commitState="notCommitted";await compensateOwnCover(); return NextResponse.json(result, {status:result.kind==="conflict"?409:404}); }
    if(result.repeated)await compensateOwnCover();
    state.commitState="committed";
    state.phase="confirmation";
    if(!result.repeated)await afterUploadCommit(()=>notifyOrg({
      type: "file.added", title: `Файл к проекту ${project.number}`,
      body: file.name, link: productId ? `/products/${encodeURIComponent(productId)}` : `/projects/${projectId}`,
      exceptUserId: actor.id,
    }),requestId);
    return await committedSketchReply(result,requestedProductId,requestId);
  }

  let receipt:Awaited<ReturnType<typeof persistOrdinaryUpload>>;
  let callbackCompleted=false;
  try {
  receipt=await transaction(async(tx,freshActor)=>{
    // Recheck current ACL inside the transaction; it may change during storage.
    const current=await resolveUploadContext(tx,freshActor,{projectId,productId:requestedProductId,taskId});
    if(!current||current.productId!==productId)throw new UploadError("UPLOAD_CONTEXT_CHANGED",409,"persist","Права или состояние изделия изменились. Обновите карточку.","conflict");
    const saved=await persistOrdinaryUpload(tx,freshActor,{clientMutationId,fingerprint,projectNumber:project.number,data:{
      projectId,
      productId,
      taskId,
      section,
      fileName: file.name,
      storedName,
      mimeType: file.type,
      size: file.size,
      hasThumb,
      uploadedById: actor.id,
    }});
    callbackCompleted=true;return saved;
  });
  }catch(error){if(!callbackCompleted){state.commitState="notCommitted";await compensateOwnCover();}throw error;}
  if(receipt.repeated)await compensateOwnCover();
  state.commitState="committed";
  state.phase="confirmation";
  if(!receipt.repeated)await afterUploadCommit(()=>notifyOrg({
    type: "file.added",
    title: `Файл к проекту ${project.number}`,
    body: file.name,
    link: productId ? `/products/${encodeURIComponent(productId)}` : `/projects/${projectId}`,
    exceptUserId: actor.id,
  }),requestId);

  return NextResponse.json({ok:true,...receipt});
  }finally{await multipart.dispose();}
}
