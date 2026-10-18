import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { canUseKpEditor } from '@/lib/kp-editor-access';

/** Текущие роли проверяются заново для страницы, iframe и каждого asset. */
export async function kpEditorSession() {
  if (process.env.PERO_KP_ENABLED !== '1') return null;
  const session = await auth(); if (!session?.user?.id) return null;
  const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, active: true, roles: true } });
  return actor && canUseKpEditor(actor, true) ? actor : null;
}
