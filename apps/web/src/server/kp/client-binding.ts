import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import type { Client, Prisma } from '@prisma/client';
import type { DomainActor } from '@/server/actor';
import { bindProposalClient } from './proposal-client';
import { canonicalProposalJson, proposalObject, type ProposalState } from './proposal-contract';
import {automationJournalContext,proposalJournalContext} from '@/server/projects/journal';

/** Вызывается под общим mutation lock и блокировкой Project, до завершения смены клиента. */
export async function synchronizeProposalClient(tx: Prisma.TransactionClient, actor: DomainActor, projectId: string, client: Client, operationRootId?: string) {
  const proposal = await tx.commercialProposal.findFirst({ where: { projectId, deletedAt: null } });
  if (!proposal) return;
  if (!Array.isArray(proposalObject(proposal.state).items)) throw Error('Некорректный состав КП');
  const state = bindProposalClient(proposal.state as ProposalState, client, client.id === process.env.PERO_KP_TEMP_CLIENT_ID);
  state.client = { ...state.client as Prisma.JsonObject, name: client.id === process.env.PERO_KP_TEMP_CLIENT_ID ? '' : [client.lastName, client.name, client.middleName].filter(Boolean).join(' '), contact: client.id === process.env.PERO_KP_TEMP_CLIENT_ID ? '' : client.phone };
  if (proposal.clientId === client.id && canonicalProposalJson(proposal.state) === canonicalProposalJson(state)) return;
  await tx.commercialProposal.update({ where: { id: proposal.id }, data: { clientId: client.id, state, revision: { increment: 1 } } });
  await writeChangeLogInTransaction(tx, { actorType: 'user', actorId: actor.id, actorName: actor.name, source: actor.source,
    operationRootId, entity: 'commercialProposal', entityId: proposal.id, action: 'client.synchronize',
    oldValue: { clientId: proposal.clientId, revision: proposal.revision }, newValue: { clientId: client.id, revision: proposal.revision + 1, projectId } },
    {...proposalJournalContext(proposal.id,{id:projectId,number:typeof proposalObject(proposalObject(state).order).number==='string'?String(proposalObject(proposalObject(state).order).number):undefined}),
      ...automationJournalContext(actor,'Синхронизация клиента проекта с КП'),before:{clientId:proposal.clientId,state:proposal.state},after:{clientId:client.id,state}});
  const event = await tx.domainEvent.create({ data: { type: 'kp.updated', actor: actor.id, payload: { proposalId: proposal.id, projectId, revision: proposal.revision + 1 } } });
  return event?.id;
}
