import { Prisma } from '@prisma/client';
import { readWorkReview } from './contracts';
import { readLegacyWorkFacts } from './direct-completion';
export async function isEffectivelyCoveredWork(tx:Prisma.TransactionClient,workId:string,productId:string,projectId:string):Promise<boolean>{
 const configs=await tx.productPercentageConfig.findMany({where:{productId,kind:'INSTALLATION'},include:{product:{select:{projectId:true,quantity:true,expectedPrice:true,project:{select:{currency:true}},mounter:{select:{active:true,roles:true}},percentageCompletions:{where:{kind:'INSTALLATION'},select:{state:true,calculationVersion:true,ratePercentSnapshot:true}}}}}});
 for(const config of configs){
 const review=readWorkReview(config.workReview);if(!review.some(row=>row.workId===workId&&row.classification==='COVERED'))continue;
 if(config.product.projectId!==projectId)throw new Error('Оплата работы относится к другому проекту');
 const completion=config.product.percentageCompletions.at(0);
 if(completion){if(completion.calculationVersion===2&&completion.state==='SETTLED'&&completion.ratePercentSnapshot!==null&&completion.ratePercentSnapshot.gt(0))return true;continue;}
 if(config.ratePercent===null||!config.ratePercent.gt(0)||config.product.expectedPrice===null||config.product.expectedPrice.lt(0)||config.product.quantity<1||config.product.project.currency!=='BYN'||!config.product.mounter?.active||!config.product.mounter.roles.includes('MOUNTER'))continue;
 const facts=await readLegacyWorkFacts(tx,productId,projectId);
 if(review.length!==facts.length||facts.some(work=>!review.some(row=>row.workId===work.id)))continue;
 if(facts.some(work=>work.paid&&review.some(row=>row.workId===work.id&&row.classification==='COVERED')))continue;
 return true;
 }
 return false;
}
