import { z } from 'zod';
export const workReviewSchema=z.array(z.object({workId:z.string().min(1),classification:z.enum(['COVERED','INDEPENDENT'])}).strict()).max(500);
export type WorkReviewItem=z.infer<typeof workReviewSchema>[number];
const base={productId:z.string().min(1),kind:z.enum(['ENGINEERING','ASSEMBLY','INSTALLATION']),expectedRevision:z.number().int().nonnegative(),clientMutationId:z.uuid()};
export const productPercentagePatchSchema=z.discriminatedUnion('field',[
 z.object({...base,field:z.literal('ratePercent'),value:z.string().max(16).nullable(),expectedValue:z.string().max(16).nullable()}).strict(),
 z.object({...base,field:z.literal('assigneeId'),value:z.string().min(1).nullable(),expectedValue:z.string().min(1).nullable()}).strict(),
 z.object({...base,field:z.literal('workReview'),value:workReviewSchema,expectedValue:workReviewSchema}).strict(),
]);
export type ProductPercentagePatch=z.infer<typeof productPercentagePatchSchema>;
export type ProductPercentagePatchResult={ok:true;kind:'saved';field:ProductPercentagePatch['field'];value:string|null|WorkReviewItem[];revision:number;clientMutationId:string;noOp:boolean;repeated:boolean}
 |{ok:false;kind:'conflict';error:string;currentValue:string|null|WorkReviewItem[];currentRevision:number}
 |{ok:false;kind:'validation'|'forbidden'|'not-found'|'failure';error:string};
export function readWorkReview(value:unknown):WorkReviewItem[]{
 const parsed=workReviewSchema.safeParse(value??[]);
 if(!parsed.success||new Set(parsed.data.map(row=>row.workId)).size!==parsed.data.length)throw new Error('Нужна корректная классификация работ без повторов');
 return [...parsed.data].sort((a,b)=>a.workId.localeCompare(b.workId));
}

