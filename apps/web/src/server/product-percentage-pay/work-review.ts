import type { Prisma,ProductPercentageKind } from '@prisma/client';
import { readWorkReview,type WorkReviewItem } from './contracts';
/** A real work may be covered by exactly one current stage, including zero/null-rate drafts. */
export async function assertExclusiveWorkCoverage(tx:Prisma.TransactionClient,productId:string,kind:ProductPercentageKind,review:readonly WorkReviewItem[]):Promise<void>{
 const covered=new Set(review.filter(row=>row.classification==='COVERED').map(row=>row.workId));if(!covered.size)return;
 const others=await tx.productPercentageConfig.findMany({where:{productId,kind:{in:['ASSEMBLY','INSTALLATION'],not:kind}},select:{kind:true,workReview:true}});
 if(others.some(config=>readWorkReview(config.workReview).some(row=>row.classification==='COVERED'&&covered.has(row.workId))))throw new Error('Обычная работа может быть покрыта только одним процентным этапом. Выберите самостоятельную классификацию в другом этапе');
}
