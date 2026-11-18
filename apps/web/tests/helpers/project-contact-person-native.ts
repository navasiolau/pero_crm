import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Client, Prisma } from '@prisma/client';
import type { DomainActor } from '../../src/server/actor';
import { createClientInTransaction, updateClientInTransaction, clientFields, type ClientBaseline, type ClientInput } from '../../src/server/clients/core';
import { createProjectInTransaction } from '../../src/server/projects/core';
import { createProposalInTransaction } from '../../src/server/kp/proposal-core';
import { patchProjectCore } from '../../src/server/projects/project-field-core';
import { getProjectContactProjection } from '../../src/server/projects/contact-projection';
import type { ProjectPatch } from '../../src/server/projects/patch-contract';
import type { TaskTransaction } from '../../src/server/tasks/transaction';
import { parseJournalPresentation } from '../../src/server/changelog/presentation';

const baseline = (client: Client) => Object.fromEntries(clientFields.map(field => [field, client[field]])) as ClientBaseline;
const clientInput = (client: Client): ClientInput => ({ name: client.name, phone: client.phone,
  lastName: client.lastName ?? undefined, middleName: client.middleName ?? undefined, email: client.email ?? undefined,
  address: client.address ?? undefined, comment: client.comment ?? undefined, passportNumber: client.passportNumber ?? undefined,
  passportIssuedBy: client.passportIssuedBy ?? undefined, isContactPerson: client.isContactPerson });

/** Только внутри guarded rollback-транзакции; затрагивает лишь созданные здесь записи. */
export async function verifyProjectContactPersonNative(tx: Prisma.TransactionClient, actor: DomainActor) {
  assert.ok(!('$transaction' in tx), 'ROLLBACK_TRANSACTION_REQUIRED');
  const transaction: TaskTransaction = async operation => operation(tx);
  const prefix = `qa235-${randomUUID()}`;
  const created = await createClientInTransaction(tx, actor, { name: 'Иван', lastName: prefix, middleName: 'Иванович', phone: 'QA235' });
  assert.ok(created.ok);
  const other = await createClientInTransaction(tx, actor, { name: 'Мария', lastName: 'Тестовая', phone: 'QA235B', isContactPerson: true });
  assert.ok(other.ok);
  const getClient = () => tx.client.findUniqueOrThrow({ where: { id: created.id } });
  const getContact = async (id: string) => (await tx.project.findUniqueOrThrow({ where: { id } })).contactPerson;
  const update = async (input: Partial<ClientInput>) => {
    const current = await getClient();
    return updateClientInTransaction(tx, actor, current.id, { ...clientInput(current), ...input }, baseline(current));
  };
  const patch = (input: Omit<Extract<ProjectPatch, { field: 'contactPerson' }>, 'clientMutationId'> | Omit<Extract<ProjectPatch, { field: 'clientId' }>, 'clientMutationId'>) =>
    patchProjectCore(actor, { ...input, clientMutationId: randomUUID() }, transaction);
  assert.equal((await getClient()).isContactPerson, false);
  const empty = (await createProjectInTransaction(tx, actor, { title: `${prefix}-empty`, clientId: created.id })).project;
  const manual = (await createProjectInTransaction(tx, actor, { title: `${prefix}-manual`, clientId: created.id })).project;
  const deleted = (await createProjectInTransaction(tx, actor, { title: `${prefix}-deleted`, clientId: created.id })).project;
  assert.equal(empty.contactPerson, null);
  assert.equal((await patch({ projectId: manual.id, field: 'contactPerson', value: '  Представитель  ', expectedValue: null, expectedClientId: created.id })).kind, 'saved');
  assert.equal(await getContact(manual.id), 'Представитель');
  await tx.project.update({ where: { id: deleted.id }, data: { deletedAt: new Date(), deletedById: actor.id } });

  assert.ok((await update({ isContactPerson: true })).ok);
  const originalName = `${prefix} Иван Иванович`;
  assert.equal(await getContact(empty.id), originalName);
  assert.equal(await getContact(manual.id), 'Представитель');
  assert.equal(await getContact(deleted.id), null);
  const autoLog = await tx.changeLog.findFirstOrThrow({ where: { entityId: empty.id, field: 'contactPerson', action: 'update' } });
  const presentation = parseJournalPresentation(autoLog.presentation);
  assert.equal(presentation?.actor.type, 'system');
  assert.equal(presentation?.initiator?.id, actor.id);
  assert.match(presentation?.reason ?? '', /контактным лицом/);
  assert.equal(presentation?.changes[0]?.label, 'Контактное лицо');

  const temporary = await createClientInTransaction(tx, actor, { name: 'Временный', phone: 'QA235TEMP' });
  assert.ok(temporary.ok);
  const proposal = await createProposalInTransaction(tx, actor, { operationId: randomUUID(), clientId: other.id,
    state: { order: { project: `${prefix}-proposal` }, items: [] } }, { applyPricing: async () => {}, environment: { PERO_KP_TEMP_CLIENT_ID: temporary.id } });
  assert.equal(await getContact(proposal.result.projectId), 'Тестовая Мария');
  const flaggedProject = (await createProjectInTransaction(tx, actor, { title: `${prefix}-flagged`, clientId: other.id })).project;
  assert.equal(flaggedProject.contactPerson, 'Тестовая Мария');

  assert.ok((await update({ name: 'Пётр' })).ok);
  assert.equal(await getContact(empty.id), originalName);
  const clear = { projectId: empty.id, field: 'contactPerson' as const, value: null, expectedValue: originalName, expectedClientId: created.id, clientMutationId: randomUUID() };
  assert.equal((await patchProjectCore(actor, clear, transaction)).kind, 'saved');
  const eventsAfterClear = await tx.domainEvent.count();
  const logsAfterClear = await tx.changeLog.count();
  const replay = await patchProjectCore(actor, clear, transaction);
  assert.ok(replay.kind === 'saved' && replay.repeated);
  assert.equal(await tx.domainEvent.count(), eventsAfterClear);
  assert.equal(await tx.changeLog.count(), logsAfterClear);
  assert.ok((await update({ comment: 'Прочий реквизит' })).ok);
  assert.equal(await getContact(empty.id), null);
  assert.ok((await update({ isContactPerson: false })).ok);
  assert.equal(await getContact(manual.id), 'Представитель');

  const switchRequest = { projectId: manual.id, field: 'clientId' as const, value: other.id, expectedValue: created.id, clientMutationId: randomUUID() };
  const switched = await patchProjectCore(actor, switchRequest, transaction);
  assert.ok(switched.kind === 'saved');
  assert.equal(switched.derived?.contactPerson, 'Тестовая Мария');
  assert.equal(await getContact(manual.id), 'Тестовая Мария');
  const switchAudit = await tx.changeLog.findFirstOrThrow({ where: { entityId: manual.id, field: 'clientId', action: 'update' } });
  assert.ok(parseJournalPresentation(switchAudit.presentation)?.changes.some(change => change.path === 'contactPerson'));
  assert.equal((await patch({ projectId: manual.id, field: 'contactPerson', value: 'Чужой ввод', expectedValue: 'Тестовая Мария', expectedClientId: created.id })).kind, 'conflict');
  assert.equal((await patch({ projectId: manual.id, field: 'contactPerson', value: 'Чужой ввод', expectedValue: 'Старое значение', expectedClientId: other.id })).kind, 'conflict');
  assert.equal((await patch({ projectId: manual.id, field: 'contactPerson', value: 'Новый представитель', expectedValue: 'Тестовая Мария', expectedClientId: other.id })).kind, 'saved');
  assert.equal((await patch({ projectId: manual.id, field: 'clientId', value: other.id, expectedValue: other.id })).kind, 'saved');
  assert.equal(await getContact(manual.id), 'Новый представитель');
  assert.equal((await patch({ projectId: manual.id, field: 'clientId', value: created.id, expectedValue: other.id })).kind, 'saved');
  assert.equal(await getContact(manual.id), null);
  const projection = await getProjectContactProjection(actor, manual.id, transaction);
  assert.equal(projection?.contactPerson, null);
  assert.equal(projection?.clientId, created.id);
  assert.match(projection?.clientVersion ?? '', /^\d+$/);

  const oldInput = clientInput(await getClient()); delete oldInput.isContactPerson;
  assert.ok((await update({ isContactPerson: true })).ok);
  const current = await getClient();
  assert.ok((await updateClientInTransaction(tx, actor, current.id, { ...oldInput, comment: 'Старый вызов' }, baseline(current))).ok);
  assert.equal((await getClient()).isContactPerson, true);
  assert.ok((await update({ isContactPerson: false })).ok);
  const stale = await getClient();
  assert.ok((await update({ isContactPerson: true })).ok);
  assert.equal((await updateClientInTransaction(tx, actor, stale.id, { ...clientInput(stale), isContactPerson: true }, baseline(stale))).ok, false);

  const eventCount = await tx.domainEvent.count(), auditCount = await tx.changeLog.count();
  for (const roles of [['ENGINEER'], ['ACCOUNTANT'], ['WORKER'], ['MOUNTER']] as DomainActor['roles'][]) {
    const denied = { ...actor, roles };
    assert.equal((await createClientInTransaction(tx, denied, { name: prefix, phone: 'QA235', isContactPerson: true })).ok, false);
    assert.equal((await updateClientInTransaction(tx, denied, current.id, clientInput(current), baseline(current))).ok, false);
    assert.equal((await patchProjectCore(denied, clear, transaction)).kind, 'forbidden');
  }
  assert.equal(await tx.domainEvent.count(), eventCount);
  assert.equal(await tx.changeLog.count(), auditCount);

  await update({ isContactPerson: false });
  await patch({ projectId: empty.id, field: 'contactPerson', value: null, expectedValue: await getContact(empty.id), expectedClientId: created.id });
  const beforeFailure = await getClient(), beforeAudit = await tx.changeLog.count();
  const faulty = new Proxy(tx, { get(target, key) {
    if (key !== 'changeLog') return Reflect.get(target, key);
    return new Proxy(target.changeLog, { get(delegate, method) {
      if (method !== 'create') return Reflect.get(delegate, method);
      return async (args: Prisma.ChangeLogCreateArgs) => {
        if (args.data.entity === 'project' && args.data.field === 'contactPerson') throw Error('QA235_AUDIT_FAILURE');
        return delegate.create(args);
      };
    } });
  } });
  await tx.$executeRawUnsafe('SAVEPOINT qa235_audit');
  try { await assert.rejects(() => updateClientInTransaction(faulty, actor, beforeFailure.id,
    { ...clientInput(beforeFailure), isContactPerson: true }, baseline(beforeFailure)), /QA235_AUDIT_FAILURE/); }
  finally { await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT qa235_audit'); await tx.$executeRawUnsafe('RELEASE SAVEPOINT qa235_audit'); }
  assert.deepEqual(await getClient(), beforeFailure);
  assert.equal(await getContact(empty.id), null);
  assert.equal(await tx.changeLog.count(), beforeAudit);
  return { creation: true, proposalCreation: true, fillEmptyOnly: true, preserveDeleted: true, manualClear: true, snapshotName: true,
    switchClient: true, noOpSelection: true, casAndReplay: true, roleBoundary: true, oldInputCompatibility: true, realAuditRollback: true };
}
