import type {Prisma} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {FINANCE_ROLES,hasAnyRole,type Role} from '@/lib/roles';

export const financeProjectRefSelect={id:true,number:true,title:true,currency:true} satisfies Prisma.ProjectSelect;
/** Financial selection does not grant operational Project/Product payloads. */
export async function listFinanceProjectRefs(actor:{roles:Role[]},query='',db:Pick<Prisma.TransactionClient,'project'>=prisma){
 if(!hasAnyRole(actor.roles,FINANCE_ROLES))throw new Error('Недостаточно прав');
 const q=query.trim().slice(0,100);
 const rows=await db.project.findMany({where:q?{OR:[{number:{contains:q}},{title:{contains:q,mode:'insensitive'}}]}:{},select:financeProjectRefSelect,orderBy:{numberInt:'desc'},take:100});
 return rows.map(row=>({id:row.id,number:row.number,title:row.title,currency:row.currency}));
}
