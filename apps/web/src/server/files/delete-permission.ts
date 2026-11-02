import type {Prisma} from '@prisma/client';
import {FIELD_ROLES,OFFICE_WRITE_ROLES,MANAGER_ROLES,hasAnyRole,hasRole} from '@/lib/roles';
import {resolveUploadContext} from './upload-context';
import type {VisibilityActor} from '@/server/access/visibility';
export async function mayDeleteStoredFile(tx:Prisma.TransactionClient,actor:VisibilityActor,file:{uploadedById:string|null;projectId:string;productId:string|null;taskId:string|null}):Promise<boolean>{
 if(!hasAnyRole(actor.roles,[...OFFICE_WRITE_ROLES,...FIELD_ROLES]))return false;
 if(hasAnyRole(actor.roles,MANAGER_ROLES))return true;
 if(file.uploadedById!==actor.id&&!hasRole(actor.roles,'ENGINEER'))return false;
 const context=await resolveUploadContext(tx,actor,file);
 return !!context&&(file.uploadedById===actor.id||context.canManageAnyFile);
}
