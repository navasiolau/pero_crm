import { payrollCompensationCommand } from "@/server/payroll/accrual-reversal";
import { percentageSettingsCommand, percentageSettingsDependency, persistPercentageSettings, validatePercentageRecipient } from "./settings-reversal";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import {journalProductContext} from '@/server/finance/journal';
import { canAccessProductDraft } from "@/lib/product-drafts";
import { productDraftAccessSelect } from "@/server/access/product-draft-context";
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
  const product=await tx.product.findUnique({where:{...liveProductWhere,id:data.productId},select:{...productDraftAccessSelect,id:true,number:true,status:true,engineerId:true,mounterId:true,assemblerId:true,workflowRevision:true}});
  if(!product||product.status==='DRAFT'&&!canAccessProductDraft(actor.roles,product))return{ok:false,kind:'not-found',error:'Изделие не найдено'};
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
  let recipientName:string|null=null;
  try{
  // Пустых ставок не бывает: null отклоняется схемой, '' — контроллером; здесь только цифры.
  value=data.field==='ratePercent'?parseProductPercentageRate(data.value) as string:data.value;
 if(data.field==='ratePercent'&&value!==null)value=new Prisma.Decimal(value as string).toString();
 if(data.field==='assigneeId')recipientName=await validatePercentageRecipient(tx,data.kind,value);
 }catch(error){return{ok:false,kind:'validation',error:error instanceof Error?error.message:'Проверьте данные оплаты'};}
 if(equal(current,value))return{ok:true,kind:'saved',field:data.field,value,revision,clientMutationId:data.clientMutationId,noOp:true,repeated:false};
 const updated=await persistPercentageSettings(tx,data.productId,data.kind,config,data.field,value);
 const grouped=typeof product.workflowRevision==="number";
 const adjustment=data.field==="ratePercent"&&value!==null
  ?await adjustSettledPercentage(tx,actor,data.productId,data.kind,value,data.clientMutationId,grouped?receiptId:undefined):null;
 if(adjustment?.notice)effects.push(adjustment.notice);
 const money=adjustment?.payrollRows??[];
 const reversal=grouped?percentageSettingsCommand({kind:data.kind,field:data.field,previous:current,expected:value,
  revision:updated.revision,dependency:await percentageSettingsDependency(tx,data.productId,data.kind)},
  money.length?payrollCompensationCommand(data.productId,money).data:null):undefined;
 const result:Extract<ProductPercentagePatchResult,{ok:true}>={ok:true,kind:'saved',field:data.field,value,revision:updated.revision,clientMutationId:data.clientMutationId,noOp:false,repeated:false};
 const previousRecipient=data.field==='assigneeId'&&current?await tx.user.findUnique({where:{id:current},select:{name:true}}):null;
 await writeChangeLogInTransaction(tx, {id:receiptId,actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'product',entityId:data.productId,action:'percentage.patch',reversal,field:data.field,oldValue:{value:current,revision},newValue:{fingerprint,result}},
  {entity:{label:`Изделие ${product.number}`,href:`/products/${encodeURIComponent(product.id)}`},contexts:[journalProductContext(product)],
   links:data.field==='assigneeId'?[...(current?[{type:'user',id:current,label:previousRecipient?.name??'Пользователь'}]:[]),...(value?[{type:'user',id:value,label:recipientName??'Пользователь'}]:[])]:[],
   before:{kind:data.kind,[data.field]:current},after:{kind:data.kind,[data.field]:value}});
 return result;
}
