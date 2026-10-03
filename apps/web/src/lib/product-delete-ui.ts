import type {ProductDeleteInput} from '@/server/products/delete-contract';
export function isConfirmedProductDelete(value:unknown,input:ProductDeleteInput){
 if(!value||typeof value!=='object')return false;const ack=value as Record<string,unknown>;
 if(ack.ok!==true||ack.productId!==input.productId||ack.clientMutationId!==input.clientMutationId||typeof ack.projectId!=='string'||!ack.projectId||typeof ack.deletedAt!=='string')return false;
 const date=new Date(ack.deletedAt);return Number.isFinite(date.getTime())&&date.toISOString()===ack.deletedAt;
}
