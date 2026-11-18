import type { Client, Prisma } from '@prisma/client';
import type { DomainActor } from '@/server/actor';
import { liveProjectWhere } from '@/server/access/live-entities';
import { writeChangeLogInTransaction } from '@/server/changelog/writer';
import { automationJournalContext, projectJournalContext } from './journal';

type ContactPersonClient = Pick<Client, 'id' | 'name' | 'lastName' | 'middleName'> & { isContactPerson?: boolean };

export function projectContactPersonForClient(client: Omit<ContactPersonClient, 'id'>): string | null {
  return client.isContactPerson
    ? [client.lastName, client.name, client.middleName].map(part => part?.trim()).filter(Boolean).join(' ') || null
    : null;
}

/** Вызывается только при включении галочки, внутри общего координатора мутаций. */
export async function fillEmptyProjectContactPersons(tx: Prisma.TransactionClient, actor: DomainActor, client: ContactPersonClient) {
  const contactPerson = projectContactPersonForClient(client);
  if (!contactPerson) return [];
  const projects = await tx.project.findMany({
    where: { ...liveProjectWhere, clientId: client.id, contactPerson: null },
    select: { id: true, number: true }, orderBy: { id: 'asc' },
  });
  const affectedProjectIds: string[] = [];
  for (const project of projects) {
    const updated = await tx.project.updateMany({
      where: { ...liveProjectWhere, id: project.id, clientId: client.id, contactPerson: null }, data: { contactPerson },
    });
    if (!updated.count) continue;
    await writeChangeLogInTransaction(tx, {
      actorType: 'user', actorId: actor.id, actorName: actor.name, source: actor.source,
      entity: 'project', entityId: project.id, action: 'update', field: 'contactPerson',
      oldValue: { contactPerson: null }, newValue: { contactPerson },
    }, { ...projectJournalContext(project), ...automationJournalContext(actor, 'Клиент отмечен контактным лицом'),
      links: [{ type: 'client', id: client.id, label: contactPerson }] });
    await tx.domainEvent.create({ data: { type: 'project.updated', actor: actor.id, payload: { projectId: project.id, field: 'contactPerson' } } });
    affectedProjectIds.push(project.id);
  }
  return affectedProjectIds;
}
