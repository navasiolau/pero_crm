import type {Prisma} from '@prisma/client';
import {MANAGER_ROLES,hasAnyRole,hasRole} from '@/lib/roles';
import {resolveUploadContext} from './upload-context';
import type {VisibilityActor} from '@/server/access/visibility';
export async function mayDeleteStoredFile(tx:Prisma.TransactionClient,actor:VisibilityActor,file:{uploadedById:string|null;projectId:string;productId:string|null;taskId:string|null}):Promise<boolean>{
 if(file.uploadedById!==actor.id&&!hasAnyRole(actor.roles,MANAGER_ROLES))return false;
 if((hasRole(actor.roles,'ENGINEER')||actor.engineeringParticipantProductIds?.includes(file.productId??''))&&!hasAnyRole(actor.roles,MANAGER_ROLES))return !!await resolveUploadContext(tx,actor,file);
 return true;
}
