import {z} from "zod";
import type {CatalogueMediaAsset} from "@prisma/client";
export const sampleTargetSchema=z.object({finishId:z.uuid().transform(value=>value.toLowerCase()),expectedSampleAssetId:z.uuid().transform(value=>value.toLowerCase()).nullable(),expectedRevision:z.number().int().min(0).max(2147483646),clientMutationId:z.uuid().refine(value=>value===value.toLowerCase(),"Нужен канонический UUID запроса")}).strict();
export const sampleDeleteSchema=sampleTargetSchema.extend({expectedSampleAssetId:z.uuid().transform(value=>value.toLowerCase())});
export type SampleTarget=z.infer<typeof sampleTargetSchema>;
export type CatalogueSampleView=Pick<CatalogueMediaAsset,"id"|"fileName"|"mimeType"|"size">;
export function sampleView(asset:CatalogueMediaAsset|null|undefined):CatalogueSampleView|null{return asset&&!asset.deletedAt?{id:asset.id,fileName:asset.fileName,mimeType:asset.mimeType,size:asset.size}:null;}
export type SampleResult={ok:true;id:string;finishId:string;sampleAssetId:string|null;finishRevision:number;asset:CatalogueSampleView|null;clientMutationId:string;repeated?:boolean;cleanupAssetId?:string;cleanupPending?:boolean;retained?:boolean};
export const sampleAssetSchema=z.object({fileName:z.string().min(1).max(255),mimeType:z.enum(["image/png","image/jpeg","image/webp","image/avif","image/gif"]),size:z.number().int().min(1).max(25*1024*1024),originalHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type SampleAssetInput=z.infer<typeof sampleAssetSchema>;
