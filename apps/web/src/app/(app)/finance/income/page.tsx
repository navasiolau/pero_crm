import {auth} from '@/auth';
import {redirect} from 'next/navigation';
import {FINANCE_ROLES,hasAnyRole} from '@/lib/roles';
import {prisma} from '@/lib/prisma';
import {loadOrganizationIncome} from '@/server/finance/income-ledger';
import {IncomeLedgerView} from './income-ledger-view';
export const dynamic='force-dynamic';
export default async function IncomeLedgerPage(){const session=await auth();if(!session?.user||!hasAnyRole(session.user.roles,FINANCE_ROLES))redirect('/');const data=await loadOrganizationIncome(session.user,prisma);return <IncomeLedgerView {...data}/>;}
