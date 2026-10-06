import { z } from 'zod';
const base={productId:z.string().min(1),kind:z.enum(['ENGINEERING','ASSEMBLY','INSTALLATION']),expectedRevision:z.number().int().nonnegative(),clientMutationId:z.uuid()};
export const productPercentagePatchSchema=z.discriminatedUnion('field',[
 z.object({...base,field:z.literal('ratePercent'),value:z.string().max(16),expectedValue:z.string().max(16).nullable()}).strict(),
 z.object({...base,field:z.literal('assigneeId'),value:z.string().min(1).nullable(),expectedValue:z.string().min(1).nullable()}).strict(),
]);
export type ProductPercentagePatch=z.infer<typeof productPercentagePatchSchema>;
export type ProductPercentagePatchResult={ok:true;kind:'saved';field:ProductPercentagePatch['field'];value:string|null;revision:number;clientMutationId:string;noOp:boolean;repeated:boolean}
 |{ok:false;kind:'conflict';error:string;currentValue:string|null;currentRevision:number}
 |{ok:false;kind:'validation'|'forbidden'|'not-found'|'failure';error:string};
