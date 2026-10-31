import type { DomainActor } from '@/server/actor';
import { MANAGER_ROLES, hasAnyRole } from '@/lib/roles';
import { withTaskTransaction, type TaskTransaction } from '@/server/tasks/transaction';
import { liveProjectWhere } from '@/server/access/live-entities';

/** Связь, контакты и версия читаются вместе под тем же lock, что использует запись. */
export async function getProjectContactProjection(actor: DomainActor, projectId: string, transaction: TaskTransaction = withTaskTransaction) {
  if (!hasAnyRole(actor.roles, MANAGER_ROLES)) return null;
  return transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { ...liveProjectWhere, id: projectId }, select: { clientId: true, client: { select: { phone: true, address: true } } } });
    if (!project) return null;
    const [version] = await tx.$queryRaw<{ clientVersion: string }[]>`SELECT txid_current()::text AS "clientVersion"`;
    return { clientId: project.clientId, 'client.phone': project.client.phone, 'client.address': project.client.address, clientVersion: version.clientVersion };
  });
}
