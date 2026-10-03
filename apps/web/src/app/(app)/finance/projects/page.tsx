import {auth} from '@/auth';
import {redirect} from 'next/navigation';
import {FINANCE_ROLES,hasAnyRole} from '@/lib/roles';
import {prisma} from '@/lib/prisma';
import {listFinanceWorkspaceProjects} from '@/server/finance/project-refs';
import {FinanceProjectsView} from './finance-projects-view';
export const dynamic='force-dynamic';
export default async function FinanceProjectsPage(){const session=await auth();if(!session?.user||!hasAnyRole(session.user.roles,FINANCE_ROLES))redirect('/');const projects=await listFinanceWorkspaceProjects(session.user,prisma);return <div className="flex min-w-0 flex-col gap-6"><div><h1 className="text-2xl font-semibold">Финансы проектов</h1><p className="text-muted-foreground">Приходы, расходы и экономика. Общие реквизиты и технические данные здесь не редактируются.</p></div><FinanceProjectsView projects={projects}/></div>;}
