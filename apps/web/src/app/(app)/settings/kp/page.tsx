import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { readSignatureDefaults } from '@/server/kp/signature-defaults';
import { SignatureDefaultsForm } from './signature-defaults-form';

export default async function KpSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { active: true, roles: true } });
  if (!user?.active || !user.roles.includes('ADMIN')) redirect('/');
  return <div className="mx-auto flex w-full max-w-2xl flex-col gap-6"><h1 className="text-2xl font-semibold">КП · Подпись и реквизиты</h1><p className="text-muted-foreground">Общие значения для новых коммерческих предложений. В каждом КП их можно изменить.</p><SignatureDefaultsForm initial={await readSignatureDefaults(prisma)} /></div>;
}
