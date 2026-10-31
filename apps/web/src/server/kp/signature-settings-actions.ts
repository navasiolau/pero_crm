'use server';
import { auth } from '@/auth';
import { withMutationTransaction } from '@/server/transactions/coordinator';
import { saveSignatureSettings, type SignatureSaveResult } from './signature-settings';
import { revalidatePath } from 'next/cache';

export async function saveSignatureSettingsAction(input: unknown): Promise<SignatureSaveResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Не авторизован' };
  try {
    const result = await withMutationTransaction(async tx => {
      const user = await tx.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, active: true, roles: true } });
      if (!user?.active || !user.roles.includes('ADMIN')) return { ok: false as const, error: 'Недостаточно прав' };
      return saveSignatureSettings(tx, { id: user.id, name: user.name, roles: user.roles, source: 'web' }, input);
    });
    if (result.ok) revalidatePath('/settings/kp');
    return result;
  } catch { return { ok: false, unknownOutcome: true, error: 'Сохранение не подтверждено. Повторите сохранение для проверки результата' }; }
}
