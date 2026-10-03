"use server";
import { auth } from "@/auth";
import { cleanupCatalogueAsset } from "@/server/catalogue-media/service";
import { patchProductFinishCore } from "./core";
import type { ProductFinishCommand, ProductFinishResult } from "./contracts";
export async function patchProductFinishAction(input:ProductFinishCommand):Promise<ProductFinishResult>{const session=await auth();if(!session?.user)return{kind:"forbidden",error:"Не авторизован"};const result=await patchProductFinishCore({id:session.user.id,name:session.user.name??"",roles:session.user.roles,source:"web"},input);if(result.kind==="saved"&&result.retiredSampleAssetId&&result.retiredSampleFinishId)await cleanupCatalogueAsset(result.retiredSampleFinishId,result.retiredSampleAssetId);return result;}
