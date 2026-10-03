import type {Prisma} from '@prisma/client';
import {fileVisibilityWhere,type VisibilityActor} from '../access/visibility';
export function projectCoverProjection(actor:VisibilityActor){return{where:fileVisibilityWhere(actor),select:{id:true,fileName:true,mimeType:true,hasThumb:true}} satisfies Prisma.Project$coverFileArgs;}
