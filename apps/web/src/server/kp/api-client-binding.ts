import { withMutationTransaction } from '@/server/transactions/coordinator';
import { patchProjectContactInTransaction } from '@/server/projects/contact-core';
import { apiFailure, type KpApiContext } from './api-contract';
import { runApiCommand } from './api-operation';
import { documentDto, loadApiDocument } from './api-documents';
import { revalidatePath } from 'next/cache';

export async function changeApiClient(context: KpApiContext, input: Record<string, unknown>) {
  const proposalId = String(input.proposalId);
  return runApiCommand({ context, scope: 'kp:write', kind: 'document.save', operationId: String(input.operationId), input,
    transaction: withMutationTransaction, mutate: async tx => {
      const before = await loadApiDocument(tx, proposalId);
      if (!before.project || before.project.deletedAt) return apiFailure('KP_NOT_FOUND', 404, 'КП не связано с действующим проектом');
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${before.project.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "CommercialProposal" WHERE id = ${proposalId} FOR UPDATE`;
      const current = await loadApiDocument(tx, proposalId);
      if (current.revision !== input.expectedRevision || current.project?.id !== before.project.id) return apiFailure('KP_REVISION_CHANGED', 409, 'Клиент или КП изменились. Обновите редактор');
      const result = await patchProjectContactInTransaction(context.actor, { projectId: before.project.id, field: 'clientId', value: String(input.clientId), expectedValue: String(input.expectedClientId) }, tx);
      if (!result.ok) return apiFailure('KP_CLIENT_CONFLICT', result.kind === 'conflict' ? 409 : result.kind === 'forbidden' ? 403 : 400, result.error);
      const document = documentDto(await loadApiDocument(tx, proposalId));
      return { entityId: proposalId, result: document, afterCommit: async () => {
        for (const path of ['/kp', '/kp/' + proposalId, '/projects', '/projects/' + before.project!.id]) revalidatePath(path);
      } };
    } });
}
