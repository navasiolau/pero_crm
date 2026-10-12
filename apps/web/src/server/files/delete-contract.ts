import {z} from "zod";
import path from "node:path";
import {createHash} from "node:crypto";

export const FILE_STORAGE_DELETE_EVENT="file.storage-delete";
const id=z.string().min(1).max(128);
const component=z.string().min(1).max(255).refine(value=>!/[\\/\u0000:]/.test(value)&&value!=="."&&value!=="..");
const endpoint=z.string().url().refine(value=>{const url=new URL(value);return ["http:","https:"].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash;});
export const fileDeleteStorageSchema=z.discriminatedUnion("mode",[
 z.object({mode:z.literal("local"),root:z.string().min(1).refine(value=>path.isAbsolute(value)&&path.resolve(value)===value&&!value.includes("\0"))}).strict(),
 z.object({mode:z.literal("s3"),endpoint,bucket:z.string().min(1).max(63)}).strict(),
]);
export const fileDeleteRequestSchema=z.object({fileId:id,clientMutationId:z.uuid()}).strict();
export const fileDeleteIntentSchema=z.object({fileId:id,projectId:component,storedName:component,hasThumb:z.boolean(),actorId:id,clientMutationId:z.uuid(),storage:fileDeleteStorageSchema,keys:z.array(z.string().min(1).max(1024)).min(1).max(2)}).strict();
export type FileDeleteStorageIdentity=z.infer<typeof fileDeleteStorageSchema>;
export type FileDeleteIntent=z.infer<typeof fileDeleteIntentSchema>;
export type FileDeleteRequest=z.infer<typeof fileDeleteRequestSchema>;
export type FileDeleteResult={ok:false;error:string}|{ok:true;fileId:string;clientMutationId:string;projectId:string;productId:string|null;repeated?:boolean;cleanupPending?:boolean};
export const fileDeleteEventId=(clientMutationId:string)=>"file-delete:"+clientMutationId;
export const fileDeleteKeys=(input:{projectId:string;storedName:string;hasThumb:boolean})=>[`${input.projectId}/${input.storedName}`,...(input.hasThumb?[`${input.projectId}/thumbs/${input.storedName}.jpg`]:[])];
export const fileDeleteIntentHash=(intent:FileDeleteIntent)=>createHash("sha256").update(JSON.stringify(intent)).digest("hex");
export function validateFileDeleteEvent(event:{id:string;type:string;actor:string;payload:unknown}){
 const intent=fileDeleteIntentSchema.parse(event.payload);
 if(event.type!==FILE_STORAGE_DELETE_EVENT||event.id!==fileDeleteEventId(intent.clientMutationId)||event.actor!=="user:"+intent.actorId||JSON.stringify(intent.keys)!==JSON.stringify(fileDeleteKeys(intent)))throw Error("FILE_DELETE_INTENT_INVALID");
 return intent;
}
