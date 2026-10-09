import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import type {FileSection} from "@prisma/client";
import {isFileSection} from "@/lib/file-sections";

import { auth } from "@/auth";
import {canAccessOperationalPath} from "@/lib/operational-access";
import {ASSIGNEE_ROLES,hasAnyRole} from "@/lib/roles";
import { isCoverImageMime } from "@/lib/product-cover";
import { prisma } from "@/lib/prisma";
import { UPLOADS_ROOT, s3Enabled, s3Put, s3Delete, fileKey, thumbKey } from "@/lib/s3";
import { sketchUploadTargetSchema, type SketchUploadTarget, type SketchResult } from "@/server/products/sketch-contract";
import { authorizeProductCoverUpload, persistUploadedProductCover } from "@/server/products/cover-core";
import { cleanupObsoleteSketch } from "@/server/products/sketch-cleanup";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { resolveUploadContext } from "@/server/files/upload-context";
import { uploadSizeLimitError, uploadSizeLimitFor } from "@/server/files/upload-limits";
import { persistOrdinaryUpload, readUploadReceipt, uploadFingerprint, uploadMutationPattern } from "@/server/files/upload-core";
import { afterUploadCommit, uploadFailure, UploadError, type UploadPhase, type CommitState } from "@/server/files/upload-result";
import { notifyOrg } from "@/server/notifications/notify";
import { withTaskTransaction } from "@/server/tasks/transaction";
import {projectCoverUploadSchema,type ProjectCoverUpload} from "@/server/projects/cover-contract";
import {authorizeProjectCoverUpload,persistProjectCoverUpload} from "@/server/projects/cover-core";
import {revalidatePath} from "next/cache";
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
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const projectId = form?.get("projectId");
  if (!form || !(file instanceof File) || typeof projectId !== "string") {
    return NextResponse.json({ error: "Нужны file и projectId" }, { status: 400 });
  }
  // Дифференцированный лимит: изображения и обложки — 25 МБ, не-изображения — 1 ГБ.
  // Обложки — всегда image/*, поэтому ранняя проверка по типу содержимого их покрывает.
  const sizeLimit = uploadSizeLimitFor({ mimeType: file.type });
  if (file.size > sizeLimit.maxBytes) {
    return NextResponse.json({ error: uploadSizeLimitError(sizeLimit.kind) }, { status: 413 });
  }

  // Старые окна не должны молча перекладывать файл в неверный раздел.
  if (["category", "stage", "caption"].some(key => form.get(key) !== null)) {
    return NextResponse.json({ok:false,kind:"validation",code:"UPLOAD_FORM_OUTDATED",error:"Обновите форму загрузки: категории, этапы и комментарии файлов больше не используются"},{status:422});
  }
  const sectionRaw = form.get("section");
  if (sectionRaw !== null && !isFileSection(sectionRaw)) {
    return NextResponse.json({error:"Обновите форму: неизвестный раздел файла"},{status:422});
  }
  const section: FileSection = sectionRaw === null ? "GENERAL" : sectionRaw;

  const productIdRaw = form.get("productId");
  const requestedProductId =
    typeof productIdRaw === "string" && productIdRaw ? productIdRaw : null;
  const taskId = typeof form.get("taskId") === "string" && form.get("taskId") ? (form.get("taskId") as string) : null;
  const coverRaw = form.get("assignCover");
  const assignCover = coverRaw === "1";
  if (coverRaw !== null && !assignCover) {
    return NextResponse.json({ error: "Неверный режим загрузки обложки" }, { status: 400 });
  }
  let coverTarget: SketchUploadTarget | undefined;
  let replayCover = false;
  const projectCoverRaw=form.get("assignProjectCover"),assignProjectCover=projectCoverRaw==="1";
  let projectCoverTarget:ProjectCoverUpload|undefined,replayProjectCover=false;
  if(projectCoverRaw!==null){
    if(!assignProjectCover||coverRaw!==null||form.get("productId")!==null||form.get("taskId")!==null||section!=="GENERAL")
      return NextResponse.json({error:"Неверный контекст обложки проекта"},{status:422});
    if(!isCoverImageMime(file.type))return NextResponse.json({error:"Нужно изображение поддерживаемого формата"},{status:415});
    const parsed=projectCoverUploadSchema.safeParse({projectId,expectedCoverFileId:form.get("expectedCoverFileId")==="null"?null:undefined,clientMutationId:form.get("clientMutationId")});
    if(!parsed.success)return NextResponse.json({error:"Обновите форму обложки проекта"},{status:422});
    projectCoverTarget=parsed.data;
    const permission=await authorizeProjectCoverUpload(prisma,session.user,parsed.data);
    if(!permission.ok)return NextResponse.json(permission,{status:permission.kind==="conflict"?409:404});
    replayProjectCover=permission.replayHint;
  }
  if (assignCover) {
    if (!requestedProductId || taskId || section !== "PRODUCTION") {
      return NextResponse.json({ error: "Для эскиза нужны изделие и раздел Производство без задачи" }, { status: 400 });
    }
    if (!isCoverImageMime(file.type)) {
      return NextResponse.json({ error: "Нужно изображение поддерживаемого формата" }, { status: 415 });
    }
    const parsedCover = sketchUploadTargetSchema.safeParse({projectId,productId:requestedProductId,
      expectedSketchFileId:form.get("expectedSketchFileId") === "null" ? null : form.get("expectedSketchFileId") ?? undefined,
      clientMutationId:form.get("clientMutationId")});
    if (!parsedCover.success) return NextResponse.json({ok:false,kind:"validation",error:"Обновите форму эскиза"},{status:422});
    coverTarget = parsedCover.data;
    // The generic task/project upload grant is broader than cover-edit rights.
    // Resolve exact product and role before file.arrayBuffer or storage writes.
    const permission = await authorizeProductCoverUpload(prisma, session.user,
      coverTarget);
    if (!permission.ok) return NextResponse.json(permission, { status: permission.kind === "conflict" ? 409 : 404 });
    replayCover = permission.replayHint;
  }
  state.phase="context";
  const context = await resolveUploadContext(prisma, session.user, { projectId, productId: requestedProductId, taskId });
  if (!context) return NextResponse.json({ error: "Проект, изделие или задача не найдены" }, { status: 404 });
  const { project, productId, productNumber } = context;

  state.phase="validation";
  const clientMutationId=form.get("clientMutationId");
  if(typeof clientMutationId!=="string"||!uploadMutationPattern.test(clientMutationId))
    return NextResponse.json({error:"Обновите форму загрузки",code:"UPLOAD_MUTATION_REQUIRED"},{status:422});
  // Validate the declared target before reading bytes or writing SQL/storage.
  const useS3=s3Enabled();

  const storedName = `${randomUUID()}-${sanitizeFileName(file.name)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > sizeLimit.maxBytes) return NextResponse.json({ error: uploadSizeLimitError(sizeLimit.kind) }, { status: 413 });

  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const fingerprint=uploadFingerprint({actorId:session.user.id,projectId,productId,taskId,section,
    fileName:file.name,mimeType:file.type,size:buffer.length,contentHash});
  if(!assignCover&&!assignProjectCover){
    const prior=await readUploadReceipt(prisma,session.user.id,clientMutationId,fingerprint);
    if(prior)return NextResponse.json({ok:true,...prior});
  }
  if(assignProjectCover&&replayProjectCover&&projectCoverTarget){
    const result=await withTaskTransaction(tx=>persistProjectCoverUpload(tx,session.user,projectCoverTarget!,{fileName:file.name,storedName,mimeType:file.type,size:file.size,hasThumb:false,contentHash}));
    if(!result.ok)return NextResponse.json(result,{status:result.kind==="conflict"?409:422});
    state.commitState="committed";
    const cover=await prisma.file.findUnique({where:{id:result.id},select:{id:true,fileName:true,mimeType:true,hasThumb:true}});
    if(!cover)return NextResponse.json({error:"Обложка этого запроса уже удалена",kind:"conflict"},{status:409});
    return NextResponse.json({...result,cover});
  }
  if (assignCover && replayCover && coverTarget) {
    const result = await withTaskTransaction(tx => persistUploadedProductCover(tx,session.user,coverTarget!,{
      fileName:file.name,storedName,mimeType:file.type,size:file.size,hasThumb:false,uploadedById:session.user.id,contentHash}));
    if (!result.ok) return NextResponse.json(result,{status:result.kind==="conflict"?409:422});
    state.commitState="committed";state.phase="confirmation";
    return committedSketchReply(result,coverTarget.productId,requestId);
  }
  // Превью для изображений
  let hasThumb = false;
  let thumbBuffer: Buffer | null = null;
  if (file.type.startsWith("image/")) {
    state.phase="image";
    try {
      const image = sharp(buffer);
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
    await s3Put(fileKey(projectId, storedName), buffer, file.type || "application/octet-stream");
    if (thumbBuffer) {
      state.phase="storage-thumb";
      await s3Put(thumbKey(projectId, storedName), thumbBuffer, "image/jpeg");
    }
  } else {
    // Локальный фолбэк (dev без S3)
    const projectDir = path.join(UPLOADS_ROOT, projectId);
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, storedName), buffer);
    if (thumbBuffer) {
      state.phase="storage-thumb";
      const thumbDir = path.join(projectDir, "thumbs");
      await mkdir(thumbDir, { recursive: true });
      await writeFile(path.join(thumbDir, `${storedName}.jpg`), thumbBuffer);
    }
  }

  } catch (error) {
    await compensateOwnCover();
    throw error;
  }

  state.phase="persist";
  state.commitState="unknown";
  if(assignProjectCover&&projectCoverTarget){
    let callbackCompleted=false;
    let result:Awaited<ReturnType<typeof persistProjectCoverUpload>>;
    try{result=await withTaskTransaction(async tx=>{const saved=await persistProjectCoverUpload(tx,session.user,projectCoverTarget!,{fileName:file.name,storedName,mimeType:file.type,size:file.size,hasThumb,contentHash});callbackCompleted=true;return saved;});}
    catch(error){if(!callbackCompleted){state.commitState="notCommitted";await compensateOwnCover();}throw error;}
    if(!result.ok){state.commitState="notCommitted";await compensateOwnCover();return NextResponse.json(result,{status:result.kind==="conflict"?409:404});}
    if(result.repeated)await compensateOwnCover();
    state.commitState="committed";state.phase="confirmation";
    await afterUploadCommit(async()=>{revalidatePath(`/projects/${projectId}`);},requestId);
    if(!result.repeated)await afterUploadCommit(()=>notifyOrg({type:"file.added",title:`Обложка проекта ${project.number}`,body:file.name,link:`/projects/${projectId}`,exceptUserId:session.user.id}),requestId);
    const cover=await prisma.file.findUnique({where:{id:result.id},select:{id:true,fileName:true,mimeType:true,hasThumb:true}});
    return NextResponse.json({...result,cover});
  }
  if (assignCover && requestedProductId) {
    let result: Awaited<ReturnType<typeof persistUploadedProductCover>>;
    let callbackCompleted=false;
    try {
      result = await withTaskTransaction(async(tx) => {const saved=await persistUploadedProductCover(tx, session.user,
        coverTarget!, {
          fileName: file.name, storedName, mimeType: file.type, size: file.size,
          hasThumb, uploadedById: session.user.id, contentHash,
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
      body: file.name, link: productNumber ? `/products/${productNumber}` : `/projects/${projectId}`,
      exceptUserId: session.user.id,
    }),requestId);
    return committedSketchReply(result,requestedProductId,requestId);
  }

  let receipt:Awaited<ReturnType<typeof persistOrdinaryUpload>>;
  let callbackCompleted=false;
  try {
  receipt=await withTaskTransaction(async tx=>{
    // Recheck current ACL inside the transaction; it may change during storage.
    const current=await resolveUploadContext(tx,session.user,{projectId,productId:requestedProductId,taskId});
    if(!current||current.productId!==productId)throw new UploadError("UPLOAD_CONTEXT_CHANGED",409,"persist","Права или состояние изделия изменились. Обновите карточку.","conflict");
    const saved=await persistOrdinaryUpload(tx,session.user,{clientMutationId,fingerprint,projectNumber:project.number,data:{
      projectId,
      productId,
      taskId,
      section,
      fileName: file.name,
      storedName,
      mimeType: file.type,
      size: file.size,
      hasThumb,
      uploadedById: session.user.id,
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
    link: productNumber ? `/products/${productNumber}` : `/projects/${projectId}`,
    exceptUserId: session.user.id,
  }),requestId);

  return NextResponse.json({ok:true,...receipt});
}
