import {auth} from '@/auth';
import {redirect} from 'next/navigation';
import {MANAGER_ROLES,hasAnyRole} from '@/lib/roles';
import {prisma} from '@/lib/prisma';
import {readProductPercentageDefaults} from '@/server/product-percentage-defaults/core';
import {PercentageDefaultsForm} from './percentage-defaults-form';
export default async function ProductPercentageSettingsPage(){
 const session=await auth();if(!session?.user||!hasAnyRole(session.user.roles,MANAGER_ROLES))redirect('/');
 const initial=await readProductPercentageDefaults(prisma);
 return <div className="mx-auto flex w-full max-w-2xl flex-col gap-6"><div><h1 className="text-2xl font-semibold">Проценты новых изделий</h1><p className="mt-2 text-muted-foreground">Эти ставки подставляются при создании изделия. Настройки существующих изделий и начисления не меняются.</p></div><PercentageDefaultsForm initial={initial}/></div>;
}
