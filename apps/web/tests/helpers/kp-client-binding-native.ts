import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaClient, ProjectStage } from '@prisma/client';
import { patchProjectContactInTransaction } from '../../src/server/projects/contact-core';
import { saveProposalInTransaction } from '../../src/server/kp/proposal-core';
import { getProjectContactProjection } from '../../src/server/projects/contact-projection';

/** Только существующая local5433. Все тестовые записи и события откатываются одной транзакцией. */
export async function runClientBindingNativeCases(database: PrismaClient, targetUrl: string) {
  const target = new URL(targetUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.port !== '5433' || target.pathname !== '/pero_crm') throw Error('LOCAL5433_GUARD_MISMATCH');
  const rollback = new Error('QA202_ROLLBACK'); let checked = 0;
  try {
    await database.$transaction(async tx => {
      const [identity] = await tx.$queryRaw<{ database: string; user: string }[]>`SELECT current_database() AS database,current_user AS "user"`;
      if (identity.database !== 'pero_crm' || identity.user !== 'pero') throw Error('DATABASE_IDENTITY_GUARD_MISMATCH');
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
      const token = randomUUID(), actor = { id: 'qa202_' + token, name: 'QA202', roles: ['MANAGER' as const], source: 'web' as const };
      await tx.user.create({ data: { id: actor.id, name: actor.name, email: token + '@example.invalid', passwordHash: 'INVALID-QA-LOGIN', roles: actor.roles } });
      const a = await tx.client.create({ data: { name: 'Клиент A QA202', phone: '+000202001' } });
      const b = await tx.client.create({ data: { name: 'Клиент B QA202', phone: '+000202002' } });
      const max = await tx.project.aggregate({ _max: { numberInt: true } }); let number = max._max.numberInt ?? 0;
      const stages: ProjectStage[] = ['LEAD','ESTIMATE','CONTRACT','IN_WORK','DONE','RECLAMATION','PAUSED','REFUSED'];
      for (const stage of stages) {
        number++;
        const project = await tx.project.create({ data: { id: 'qa202_' + token + stage, number: String(number), numberInt: number, title: 'QA202', clientId: a.id, stage } });
        const state = { items: [{ id: 'qa202-item', price: 123.45, qty: 2, name: 'Проверка сохранности' }], client: { name: a.name, contact: a.phone, crmId: a.id }, currency: 'BYN', order: { number: String(number) } };
        const proposal = await tx.commercialProposal.create({ data: { projectId: project.id, clientId: a.id, state, createdById: actor.id } });
        const pdf = await tx.proposalArtifact.create({ data: { proposalId: proposal.id, kind: 'PDF', state: 'READY', storageBinding: { endpoint: 'http://127.0.0.1:9000', bucket: 'qa202' }, key: 'kp/proposals/' + proposal.id + '/exports/qa202.pdf', size: 5, sha256: '0'.repeat(64), fileName: 'QA202.pdf', mimeType: 'application/pdf' } });
        const version = await tx.proposalVersion.create({ data: { proposalId: proposal.id, revision: 0, trigger: 'PDF', state, pricingSnapshot: {}, renderSnapshot: {}, templateVersion: 'QA202', pdfArtifactId: pdf.id, createdById: actor.id } });
        const changed = await patchProjectContactInTransaction(actor, { projectId: project.id, field: 'clientId', expectedValue: a.id, value: b.id }, tx);
        assert.equal(changed.ok, true, stage);
        const saved = await tx.commercialProposal.findUniqueOrThrow({ where: { id: proposal.id } });
        assert.equal(saved.clientId, b.id); assert.equal(saved.revision, 1);
        const projection = await getProjectContactProjection(actor, project.id, run => run(tx));
        assert.equal(projection?.clientId,b.id);assert.match(projection?.clientVersion??'',/^\d+$/);
        assert.deepEqual((saved.state as Record<string, unknown>).items, state.items);
        assert.equal((await tx.project.findUniqueOrThrow({ where: { id: project.id } })).stage, stage);
        assert.deepEqual((await tx.proposalVersion.findUniqueOrThrow({ where: { id: version.id } })).state, state);
        const stale = await patchProjectContactInTransaction(actor, { projectId: project.id, field: 'clientId', expectedValue: a.id, value: a.id }, tx);
        assert.equal(stale.ok, false);
        if (stage === 'LEAD') await assert.rejects(saveProposalInTransaction(tx, actor, { proposalId: proposal.id, expectedRevision: 0, operationId: randomUUID(), state, clientId: a.id }, { applyPricing: async () => {} }), /изменено/);
        assert.equal((await tx.commercialProposal.findUniqueOrThrow({ where: { id: proposal.id } })).clientId, b.id);
        assert.equal(await tx.changeLog.count({ where: { entityId: proposal.id, action: 'client.synchronize' } }), 1);
        checked++;
      }
      throw rollback;
    }, { maxWait: 5000, timeout: 20000 });
  } catch (error) { if (error !== rollback) throw error; }
  return { checkedStages: checked, rolledBack: true };
}
