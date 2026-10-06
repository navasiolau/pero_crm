import type {Role} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {hasAnyRole,FIELD_ROLES,MANAGER_ROLES} from '@/lib/roles';
import {liveProductWhere} from '@/server/access/live-entities';
export async function listWorkPriceOptions(actor:{id:string;roles:Role[]},productId:string) {
 const manager=hasAnyRole(actor.roles,MANAGER_ROLES);
  if(!manager&&!hasAnyRole(actor.roles,FIELD_ROLES))return[];
 const product=await prisma.product.findFirst({where:{...liveProductWhere,id:productId,...(!manager?{status:'PRODUCTION'}:{})},select:{id:true}});
 if(!product)return[];
 return prisma.priceItem.findMany({where:{active:true},select:{id:true,name:true,unit:true,price:true},orderBy:{name:'asc'}});
}
