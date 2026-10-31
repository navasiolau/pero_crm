import { PrismaClient } from '@prisma/client';
import { synchronizeProposalClient } from '../src/server/kp/client-binding';
import { assertClientReconciliationTarget } from '../src/server/kp/client-reconciliation-target';

/** По умолчанию только сверка. Применение — явное, с количеством и действующим ADMIN. */
async function main() {
  const args = process.argv.slice(2), target = args.find(value => value.startsWith('--target='))?.slice(9), apply = args.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  assertClientReconciliationTarget(target, url, apply);
  const db = new PrismaClient();
  try {
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
      const proposals = await tx.commercialProposal.findMany({ where: { deletedAt: null, project: { deletedAt: null } }, select: { id: true, clientId: true, project: { select: { id: true, clientId: true } } }, orderBy: { id: 'asc' } });
      const mismatches = proposals.filter(proposal => proposal.project && proposal.clientId !== proposal.project.clientId);
      const ids = mismatches.map(proposal => proposal.id);
      if (!apply) return { target, apply: false, count: ids.length, proposalIds: ids };
      const countArgument = args.find(value => value.startsWith('--expected-count='))?.slice(17);
      if (countArgument === undefined || !/^\d+$/.test(countArgument) || Number(countArgument) !== ids.length) throw Error('RECONCILIATION_COUNT_CHANGED');
      const actorId = args.find(value => value.startsWith('--actor-id='))?.slice(11);
      const actor = actorId ? await tx.user.findUnique({ where: { id: actorId } }) : null;
      if (!actor?.active || !actor.roles.includes('ADMIN')) throw Error('ADMIN_REQUIRED');
      for (const proposal of mismatches) {
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${proposal.project!.id} FOR UPDATE`;
        const project = await tx.project.findUniqueOrThrow({ where: { id: proposal.project!.id } });
        const client = await tx.client.findUniqueOrThrow({ where: { id: project.clientId } });
        await synchronizeProposalClient(tx, { id: actor.id, name: actor.name, roles: actor.roles, source: 'web' }, project.id, client);
      }
      return { target, apply: true, count: ids.length, proposalIds: ids };
    }, { maxWait: 5000, timeout: 60000 });
    console.log(JSON.stringify(result));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'CLIENT_RECONCILIATION_FAILED'); process.exitCode = 1; });
