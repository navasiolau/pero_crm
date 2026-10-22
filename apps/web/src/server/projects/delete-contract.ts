import {z} from 'zod';
export const projectDeleteSchema=z.object({projectId:z.string().min(1).max(128),expectedUpdatedAt:z.string().datetime(),expectedProductsVersion:z.string().regex(/^[a-f0-9]{64}$/),clientMutationId:z.uuid()}).strict();
export type ProjectDeleteInput=z.infer<typeof projectDeleteSchema>;
export type ProjectDeleteBaseline={projectId:string;number:string;title:string;expectedUpdatedAt:string;expectedProductsVersion:string;productCount:number};
export type ProjectDeleteResult={ok:true;projectId:string;number:string;title:string;deletedAt:string;clientMutationId:string;affectedProductIds:string[];repeated?:boolean}|{ok:false;kind:'validation'|'forbidden'|'not-found'|'conflict'|'failure';error:string};
