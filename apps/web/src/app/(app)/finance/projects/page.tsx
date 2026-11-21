import { PageHeader } from "@/components/page-header";
import {scopedFinanceAuth} from '@/server/telegram/finance-session';
import {redirect} from 'next/navigation';
import {FINANCE_ROLES,hasAnyRole} from '@/lib/roles';
import {prisma} from '@/lib/prisma';
import {listFinanceWorkspaceProjects} from '@/server/finance/project-refs';
import {FinanceProjectsView} from './finance-projects-view';
export const dynamic='force-dynamic';
export default async function FinanceProjectsPage() {
  const session = await scopedFinanceAuth();
  if (!session?.user || !hasAnyRole(session.user.roles, FINANCE_ROLES)) redirect('/');
  const projects = await listFinanceWorkspaceProjects(session.user, prisma);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Финансы проектов"
        description={<p className="text-base text-muted-foreground">Приходы, расходы и экономика. Общие реквизиты и технические данные здесь не редактируются.</p>}
      />
      <FinanceProjectsView projects={projects} />
    </div>
  );
}
