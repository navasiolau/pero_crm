import {randomUUID,createHash} from "node:crypto";
import {NextResponse} from "next/server";
import sharp from "sharp";
import {auth} from "@/auth";
import {canManageFinishCatalog} from "@/lib/finish-catalog-access";
import {sampleTargetSchema,sampleAssetSchema} from "@/server/catalogue-media/contracts";
import {uploadCatalogueSample} from "@/server/catalogue-media/service";
import {uploadFailure,UploadError,type UploadPhase} from "@/server/files/upload-result";
const MIME:Record<string,string>={png:"image/png",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif",heif:"image/avif",avif:"image/avif"};
export async function POST(request:Request){const requestId=randomUUID();let phase:UploadPhase="auth",clientMutationId:string|undefined;
 try{const session=await auth();if(!session?.user)throw new UploadError("CATALOGUE_AUTH_REQUIRED",401,"auth","Не авторизован");if(!canManageFinishCatalog(session.user.roles))throw new UploadError("CATALOGUE_SAMPLE_FORBIDDEN",403,"auth","Недостаточно прав");
  phase="request";const length=Number(request.headers.get("content-length")??0);if(length>26*1024*1024)throw new UploadError("CATALOGUE_SAMPLE_TOO_LARGE",413,phase,"Изображение больше 25 МБ");const form=await request.formData();for(const key of form.keys())if(!["file","finishId","expectedSampleAssetId","expectedRevision","clientMutationId"].includes(key)||form.getAll(key).length!==1)throw new UploadError("CATALOGUE_SAMPLE_CONTEXT",422,"context","Неверная область образца");
  const parsed=sampleTargetSchema.safeParse({finishId:form.get("finishId"),expectedSampleAssetId:typeof form.get("expectedSampleAssetId")==="string"?(form.get("expectedSampleAssetId")==="null"?null:form.get("expectedSampleAssetId")):undefined,expectedRevision:typeof form.get("expectedRevision")==="string"&&/^(0|[1-9]\d*)$/.test(String(form.get("expectedRevision")))?Number(form.get("expectedRevision")):undefined,clientMutationId:form.get("clientMutationId")});if(!parsed.success)throw new UploadError("CATALOGUE_SAMPLE_CONTEXT",422,"context","Обновите форму образца");clientMutationId=parsed.data.clientMutationId;
  phase="validation";const file=form.get("file");if(!(file instanceof File)||file.size<1||file.size>25*1024*1024)throw new UploadError("CATALOGUE_SAMPLE_SIZE",413,phase,"Нужно изображение до 25 МБ");const bytes=Buffer.from(await file.arrayBuffer());phase="image";let meta;try{meta=await sharp(bytes,{limitInputPixels:64_000_000,failOn:"error"}).metadata();}catch{throw new UploadError("CATALOGUE_SAMPLE_IMAGE",422,phase,"Не удалось прочитать изображение");}const mimeType=MIME[meta.format??""];if(!mimeType||meta.format==="heif"&&meta.compression!=="av1")throw new UploadError("CATALOGUE_SAMPLE_TYPE",415,phase,"Поддерживаются PNG, JPEG, WebP, AVIF и GIF");
  const fileName=file.name.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f]/g," ").trim().slice(0,255)||"sample";const asset=sampleAssetSchema.parse({fileName,mimeType,size:bytes.length,originalHash:createHash("sha256").update(bytes).digest("hex")});phase="storage-original";
  const result=await uploadCatalogueSample({id:session.user.id,name:session.user.name??"",roles:session.user.roles,source:"web"},parsed.data,asset,bytes);const{cleanupAssetId:_candidate,...safe}=result;void _candidate;return NextResponse.json({...safe,requestId},{headers:{"x-request-id":requestId,"Cache-Control":"private, no-store"}});
 }catch(error){const failure=uploadFailure(requestId,phase,error);return NextResponse.json({...failure.body,clientMutationId},{status:failure.status,headers:{"x-request-id":requestId,"Cache-Control":"private, no-store"}});}
}
