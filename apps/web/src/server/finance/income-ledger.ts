import type {PrismaClient} from '@prisma/client';
import {requireFinanceWorkspaceActor,type FinanceWorkspaceActor,listFinanceWorkspaceProjects} from './project-refs';
export async function loadOrganizationIncome(actor:FinanceWorkspaceActor,db:Pick<PrismaClient,'project'|'payment'|'cashAccount'>){
 requireFinanceWorkspaceActor(actor);
 const [rows,cashAccounts,projects]=await Promise.all([db.payment.findMany({where:{direction:'INCOME'},select:{id:true,amount:true,currency:true,rate:true,rateDate:true,bynAmount:true,paidAt:true,comment:true,project:{select:{id:true,number:true,title:true}},cashAccount:{select:{name:true}}},orderBy:{paidAt:'desc'}}),db.cashAccount.findMany({where:{active:true},select:{id:true,name:true,currency:true},orderBy:{createdAt:'asc'}}),listFinanceWorkspaceProjects(actor,db)]);
 return{rows:rows.map(row=>({id:row.id,amount:row.amount.toNumber(),currency:row.currency,rate:row.rate.toNumber(),rateDate:row.rateDate?.toISOString()??null,bynAmount:row.bynAmount.toNumber(),paidAt:row.paidAt.toISOString(),comment:row.comment,project:row.project,cashName:row.cashAccount?.name??null})),cashAccounts,projects:projects.map(({id,number,title})=>({id,number,title}))};
}
