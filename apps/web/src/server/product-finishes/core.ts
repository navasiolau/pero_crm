import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "../projects/core";
import { OFFICE_WRITE_ROLES, hasAnyRole } from "@/lib/roles";
import { resolveVisibilityActor, productEditWhere, canEditProductTechnicalBlock } from "@/server/access/visibility";
import { withTaskTransaction, type TaskTransaction } from "../tasks/transaction";
import { productFinishCommandSchema, elementSchema, elementKey, productFinishRow, type ProductFinishResult } from "./contracts";
export async function patchProductFinishCore(actor:DomainActor,input:unknown,transaction:TaskTransaction=withTaskTransaction):Promise<ProductFinishResult>{
 if(!hasAnyRole(actor.roles,OFFICE_WRITE_ROLES))return{kind:"forbidden",error:"Недостаточно технических прав"};
 const parsed=productFinishCommandSchema.safeParse(input);if(!parsed.success)return{kind:"validation",error:"Некорректный запрос покрытия"};const command=parsed.data;
 try{return await transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id"=${command.productId} FOR UPDATE`;
  const visibility=await resolveVisibilityActor(tx,actor);
  const product=await tx.product.findFirst({where:{AND:[{id:command.productId},productEditWhere(visibility)]},select:{id:true,engineerId:true,status:true,finishRevision:true}});
  if(!product||!canEditProductTechnicalBlock(visibility,product))return{kind:"forbidden",error:"Изделие недоступно или нет технических прав"};
  const receiptId=`product-finish:${command.clientMutationId}`,fingerprint=createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const receipt=await tx.changeLog.findUnique({where:{id:receiptId}});
  if(receipt){const value=receipt.newValue as unknown as{fingerprint?:string;result?:ProductFinishResult};if(receipt.actorId!==actor.id||receipt.entity!=="product"||receipt.entityId!==product.id||receipt.action!=="finish.patch"||value?.fingerprint!==fingerprint||value.result?.kind!=="saved")return{kind:"validation",error:"Идентификатор запроса уже использован"};return{...value.result,...(value.result.row?{row:{...value.result.row,sampleAssetId:value.result.row.sampleAssetId??null,sampleAsset:value.result.row.sampleAsset??null}}:{}),repeated:true};}
  const old=command.op==="add"?null:await tx.productFinishAssignment.findFirst({where:{id:command.assignmentId,productId:product.id},include:{sampleAsset:true}});
  if(command.op!=="add"&&!old)return{kind:"not-found",error:"Элемент не найден в этом изделии"};
  const conflict:ProductFinishResult={kind:"conflict",error:"Спецификация изменена другим пользователем. Подтвердите актуальные значения",currentRevision:product.finishRevision,...(old?{currentRow:productFinishRow(old)}:{})};
  if(product.finishRevision!==command.expectedRevision)return conflict;
  if(command.op==="patch"&&old![command.field]!==command.expectedValue)return conflict;
  if(command.op==="remove"&&(old!.element!==command.expectedElement||old!.finishId!==command.expectedFinishId))return conflict;
  let data:Prisma.ProductFinishAssignmentUncheckedUpdateInput={};
  if(command.op==="add"||command.op==="patch"&&command.field==="finishId"){
   const finishId=command.op==="add"?command.finishId:command.value;if(!/^[0-9a-f-]{36}$/i.test(finishId))return{kind:"validation",error:"Выберите вариант покрытия"};
   const finish=await tx.finish.findFirst({where:{id:finishId,active:true}});if(!finish)return{kind:"validation",error:"Выберите активный вариант каталога"};if(finish.sampleAssetId){const asset=await tx.catalogueMediaAsset.findFirst({where:{id:finish.sampleAssetId,finishId:finish.id,deletedAt:null}});if(!asset)return{kind:"validation",error:"Образец каталога недоступен"};}
   data={finishId:finish.id,finishKind:finish.kind,finishName:finish.name,finishCode:finish.code,finishColor:finish.color,catalogRevision:finish.revision,sampleAssetId:finish.sampleAssetId};
  }
  if(command.op==="add"||command.op==="patch"&&command.field==="element"){
   const element=elementSchema.safeParse(command.op==="add"?command.element:command.value);if(!element.success)return{kind:"validation",error:element.error.issues[0]?.message??"Укажите элемент"};data={...data,element:element.data,elementKey:elementKey(element.data)};
  }
  if(command.op==="patch"&&command.value===command.expectedValue)return{kind:"saved",op:command.op,revision:product.finishRevision,clientMutationId:command.clientMutationId,row:productFinishRow(old!),noOp:true};
  if(command.op==="add"&&await tx.productFinishAssignment.count({where:{productId:product.id}})>=100)return{kind:"validation",error:"Не больше 100 элементов в изделии"};
  const changed=await tx.product.updateMany({where:{id:product.id,finishRevision:command.expectedRevision},data:{finishRevision:{increment:1}}});if(changed.count!==1)return conflict;
  let result:ProductFinishResult;
  if(command.op==="remove"){await tx.productFinishAssignment.delete({where:{id:old!.id}});result={kind:"saved",op:command.op,revision:product.finishRevision+1,clientMutationId:command.clientMutationId,removedId:old!.id};}
  else{const row=command.op==="add"?await tx.productFinishAssignment.create({data:{id:randomUUID(),productId:product.id,...data} as Prisma.ProductFinishAssignmentUncheckedCreateInput,include:{sampleAsset:true}}):await tx.productFinishAssignment.update({where:{id:old!.id},data,include:{sampleAsset:true}});result={kind:"saved",op:command.op,revision:product.finishRevision+1,clientMutationId:command.clientMutationId,row:productFinishRow(row)};}
  if(old?.sampleAssetId&&(command.op==="remove"||command.op==="patch"&&command.field==="finishId"&&old.sampleAssetId!==data.sampleAssetId)){result={...result,retiredSampleAssetId:old.sampleAssetId,retiredSampleFinishId:old.finishId};}
  await tx.changeLog.create({data:{id:receiptId,actorType:"user",actorId:actor.id,actorName:actor.name,source:actor.source,entity:"product",entityId:product.id,action:"finish.patch",field:"finishAssignments",oldValue:old?productFinishRow(old):{},newValue:{fingerprint,result} as unknown as Prisma.InputJsonValue}});
  return result;
 });}catch(error){return error&&typeof error==="object"&&"code" in error&&error.code==="P2002"?{kind:"validation",error:"Элемент с таким названием уже есть"}:{kind:"failure",error:"Не удалось сохранить покрытие"};}
}
