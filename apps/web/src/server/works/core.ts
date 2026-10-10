import { productVisibilityWhere } from "@/server/access/visibility";
import {z} from 'zod';
import {hasAnyRole,FIELD_ROLES,MANAGER_ROLES} from '@/lib/roles';
import {assertInternalCurrency,assertProjectMoneyCurrency} from '@/lib/internal-currency';
import {inputNorm,scaleNorm,workBudget} from '@/lib/product-quantity';
import {liveProductWhere,liveProjectWhere} from '@/server/access/live-entities';
import {lockProductRow} from '@/server/products/quantity-core';
import {withTaskTransaction,type TaskTransaction} from '@/server/tasks/transaction';
import type {DomainActor} from '@/server/projects/core';
export const addWorkSchema=z.object({projectId:z.string().min(1),productId:z.string().min(1).optional(),priceItemId:z.string().min(1,'Выберите расценку'),quantity:z.number().positive('Количество должно быть больше нуля').optional(),quantityPerUnit:z.number().positive('Количество должно быть больше нуля').optional()}).strict();
export type AddWorkInput=z.input<typeof addWorkSchema>;
export async function addWorkCore(actor:DomainActor,input:unknown,transaction:TaskTransaction=withTaskTransaction):Promise<{ok:true;workId:string}|{ok:false;error:string}> {
 const parsed=addWorkSchema.safeParse(input);if(!parsed.success)return{ok:false,error:parsed.error.issues[0]?.message??'Проверьте данные работы'};const data=parsed.data;
 try{return await transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR UPDATE`;
  const current=await tx.user.findUnique({where:{id:actor.id},select:{id:true,name:true,active:true,roles:true}});
   if(!current?.active||!hasAnyRole(current.roles,[...MANAGER_ROLES,...FIELD_ROLES]))throw Error('Недостаточно прав');
  const manager=hasAnyRole(current.roles,MANAGER_ROLES);
  if(!manager&&!data.productId)throw Error('Выберите изделие в производстве');
  if(data.productId)await lockProductRow(tx,data.productId);
  const project=await tx.project.findUnique({where:{...liveProjectWhere,id:data.projectId},select:{id:true,number:true,currency:true}});
  if(!project)throw Error('Проект не найден');
  const product=data.productId?await tx.product.findFirst({where:{...liveProductWhere,id:data.productId,projectId:data.projectId,AND:[productVisibilityWhere(current)]},select:{id:true,status:true,quantity:true}}):null;
  if(data.productId&&!product)throw Error('Изделие не найдено в этом проекте');
   if(!manager&&(!hasAnyRole(current.roles,FIELD_ROLES)||product?.status!=='PRODUCTION'))throw Error('Работу можно добавить только в изделие в производстве');
  assertProjectMoneyCurrency(project.currency);assertInternalCurrency((await tx.orgSetting.findUnique({where:{key:'payrollCurrency'}}))?.value??'BYN');
  await tx.$queryRaw`SELECT id FROM "PriceItem" WHERE id=${data.priceItemId} FOR UPDATE`;
  const price=await tx.priceItem.findUnique({where:{id:data.priceItemId},select:{id:true,name:true,unit:true,price:true,active:true}});
  if(!price?.active)throw Error('Выберите действующую расценку');
  if(!product&&data.quantityPerUnit!==undefined)throw Error('Для нормы на штуку выберите изделие');
  const norm=inputNorm(data,product?.quantity??1,2,10),quantity=scaleNorm(norm,product?.quantity??1,2,10);
  const work=await tx.work.create({data:{projectId:project.id,productId:product?.id??null,priceItemId:price.id,title:price.name,unitSnapshot:price.unit,quantity,quantityPerUnit:product?norm:null,priceSnapshot:price.price,total:workBudget(price.price,quantity),createdById:current.id}});
  await tx.changeLog.create({data:{actorType:'user',actorId:current.id,actorName:current.name,source:actor.source,entity:'work',entityId:work.id,action:'create',newValue:{project:project.number,title:work.title,quantity:work.quantity.toString(),quantityPerUnit:work.quantityPerUnit?.toString()??null,unitSnapshot:price.unit,price:price.price.toString(),total:work.total?.toString()??null}}});
  return{ok:true as const,workId:work.id};
 });}catch(error){return{ok:false,error:error instanceof Error?error.message:'Не удалось добавить работу'};}
}
