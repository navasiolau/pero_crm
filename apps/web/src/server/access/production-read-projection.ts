import FurnitureSpecifications from "@pero/kp-template/furniture-specifications";
import type {PrismaClient} from '@prisma/client';
import {canViewProductMoney} from '@/lib/product-financial-access';
import type { VisibilityActor } from './visibility';

/** Запрос уже проверил видимость изделия. Его характеристики доступны вместе с карточкой. */
export function maskProductionRead<T extends { id: string; technicalSpecifications?: unknown }>(
  actor: VisibilityActor,
  rows: T[],
) {
  const showMoney = canViewProductMoney(actor.roles);
  return rows.map(({ technicalSpecifications, ...row }) => {
    const product = { ...row, technicalSpecifications: FurnitureSpecifications.normalizeProduct(technicalSpecifications) };
    return showMoney ? product : { ...product, expectedPrice: null, initialPrice: null };
  });
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
