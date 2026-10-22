import type {PrismaClient} from '@prisma/client';
import {hasAnyRole,FIELD_ROLES} from '@/lib/roles';
import {canViewProductMoney} from '@/lib/product-financial-access';
import {assignedProductVisibilityWhere,engineeringGlobalReadWhere,hasFullProjectVisibility,type VisibilityActor} from './visibility';
/** Стоимость закрыта всем исполнителям; неназначенному полю закрыт и техблок. */
export async function maskProductionRead<T extends {id:string}>(db:Pick<PrismaClient,'product'>,actor:VisibilityActor,rows:T[]):Promise<T[]> {
 if(!rows.length)return rows;
 const money=canViewProductMoney(actor.roles);
 const restrictTechnical=hasAnyRole(actor.roles,FIELD_ROLES)&&!hasFullProjectVisibility(actor);
 const assigned=restrictTechnical?await db.product.findMany({where:{AND:[{id:{in:rows.map(row=>row.id)}},{OR:[assignedProductVisibilityWhere(actor),engineeringGlobalReadWhere(actor)]}]},select:{id:true}}):[];
 const ids=new Set(assigned.map(row=>row.id));
 return rows.map(row=>({...row,...(!money?{expectedPrice:null,initialPrice:null}:{}),...(restrictTechnical&&!ids.has(row.id)?{description:null}:{} )}));
}

export async function maskProductionWorkRead<T extends {id:string}>(db:Pick<PrismaClient,'work'>,actor:VisibilityActor,rows:T[]):Promise<T[]> {
 if(!rows.length||canViewProductMoney(actor.roles))return rows;
 const assigned=await db.work.findMany({where:{id:{in:rows.map(row=>row.id)},tasks:{some:{assigneeId:actor.id}}},select:{id:true}});
 const ids=new Set(assigned.map(row=>row.id));
 return rows.map(row=>ids.has(row.id)?row:{...row,priceSnapshot:null,total:null,stagePayPoolId:null,poolWeightUnits:null});
}

export function maskTaskPaymentRead<T extends {assigneeId:string|null;work?:{priceSnapshot?:unknown;total?:unknown}|null}>(actor:VisibilityActor,rows:T[]):T[]{
 if(canViewProductMoney(actor.roles))return rows;
 return rows.map(row=>row.assigneeId===actor.id?row:{...row,shareAmount:null,work:row.work?{...row.work,priceSnapshot:null,total:null}:row.work});
}
