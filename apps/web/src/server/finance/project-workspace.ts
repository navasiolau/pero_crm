import type {PrismaClient} from '@prisma/client';
import {getFinanceProjectRef,requireFinanceWorkspaceActor,type FinanceWorkspaceActor} from './project-refs';
import type {ProjectEconomics} from './queries';
import type {PaymentRow} from '@/app/(app)/projects/[id]/finance-tab';
export async function loadFinanceProjectWorkspace(actor:FinanceWorkspaceActor,identifier:string,db:Pick<PrismaClient,'project'|'payment'|'cashAccount'|'expenseArticle'|'user'>,getEconomics:(projectId:string)=>Promise<ProjectEconomics|null>){
 requireFinanceWorkspaceActor(actor);const project=await getFinanceProjectRef(actor,identifier,db);if(!project)return null;
 const[economics,records,cashAccounts,expenseArticles]=await Promise.all([getEconomics(project.id),db.payment.findMany({where:{projectId:project.id},select:{id:true,direction:true,amount:true,currency:true,rate:true,bynAmount:true,projectAmount:true,paidAt:true,comment:true,createdById:true,cashAccount:{select:{name:true}},expenseArticle:{select:{name:true}}},orderBy:{paidAt:'desc'}}),db.cashAccount.findMany({where:{active:true},select:{id:true,name:true,currency:true},orderBy:{createdAt:'asc'}}),db.expenseArticle.findMany({where:{active:true},select:{id:true,name:true},orderBy:{createdAt:'asc'}})]);
 if(!economics)return null;
 const ids=[...new Set(records.map(row=>row.createdById).filter((id):id is string=>id!==null))];const people=ids.length?await db.user.findMany({where:{id:{in:ids}},select:{id:true,name:true}}):[];const names=new Map(people.map(person=>[person.id,person.name]));
 const payments:PaymentRow[]=records.map(row=>({id:row.id,direction:row.direction,amount:row.amount.toNumber(),currency:row.currency,rate:row.rate.toNumber(),bynAmount:row.bynAmount.toNumber(),projectAmount:row.projectAmount.toNumber(),paidAt:row.paidAt.toISOString(),comment:row.comment,cashAccountName:row.cashAccount?.name??null,expenseArticleName:row.expenseArticle?.name??null,createdByName:row.createdById?names.get(row.createdById)??null:null}));
 return{project,economics:{expectedPrice:economics.expectedPrice,paidTotal:economics.paidTotal,expensesTotal:economics.expensesTotal,payrollTotal:economics.payrollTotal,margin:economics.margin,marginAtFullPrice:economics.marginAtFullPrice,expenseBreakdown:economics.expenseBreakdown},unavailableReason:economics.unavailableReason,payments,cashAccounts,expenseArticles};
}
