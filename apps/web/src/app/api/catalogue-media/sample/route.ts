import {randomUUID} from "node:crypto";
import {NextResponse} from "next/server";
import {auth} from "@/auth";
import {sampleDeleteSchema} from "@/server/catalogue-media/contracts";
import {deleteCatalogueSample} from "@/server/catalogue-media/service";
import {UploadError,uploadFailure} from "@/server/files/upload-result";
export async function DELETE(request:Request){const requestId=randomUUID();let clientMutationId:string|undefined;try{const session=await auth();if(!session?.user)throw new UploadError("CATALOGUE_AUTH_REQUIRED",401,"auth","Не авторизован");const parsed=sampleDeleteSchema.safeParse(await request.json());if(!parsed.success)throw new UploadError("CATALOGUE_SAMPLE_CONTEXT",422,"context","Обновите форму образца");clientMutationId=parsed.data.clientMutationId;const result=await deleteCatalogueSample({id:session.user.id,name:session.user.name??"",roles:session.user.roles,source:"web"},parsed.data);const{cleanupAssetId:_candidate,...safe}=result;void _candidate;return NextResponse.json({...safe,requestId},{headers:{"x-request-id":requestId,"Cache-Control":"private, no-store"}});}catch(error){const failure=uploadFailure(requestId,"persist",error);return NextResponse.json({...failure.body,clientMutationId},{status:failure.status,headers:{"x-request-id":requestId,"Cache-Control":"private, no-store"}});}}
