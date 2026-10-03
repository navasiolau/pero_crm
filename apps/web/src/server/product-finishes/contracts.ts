import { z } from "zod";
import type { CatalogueMediaAsset, ProductFinishAssignment } from "@prisma/client";
const base={productId:z.string().min(1),expectedRevision:z.number().int().min(0).max(2147483646),clientMutationId:z.uuid()};
export const elementSchema=z.string().trim().min(1,"Укажите элемент").max(100,"Не больше 100 символов");
export const productFinishCommandSchema=z.discriminatedUnion("op",[
 z.object({...base,op:z.literal("add"),element:elementSchema,finishId:z.uuid()}).strict(),
 z.object({...base,op:z.literal("patch"),assignmentId:z.uuid(),field:z.enum(["element","finishId"]),value:z.string(),expectedValue:z.string()}).strict().superRefine((value,ctx)=>{if(value.field==="finishId"&&(!z.uuid().safeParse(value.value).success||!z.uuid().safeParse(value.expectedValue).success))ctx.addIssue({code:"custom",message:"Выберите вариант покрытия"});}),
 z.object({...base,op:z.literal("remove"),assignmentId:z.uuid(),expectedElement:z.string(),expectedFinishId:z.uuid()}).strict(),
]);
export type ProductFinishCommand=z.infer<typeof productFinishCommandSchema>;
export type ProductFinishRow=Pick<ProductFinishAssignment,"id"|"productId"|"element"|"finishId"|"finishKind"|"finishName"|"finishCode"|"finishColor"|"catalogRevision"|"sampleAssetId"> & {sampleAsset:Pick<CatalogueMediaAsset,"id"|"fileName"|"mimeType"|"size">|null};
export type ProductFinishInitial={revision:number;rows:ProductFinishRow[]};
export function productFinishRow(row:ProductFinishAssignment&{sampleAsset?:Pick<CatalogueMediaAsset,"id"|"fileName"|"mimeType"|"size"|"deletedAt">|null}):ProductFinishRow{return{id:row.id,productId:row.productId,element:row.element,finishId:row.finishId,finishKind:row.finishKind,finishName:row.finishName,finishCode:row.finishCode,finishColor:row.finishColor,catalogRevision:row.catalogRevision,sampleAssetId:row.sampleAssetId??null,sampleAsset:row.sampleAsset&&!row.sampleAsset.deletedAt?{id:row.sampleAsset.id,fileName:row.sampleAsset.fileName,mimeType:row.sampleAsset.mimeType,size:row.sampleAsset.size}:null};}
export type ProductFinishResult={kind:"saved";op:ProductFinishCommand["op"];revision:number;clientMutationId:string;row?:ProductFinishRow;removedId?:string;repeated?:boolean;noOp?:boolean;retiredSampleAssetId?:string;retiredSampleFinishId?:string}|{kind:"validation"|"conflict"|"forbidden"|"not-found"|"failure";error:string;currentRevision?:number;currentRow?:ProductFinishRow};
export const elementKey=(value:string)=>value.normalize("NFKC").toLocaleLowerCase("ru-RU");
