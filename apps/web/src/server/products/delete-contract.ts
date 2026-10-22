import {z} from 'zod';
export const productDeleteSchema=z.object({productId:z.string().min(1).max(128),expectedUpdatedAt:z.string().datetime(),clientMutationId:z.uuid()}).strict();
export type ProductDeleteInput=z.infer<typeof productDeleteSchema>;
export type ProductDeleteBaseline={productId:string;number:string;title:string;expectedUpdatedAt:string};
export type ProductDeleteResult={ok:true;productId:string;projectId:string;number:string;title:string;deletedAt:string;clientMutationId:string;repeated?:boolean}|
 {ok:false;kind:'validation'|'forbidden'|'not-found'|'conflict'|'failure';error:string};
