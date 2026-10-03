import type {Prisma} from '@prisma/client';
import {FIELD_ROLES,OFFICE_WRITE_ROLES,MANAGER_ROLES,hasAnyRole} from '@/lib/roles';
import {resolveUploadContext} from './upload-context';
import type {VisibilityActor} from '@/server/access/visibility';
export async function mayDeleteStoredFile(tx:Prisma.TransactionClient,actor:VisibilityActor,file:{uploadedById:string|null;projectId:string;productId:string|null;taskId:string|null}):Promise<boolean>{
 if(!hasAnyRole(actor.roles,[...OFFICE_WRITE_ROLES,...FIELD_ROLES]))return false;
 if(file.uploadedById!==actor.id&&!hasAnyRole(actor.roles,MANAGER_ROLES))return false;
 if(!hasAnyRole(actor.roles,MANAGER_ROLES))return !!await resolveUploadContext(tx,actor,file);
 return true;
}
