import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { MANAGER_ROLES,hasAnyRole } from '@/lib/roles';
import { parsePercentageRate } from '@/lib/product-percentage-pay';
import type { DomainActor } from '@/server/projects/core';
import { productPercentagePatchSchema,readWorkReview,type ProductPercentagePatch,type ProductPercentagePatchResult } from './contracts';
import { PERCENTAGE_STAGE_POLICY } from './stage-policy';
import { assertExclusiveWorkCoverage } from './work-review';
import { readLegacyWorkFacts } from './direct-completion';
export async function patchProductPercentageCore(actor:DomainActor,input:ProductPercentagePatch,tx:Prisma.TransactionClient):Promise<ProductPercentagePatchResult>{
 if(!hasAnyRole(actor.roles,MANAGER_ROLES))return{ok:false,kind:'forbidden',error:'Недостаточно прав'};
 const parsed=productPercentagePatchSchema.safeParse(input);if(!parsed.success)return{ok:false,kind:'validation',error:'Проверьте поле оплаты, значение и ревизию'};
 const data=parsed.data;const policy=PERCENTAGE_STAGE_POLICY[data.kind];const receiptId=`product-percentage:${data.clientMutationId}`;
 const fingerprint=createHash('sha256').update(JSON.stringify(data)).digest('hex');
 const product=await tx.product.findUnique({where:{id:data.productId},select:{id:true,projectId:true,engineerId:true,mounterId:true,assemblerId:true}});
 if(!product)return{ok:false,kind:'not-found',error:'Изделие не найдено'};
 const receipt=await tx.changeLog.findUnique({where:{id:receiptId}});
 if(receipt){const saved=receipt.newValue;
 if(receipt.actorId!==actor.id||receipt.entity!=='product'||receipt.entityId!==data.productId||receipt.action!=='percentage.patch'||!saved||typeof saved!=='object'||Array.isArray(saved)||saved.fingerprint!==fingerprint||!saved.result||typeof saved.result!=='object'||Array.isArray(saved.result))return{ok:false,kind:'validation',error:'Идентификатор запроса уже использован'};
 const result=saved.result as unknown as Extract<ProductPercentagePatchResult,{ok:true}>;
 return{...result,repeated:true};}
 const config=await tx.productPercentageConfig.findUnique({where:{productId_kind:{productId:data.productId,kind:data.kind}}});
 const revision=config?.revision??0;
 const current=data.field==='ratePercent'?config?.ratePercent?.toString()??null:data.field==='assigneeId'?product[policy.assignment]:readWorkReview(config?.workReview);
 const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 const expected=data.field==='workReview'?readWorkReview(data.expectedValue):data.expectedValue;
 if(revision!==data.expectedRevision||!equal(current,expected))return{ok:false,kind:'conflict',error:'Настройки изменились. Проверьте актуальное значение',currentValue:current,currentRevision:revision};
 let value:string|null|ReturnType<typeof readWorkReview>;
 try{
 value=data.field==='ratePercent'?parsePercentageRate(data.value):data.field==='assigneeId'?data.value:readWorkReview(data.value);
 if(data.field==='ratePercent'&&value!==null)value=new Prisma.Decimal(value as string).toString();
 if(data.field==='assigneeId'&&value!==null){const recipient=await tx.user.findUnique({where:{id:value as string},select:{active:true,roles:true}});if(!recipient?.active||!recipient.roles.includes(policy.role))throw new Error('Выберите активного сотрудника нужной роли');}
 if(data.field==='workReview'){
 if(!policy.requiresWorkReview)throw new Error('Классификация работ доступна для сборки и монтажа');
 if(await tx.productPercentageCompletion.findUnique({where:{productId_kind:{productId:data.productId,kind:data.kind}},select:{id:true}}))throw new Error('Классификация завершённого этапа зафиксирована');
 const facts=await readLegacyWorkFacts(tx,product.id,product.projectId);const rows=value as ReturnType<typeof readWorkReview>;
 if(rows.length!==facts.length||facts.some(work=>!rows.some(row=>row.workId===work.id)))throw new Error('Укажите классификацию всех обычных работ этого изделия');
 await assertExclusiveWorkCoverage(tx,product.id,data.kind,rows);
 const coveredIds=rows.filter(row=>row.classification==='COVERED').map(row=>row.workId);
 if(coveredIds.length){const frozen=await tx.task.findFirst({where:{workId:{in:coveredIds},status:{not:'DONE'},OR:[{allocationGroupId:{not:null}},{shareAmount:{not:null}},{executorShare:{not:1}}]},select:{id:true}});if(frozen)throw new Error('Старые обязательства оплаты требуют самостоятельной классификации работы');}

 }
 }catch(error){return{ok:false,kind:'validation',error:error instanceof Error?error.message:'Проверьте данные оплаты'};}
 if(equal(current,value))return{ok:true,kind:'saved',field:data.field,value,revision,clientMutationId:data.clientMutationId,noOp:true,repeated:false};
 if(data.field==='assigneeId')await tx.product.update({where:{id:product.id},data:{[policy.assignment]:value as string|null}});
 const fields=data.field==='ratePercent'?{ratePercent:value as string|null}:data.field==='workReview'?{workReview:value as Prisma.InputJsonValue}:{};
 const updated=config?await tx.productPercentageConfig.update({where:{id:config.id},data:{...fields,revision:{increment:1}}}):await tx.productPercentageConfig.create({data:{productId:data.productId,kind:data.kind,...fields,revision:1}});
 const result:Extract<ProductPercentagePatchResult,{ok:true}>={ok:true,kind:'saved',field:data.field,value,revision:updated.revision,clientMutationId:data.clientMutationId,noOp:false,repeated:false};
 await tx.changeLog.create({data:{id:receiptId,actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'product',entityId:data.productId,action:'percentage.patch',field:data.field,oldValue:{value:current,revision},newValue:{fingerprint,result,reviewedById:actor.id,reviewedByName:actor.name,reviewedAt:new Date().toISOString()}}});
 return result;
}
