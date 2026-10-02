import { Prisma, type ProductPercentageKind, type ProductStatus } from '@prisma/client';
import { assertProjectMoneyCurrency } from '@/lib/internal-currency';
import type { DomainActor } from '@/server/projects/core';
import { readWorkReview } from './contracts';
export type PercentageAccrualEffects={eventIds:string[];earnings:{userId:string;userName:string;amount:string;currency:string}[]};
export async function readLegacyWorkFacts(tx:Prisma.TransactionClient,productId:string,projectId:string){
 const works=await tx.work.findMany({where:{productId,projectId,paymentKind:'LEGACY'},select:{id:true,title:true,tasks:{select:{id:true,projectId:true,productId:true}}}});
 if(works.some(work=>work.tasks.some(task=>task.projectId!==projectId||task.productId!==productId)))throw new Error('Связи обычной работы и задач не совпадают');
 if(!works.length)return [];
 const entries=await tx.payrollEntry.findMany({where:{OR:[{workId:{in:works.map(work=>work.id)}},{taskId:{in:works.flatMap(work=>work.tasks.map(task=>task.id))}}]},select:{workId:true,taskId:true}});
 return works.map(work=>({id:work.id,title:work.title,paid:entries.some(entry=>entry.workId===work.id||work.tasks.some(task=>task.id===entry.taskId))}));
}
export async function captureDirectPercentage(tx:Prisma.TransactionClient,actor:DomainActor,productId:string,kind:ProductPercentageKind,statusAtCompletion:ProductStatus,effects?:PercentageAccrualEffects){
 const product=await tx.product.findUnique({where:{id:productId},include:{project:{select:{currency:true}},engineer:{select:{id:true,name:true,active:true,roles:true}},mounter:{select:{id:true,name:true,active:true,roles:true}},percentageConfigs:{where:{kind}},stagePayPools:{where:{kind:'ENGINEERING'},select:{state:true}}}});
 if(!product)throw new Error('Изделие не найдено');
 const config=product.percentageConfigs.at(0);const rate=config?.ratePercent==null?null:new Prisma.Decimal(config.ratePercent.toString());
 const price=product.expectedPrice==null?null:new Prisma.Decimal(product.expectedPrice.toString());
 if(!Number.isSafeInteger(product.quantity)||product.quantity<1)throw new Error('Количество изделия должно быть положительным целым');
 if(price&&(!price.isFinite()||price.isNegative()))throw new Error('Цена изделия должна быть неотрицательной');
 if(rate&&(!rate.isFinite()||rate.isNegative()||rate.gt(100)))throw new Error('Ставка должна быть от 0 до 100 процентов');
 assertProjectMoneyCurrency(product.project.currency);
 const recipient=kind==='ENGINEERING'?product.engineer:product.mounter;
 const eligible=!!recipient?.active&&recipient.roles.includes(kind==='ENGINEERING'?'ENGINEER':'MOUNTER');
 const positive=rate!==null&&rate.gt(0);
 let protectedReason:string|null=kind==='ENGINEERING'&&product.stagePayPools.some(pool=>pool.state==='SETTLED'||pool.state==='LEGACY_PROTECTED')?'Уже защищено прежним способом оплаты':null;
 if(positive&&kind==='INSTALLATION'){
 const facts=await readLegacyWorkFacts(tx,product.id,product.projectId);const review=readWorkReview(config?.workReview);
 if(review.length!==facts.length||facts.some(work=>!review.some(row=>row.workId===work.id)))throw new Error('Классифицируйте все обычные работы: покрытые этапом или самостоятельные');
 if(facts.some(work=>work.paid&&review.some(row=>row.workId===work.id&&row.classification==='COVERED')))protectedReason='Покрытая работа уже оплачена; новая оплата этапа запрещена';
 }
 if(positive&&!protectedReason&&price===null)throw new Error('Для положительной ставки укажите цену изделия');
 if(positive&&!protectedReason&&!eligible)throw new Error(kind==='ENGINEERING'?'Назначьте активного инженера':'Назначьте активного монтажника');
 const total=price?.mul(product.quantity)??null;const exact=rate===null?null:rate.isZero()?new Prisma.Decimal(0):total?.mul(rate).div(100)??null;
 if(total?.gt('9999999999999999.99')||exact?.toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP).gt('9999999999.99'))throw new Error('Сумма процентного этапа превышает допустимую');
 const state=protectedReason?'LEGACY_PROTECTED':rate===null?'SKIPPED_ONCE':'SETTLED';
 const amount=state==='SETTLED'?exact!.toFixed(2,Prisma.Decimal.ROUND_HALF_UP):null;
 const now=new Date();const recipientSnapshot=eligible?recipient!:null;
 const completion=await tx.productPercentageCompletion.create({data:{productId,kind,state,statusAtCompletion,calculationVersion:2,quantitySnapshot:product.quantity,totalSnapshot:total,recipientId:recipientSnapshot?.id??null,completedAt:now,completedById:actor.id,reason:protectedReason??(rate===null?'Ставка не задана при первом завершении':null),priceSnapshot:price,ratePercentSnapshot:rate,productCurrency:'BYN',payrollCurrency:'BYN',configRevision:config?.revision??null,
 ...(state==='SETTLED'?{productRateByn:1,payrollRateByn:1,productRateDate:now,payrollRateDate:now,sourceFundExact:exact,amount,bynAmount:amount,projectAmount:amount,settledAt:now}:{})}});
 if(recipientSnapshot){
 const share=await tx.productPercentageCompletionShare.create({data:{completionId:completion.id,userId:recipientSnapshot.id,userNameSnapshot:recipientSnapshot.name,shareUnits:1000000,...(amount!==null?{amount,bynAmount:amount,projectAmount:amount}:{})}});
 if(amount!==null&&new Prisma.Decimal(amount).gt(0)){
 await tx.payrollEntry.create({data:{userId:recipientSnapshot.id,productId,projectId:product.projectId,percentageCompletionShareId:share.id,amount,bynAmount:amount,projectAmount:amount,projectCurrency:'BYN',currency:'BYN',scheme:kind==='ENGINEERING'?'PRODUCT_PERCENT_ENGINEERING':'PRODUCT_PERCENT_INSTALLATION',month:now.toISOString().slice(0,7),comment:`${kind==='ENGINEERING'?'Проектирование':'Монтаж'} изделия ${product.number}`}});
 const event=await tx.domainEvent.create({data:{type:'payroll.accrued',actor:actor.id,payload:{userId:recipientSnapshot.id,productId,projectId:product.projectId,kind,amount:Number(amount)}}});
 effects?.eventIds.push(event.id);effects?.earnings.push({userId:recipientSnapshot.id,userName:recipientSnapshot.name,amount,currency:'BYN'});
 }
 }
 await tx.changeLog.create({data:{actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'product',entityId:productId,action:'percentage.firstCompletion',newValue:{kind,state,completionId:completion.id,statusAtCompletion,calculationVersion:2}}});
 return state;
}
