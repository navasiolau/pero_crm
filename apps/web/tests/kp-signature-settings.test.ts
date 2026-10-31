import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { saveSignatureSettings } from '../src/server/kp/signature-settings';
import { INITIAL_SIGNATURE } from '@/server/kp/signature-defaults';
import { canAccessSettingsPath } from '../src/lib/settings-access';

test('настройки КП доступны только ADMIN, включая прямую ссылку', () => {
  for (const path of ['/settings/kp', '/settings/kp/', '/settings/kp/signature']) {
    assert.equal(canAccessSettingsPath(['ADMIN'], path), true);
    assert.equal(canAccessSettingsPath(['DIRECTOR'], path), false);
    assert.equal(canAccessSettingsPath(['MANAGER'], path), false);
  }
});

test('ADMIN: настройка, CAS, аудит, replay UUID и сохранность прежнего снимка', async () => {
  let row: { value: string } | null = null;
  const logs = new Map<string, Record<string, unknown>>();
  const tx = { orgSetting: { findUnique: async () => row, upsert: async (input: { create: { value: string }; update: { value: string } }) => { row = { value: input.update.value }; } },
    changeLog: { findUnique: async ({ where }: { where: { id: string } }) => logs.get(where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> & { id: string } }) => { logs.set(data.id, data); } } } as unknown as Prisma.TransactionClient;
  const actor = { id: 'admin', name: 'Администратор', roles: ['ADMIN' as const], source: 'web' as const };
  const command = { operationId: randomUUID(), expectedRevision: 0, values: { ...INITIAL_SIGNATURE.values, warrantyMonths: 24 } };
  const denied = await saveSignatureSettings(tx, { ...actor, roles: ['DIRECTOR'] }, command);
  assert.equal(denied.ok, false); assert.equal(row, null); assert.equal(logs.size, 0);
  const saved = await saveSignatureSettings(tx, actor, command); assert.ok(saved.ok);
  assert.equal(saved.snapshot.revision, 1); assert.match(saved.snapshot.values.footer, /24 месяца/); assert.equal(logs.size, 1);
  const repeated = await saveSignatureSettings(tx, actor, command); assert.ok(repeated.ok); assert.equal(repeated.repeated, true); assert.equal(logs.size, 1);
  const conflict = await saveSignatureSettings(tx, actor, { ...command, operationId: randomUUID(), values: { ...command.values, managerName: 'Другой' } });
  assert.equal(conflict.ok, false); assert.equal(logs.size, 1);
  if (!conflict.ok) assert.equal(conflict.current?.revision, 1);
  assert.equal(INITIAL_SIGNATURE.values.warrantyMonths, 12);
});
