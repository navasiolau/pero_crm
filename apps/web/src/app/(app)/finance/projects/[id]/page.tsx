import { PageHeader } from "@/components/page-header";
import {scopedFinanceAuth} from '@/server/telegram/finance-session';
import {notFound,redirect} from 'next/navigation';
import {FINANCE_ROLES,hasAnyRole} from '@/lib/roles';
import {prisma} from '@/lib/prisma';
import {loadFinanceProjectWorkspace} from '@/server/finance/project-workspace';
import {getProjectEconomics} from '@/server/finance/queries';
import {FinanceTab} from '@/app/(app)/projects/[id]/finance-tab';
export const dynamic='force-dynamic';
export default async function FinanceProjectPage({params}:{params:Promise<{id:string}>}){
 const session=await scopedFinanceAuth();if(!session?.user||!hasAnyRole(session.user.roles,FINANCE_ROLES))redirect('/');const{id}=await params;const workspace=await loadFinanceProjectWorkspace(session.user,id,prisma,(projectId,facts)=>getProjectEconomics(projectId,prisma,facts));if(!workspace)notFound();
 return <div className="flex min-w-0 flex-col gap-6">
   <PageHeader
     title={`Проект ${workspace.project.number} · ${workspace.project.title}`}
     description={<p className="wrap-anywhere text-base text-muted-foreground">Клиент: {workspace.project.clientLabel}</p>}
   />
   {workspace.unavailableReason?<p role="note" className="rounded-lg border p-3 text-sm text-muted-foreground">{workspace.unavailableReason}</p>:null}
   {workspace.project.projectArchived?<p role="note" className="rounded-lg border p-3 text-sm text-muted-foreground">Проект удалён. Финансовая история доступна только для просмотра; новые операции недоступны.</p>:null}
   <FinanceTab canEdit={!workspace.project.projectArchived} projectId={workspace.project.id} currency={workspace.project.currency} economics={workspace.economics} payments={workspace.payments} expenseRows={workspace.expenseRows} cashAccounts={workspace.cashAccounts} expenseArticles={workspace.expenseArticles}/>
 </div>;
}
