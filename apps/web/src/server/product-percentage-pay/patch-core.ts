import {liveProductWhere} from "@/server/access/live-entities";
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { MANAGER_ROLES,hasAnyRole } from '@/lib/roles';
import { parseProductPercentageRate } from '@/lib/product-percentage-rate-limit';
import { adjustSettledPercentage,type PercentageAdjustmentNotice } from './direct-completion';
import type { DomainActor } from '@/server/projects/core';
import { productPercentagePatchSchema,type ProductPercentagePatch,type ProductPercentagePatchResult } from './contracts';
import { PERCENTAGE_STAGE_POLICY } from './stage-policy';
export async function patchProductPercentageCore(actor:DomainActor,input:ProductPercentagePatch,tx:Prisma.TransactionClient,effects:PercentageAdjustmentNotice[]=[]):Promise<ProductPercentagePatchResult>{
 if(!hasAnyRole(actor.roles,MANAGER_ROLES))return{ok:false,kind:'forbidden',error:'Недостаточно прав'};
 const parsed=productPercentagePatchSchema.safeParse(input);if(!parsed.success)return{ok:false,kind:'validation',error:'Проверьте поле оплаты, значение и ревизию'};
 const data=parsed.data;const policy=PERCENTAGE_STAGE_POLICY[data.kind];const receiptId=`product-percentage:${data.clientMutationId}`;
 const fingerprint=createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const product=await tx.product.findUnique({where:{...liveProductWhere,id:data.productId},select:{id:true,projectId:true,status:true,engineerId:true,mounterId:true,assemblerId:true}});
  if(!product)return{ok:false,kind:'not-found',error:'Изделие не найдено'};
 const receipt=await tx.changeLog.findUnique({where:{id:receiptId}});
 if(receipt){const saved=receipt.newValue;
 if(receipt.actorId!==actor.id||receipt.entity!=='product'||receipt.entityId!==data.productId||receipt.action!=='percentage.patch'||!saved||typeof saved!=='object'||Array.isArray(saved)||saved.fingerprint!==fingerprint||!saved.result||typeof saved.result!=='object'||Array.isArray(saved.result))return{ok:false,kind:'validation',error:'Идентификатор запроса уже использован'};
 const result=saved.result as unknown as Extract<ProductPercentagePatchResult,{ok:true}>;
 return{...result,repeated:true};}
  // Уже записанная квитанция подтверждается и после DONE; новая правка закрыта.
  if(product.status==='DONE')return{ok:false,kind:'forbidden',error:'Изделие завершено: изменение процентов закрыто'};
 const config=await tx.productPercentageConfig.findUnique({where:{productId_kind:{productId:data.productId,kind:data.kind}}});
 const revision=config?.revision??0;
 const current=data.field==='ratePercent'?config?.ratePercent?.toString()??null:product[policy.assignment];
 const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 const expected=data.expectedValue;
 if(revision!==data.expectedRevision||!equal(current,expected))return{ok:false,kind:'conflict',error:'Настройки изменились. Проверьте актуальное значение',currentValue:current,currentRevision:revision};
  let value:string|null;
  try{
  // Пустых ставок не бывает: null отклоняется схемой, '' — контроллером; здесь только цифры.
  value=data.field==='ratePercent'?parseProductPercentageRate(data.value) as string:data.value;
 if(data.field==='ratePercent'&&value!==null)value=new Prisma.Decimal(value as string).toString();
 if(data.field==='assigneeId'&&value!==null){const recipient=await tx.user.findUnique({where:{id:value as string},select:{active:true,roles:true}});if(!recipient?.active||!recipient.roles.includes(policy.role))throw new Error('Выберите активного сотрудника нужной роли');}
 }catch(error){return{ok:false,kind:'validation',error:error instanceof Error?error.message:'Проверьте данные оплаты'};}
 if(equal(current,value))return{ok:true,kind:'saved',field:data.field,value,revision,clientMutationId:data.clientMutationId,noOp:true,repeated:false};
  if(data.field==='assigneeId')await tx.product.update({where:{id:product.id},data:{[policy.assignment]:value as string|null}});
  const fields=data.field==='ratePercent'?{ratePercent:value as string|null}:{};
  const updated=config?await tx.productPercentageConfig.update({where:{id:config.id},data:{...fields,revision:{increment:1}}}):await tx.productPercentageConfig.create({data:{productId:data.productId,kind:data.kind,...fields,revision:1}});
  // Смена ставки после состоявшегося начисления пересчитывает снимок и зарплату дельтой.
  if(data.field==='ratePercent'&&value!==null){const adjustment=await adjustSettledPercentage(tx,actor,data.productId,data.kind,value,data.clientMutationId);if(adjustment.notice)effects.push(adjustment.notice);}
 const result:Extract<ProductPercentagePatchResult,{ok:true}>={ok:true,kind:'saved',field:data.field,value,revision:updated.revision,clientMutationId:data.clientMutationId,noOp:false,repeated:false};
 await tx.changeLog.create({data:{id:receiptId,actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'product',entityId:data.productId,action:'percentage.patch',field:data.field,oldValue:{value:current,revision},newValue:{fingerprint,result}}});
 return result;
}
