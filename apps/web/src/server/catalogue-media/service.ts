import type {DomainActor} from "../projects/core";
import {createHash} from "node:crypto";
import {withTaskTransaction,type TaskTransaction} from "../tasks/transaction";
import {UploadError} from "../files/upload-result";
import {catalogueMediaKey} from "@/lib/catalogue-media-url";
import {catalogueStorage,type CatalogueStorage} from "./storage";
import {authorizeSampleUpload,persistSampleUpload,deleteSampleCore,resolveSampleReceipt,retainedCleanupTarget,sampleFingerprint} from "./core";
import type {SampleTarget,SampleAssetInput,SampleResult} from "./contracts";
export async function cleanupCatalogueAsset(finishId:string,assetId:string,transaction:TaskTransaction=withTaskTransaction,storage:CatalogueStorage=catalogueStorage){
 try{return await transaction(async tx=>{const target=await retainedCleanupTarget(tx,finishId,assetId);if(target.kind!=="cleanup")return{cleanupPending:false,retained:target.kind==="retained"};await storage.remove(target.asset.storageKey,AbortSignal.timeout(8000));await tx.catalogueMediaAsset.updateMany({where:{id:assetId,finishId,deletedAt:null},data:{deletedAt:new Date()}});return{cleanupPending:false,retained:false};});}catch{return{cleanupPending:true,retained:false};}
}
export async function uploadCatalogueSample(actor:DomainActor,target:SampleTarget,asset:SampleAssetInput,bytes:Buffer,{transaction=withTaskTransaction,storage=catalogueStorage}:{transaction?:TaskTransaction;storage?:CatalogueStorage}={}):Promise<SampleResult>{
 if(bytes.length!==asset.size||createHash("sha256").update(bytes).digest("hex")!==asset.originalHash)throw new UploadError("CATALOGUE_SAMPLE_BYTES_INVALID",422,"validation","Метаданные не соответствуют исходному файлу");
 const fingerprint=sampleFingerprint(actor.id,target,"upload",asset),prior=await transaction(tx=>authorizeSampleUpload(tx,actor,target,fingerprint));
 if(prior)return{...prior,...(prior.cleanupAssetId?await cleanupCatalogueAsset(target.finishId,prior.cleanupAssetId,transaction,storage):{})};
 await storage.put(target.finishId,target.clientMutationId,bytes,asset.mimeType);
 let result:SampleResult;
 try{result=await transaction(tx=>persistSampleUpload(tx,actor,target,asset,fingerprint));}catch(error){
  try{const resolved=await transaction(tx=>resolveSampleReceipt(tx,actor,target,fingerprint));if(resolved)result=resolved;else{
   // Без receipt не угадываем судьбу original: параллельный retry ещё может завершить bind.
   throw error;
  }}catch(resolution){if(resolution===error||resolution instanceof UploadError)throw resolution;throw new UploadError("CATALOGUE_SAMPLE_COMMIT_UNKNOWN",503,"confirmation","Не удалось подтвердить сохранение. Повторите тот же запрос","failure","unknown");}
 }
 return{...result,...(result.cleanupAssetId?await cleanupCatalogueAsset(target.finishId,result.cleanupAssetId,transaction,storage):{})};
}
export async function deleteCatalogueSample(actor:DomainActor,target:SampleTarget,{transaction=withTaskTransaction,storage=catalogueStorage}:{transaction?:TaskTransaction;storage?:CatalogueStorage}={}):Promise<SampleResult>{const fingerprint=sampleFingerprint(actor.id,target,"delete");let result:SampleResult;try{result=await transaction(tx=>deleteSampleCore(tx,actor,target,fingerprint));}catch(error){try{const resolved=await transaction(tx=>resolveSampleReceipt(tx,actor,target,fingerprint));if(resolved)result=resolved;else throw error;}catch(resolution){if(resolution===error||resolution instanceof UploadError)throw resolution;throw new UploadError("CATALOGUE_SAMPLE_COMMIT_UNKNOWN",503,"confirmation","Не удалось подтвердить удаление. Повторите тот же запрос","failure","unknown");}}return{...result,...(result.cleanupAssetId?await cleanupCatalogueAsset(target.finishId,result.cleanupAssetId,transaction,storage):{})};}
export async function readCatalogueOriginal(asset:{finishId:string;id:string;storageKey:string;originalHash:string;size:number},storage:CatalogueStorage=catalogueStorage){if(asset.storageKey!==catalogueMediaKey(asset.finishId,asset.id)||asset.size>25*1024*1024)throw Error("CATALOGUE_MEDIA_SCOPE_INVALID");const bytes=await storage.read(asset.storageKey,25*1024*1024);if(!bytes)return null;if(bytes.length!==asset.size||createHash("sha256").update(bytes).digest("hex")!==asset.originalHash)throw Error("CATALOGUE_MEDIA_HASH_MISMATCH");return bytes;}
