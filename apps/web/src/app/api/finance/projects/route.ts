import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {FINANCE_ROLES,hasAnyRole} from '@/lib/roles';
import {listFinanceProjectRefs} from '@/server/finance/project-refs';

export async function GET(request:Request){
 const session=await auth();if(!session?.user)return NextResponse.json({error:'Не авторизован'},{status:401});
 if(!hasAnyRole(session.user.roles,FINANCE_ROLES))return NextResponse.json({error:'Недостаточно прав'},{status:403});
 return NextResponse.json({projects:await listFinanceProjectRefs(session.user,new URL(request.url).searchParams.get('q')??'')});
}
