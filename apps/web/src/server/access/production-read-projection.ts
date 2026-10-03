import type {PrismaClient} from '@prisma/client';
import {hasAnyRole,hasRole,OFFICE_ROLES} from '@/lib/roles';
import {assignedWorkVisibilityWhere,assignedProductVisibilityWhere,hasFullProjectVisibility,type VisibilityActor} from './visibility';
/** Only the new unassigned production grant needs masking; existing union grants remain intact. */
export async function maskProductionRead<T extends {id:string}>(db:Pick<PrismaClient,'product'>,actor:VisibilityActor,rows:T[]):Promise<T[]> {
 if(!rows.length||!hasRole(actor.roles,'WORKER')||hasFullProjectVisibility(actor))return rows;
 const assigned=await db.product.findMany({where:{AND:[{id:{in:rows.map(row=>row.id)}},assignedProductVisibilityWhere(actor)]},select:{id:true}});
 const ids=new Set(assigned.map(row=>row.id));
 return rows.map(row=>ids.has(row.id)?row:{...row,description:null,initialPrice:null,...(!hasAnyRole(actor.roles,OFFICE_ROLES)?{expectedPrice:null}:{})});
}

export async function maskProductionWorkRead<T extends {id:string}>(db:Pick<PrismaClient,'work'>,actor:VisibilityActor,rows:T[]):Promise<T[]> {
 if(!rows.length||!hasRole(actor.roles,'WORKER')||hasFullProjectVisibility(actor))return rows;
 const assigned=await db.work.findMany({where:{AND:[{id:{in:rows.map(row=>row.id)}},assignedWorkVisibilityWhere(actor)]},select:{id:true}});
 const ids=new Set(assigned.map(row=>row.id));
 return rows.map(row=>ids.has(row.id)?row:{...row,priceSnapshot:null,total:null,stagePayPoolId:null,poolWeightUnits:null});
}
