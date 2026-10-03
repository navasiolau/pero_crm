import type {ProjectDeleteInput} from '@/server/projects/delete-contract';
export const PROJECT_DELETE_WARNING='Внимание! Проект будет удален вместе со всеми изделиями!';
export function isConfirmedProjectDelete(value:unknown,input:ProjectDeleteInput){
 if(!value||typeof value!=='object')return false;const ack=value as Record<string,unknown>;
 if(ack.ok!==true||ack.projectId!==input.projectId||ack.clientMutationId!==input.clientMutationId||typeof ack.deletedAt!=='string'||!Array.isArray(ack.affectedProductIds)||!ack.affectedProductIds.every(id=>typeof id==='string'))return false;
 const date=new Date(ack.deletedAt);return Number.isFinite(date.getTime())&&date.toISOString()===ack.deletedAt;
}
