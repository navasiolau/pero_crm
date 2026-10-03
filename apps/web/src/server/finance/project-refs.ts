import type {PrismaClient,Prisma,Role,ProjectStage} from '@prisma/client';
import {FINANCE_ROLES,hasAnyRole} from '@/lib/roles';
import {displayClientName} from '@/lib/labels';
import {prisma} from '@/lib/prisma';
export type FinanceWorkspaceActor={id:string;roles:Role[]};
export type FinanceProjectRef={id:string;number:string;title:string;currency:string;stage:ProjectStage;clientLabel:string};
export const financeProjectSelect={id:true,number:true,title:true,currency:true,stage:true,client:{select:{name:true,lastName:true,middleName:true}}} satisfies Prisma.ProjectSelect;
export function requireFinanceWorkspaceActor(actor:{roles:Role[]}){if(!hasAnyRole(actor.roles,FINANCE_ROLES))throw Error('Недостаточно прав для финансового проекта');}
const ref=(project:Prisma.ProjectGetPayload<{select:typeof financeProjectSelect}>):FinanceProjectRef=>({id:project.id,number:project.number,title:project.title,currency:project.currency,stage:project.stage,clientLabel:displayClientName(project.client)});
// Foundation54 supplies the live selectable predicate on normal integration.
// This branch currently has no deleted fields; historical financial lookup stays separate.
export function selectableFinanceProjectsWhere():Prisma.ProjectWhereInput{return{};}
export const financeProjectRefSelect={id:true,number:true,title:true,currency:true} satisfies Prisma.ProjectSelect;
/** Preserve the narrower reference API/bot contract introduced by task58. */
export async function listFinanceProjectRefs(actor:{roles:Role[]},query='',db:Pick<Prisma.TransactionClient,'project'>=prisma){
 requireFinanceWorkspaceActor(actor);const q=query.trim().slice(0,100);
 const rows=await db.project.findMany({where:{AND:[selectableFinanceProjectsWhere(),q?{OR:[{number:{contains:q}},{title:{contains:q,mode:'insensitive'}}]}:{}]},select:financeProjectRefSelect,orderBy:{numberInt:'desc'},take:100});
 return rows.map(row=>({id:row.id,number:row.number,title:row.title,currency:row.currency}));
}
export async function listFinanceWorkspaceProjects(actor:FinanceWorkspaceActor,db:Pick<PrismaClient,'project'>):Promise<FinanceProjectRef[]>{requireFinanceWorkspaceActor(actor);return(await db.project.findMany({where:selectableFinanceProjectsWhere(),select:financeProjectSelect,orderBy:{numberInt:'desc'}})).map(ref);}
export async function getFinanceProjectRef(actor:FinanceWorkspaceActor,identifier:string,db:Pick<PrismaClient,'project'>):Promise<FinanceProjectRef|null>{
 requireFinanceWorkspaceActor(actor);if(!/^[A-Za-z0-9_-]{1,128}$/.test(identifier))return null;
 const project=await db.project.findFirst({where:/^[1-9][0-9]*$/.test(identifier)?{number:identifier}:{id:identifier},select:financeProjectSelect});return project?ref(project):null;
}
