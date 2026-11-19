import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { DomainActor } from '@/server/actor';
import { SIGNATURE_DEFAULTS_KEY, readSignatureDefaults, signatureValuesSchema, signatureSnapshotSchema, signatureFooterWithWarranty, type SignatureSnapshot } from '@/server/kp/signature-defaults';

const commandSchema = z.object({ operationId: z.uuid(), expectedRevision: z.number().int().nonnegative(), values: signatureValuesSchema }).strict();
export type SignatureSaveResult = { ok: true; snapshot: SignatureSnapshot; repeated?: boolean } | { ok: false; error: string; current?: SignatureSnapshot; unknownOutcome?: boolean };

async function persistSignatureSnapshot(tx: Prisma.TransactionClient, snapshot: SignatureSnapshot) {
  const value = JSON.stringify(snapshot);
  await tx.orgSetting.upsert({ where: { key: SIGNATURE_DEFAULTS_KEY },
    create: { key: SIGNATURE_DEFAULTS_KEY, value }, update: { value } });
}

const changedElsewhere = 'Настройки подписи изменились после исходной операции';

export const signatureSettingsReversal = defineJournalReversal({
  kind: 'kp.signature-defaults',
  version: 1,
  schema: z.object({ expected: signatureSnapshotSchema, values: signatureValuesSchema }).strict(),
  async preview({ tx, entityId }, { expected }) {
    const actual = await readSignatureDefaults(tx);
    return entityId === SIGNATURE_DEFAULTS_KEY && JSON.stringify(actual) === JSON.stringify(expected)
      ? null : changedElsewhere;
  },
  async apply({ tx, entityId }, { expected, values }) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
    const current = await readSignatureDefaults(tx);
    if (entityId !== SIGNATURE_DEFAULTS_KEY || JSON.stringify(current) !== JSON.stringify(expected))
      throw new JournalReversalRefusal(changedElsewhere);
    const snapshot = { revision: current.revision + 1, values };
    await persistSignatureSnapshot(tx, snapshot);
    return { inverse: { expected: snapshot, values: current.values },
      oldValue: current.values, newValue: snapshot.values, cachePaths: ['/settings/kp'] };
  },
});

export async function saveSignatureSettings(tx: Prisma.TransactionClient, actor: DomainActor, input: unknown): Promise<SignatureSaveResult> {
  if (!actor.roles.includes('ADMIN')) return { ok: false, error: 'Недостаточно прав' };
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Проверьте поля подписи. Гарантия должна быть целым числом от 1 до 1200 месяцев' };
  const command = parsed.data, receiptId = 'kp-signature-defaults:' + command.operationId;
  const fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  const receipt = await tx.changeLog.findUnique({ where: { id: receiptId } });
  if (receipt) {
    const value = receipt.newValue as { fingerprint?: string; result?: SignatureSaveResult } | null;
    if (receipt.actorId !== actor.id || receipt.entityId !== SIGNATURE_DEFAULTS_KEY || value?.fingerprint !== fingerprint || !value.result?.ok) return { ok: false, error: 'Идентификатор операции уже использован' };
    return { ...value.result, repeated: true };
  }
  const current = await readSignatureDefaults(tx);
  if (command.expectedRevision !== current.revision) return { ok: false, error: 'Настройки изменены другим администратором. Загрузите актуальные значения', current };
  const values = { ...command.values, footer: signatureFooterWithWarranty(command.values.footer, command.values.warrantyMonths) };
  if (!signatureValuesSchema.safeParse(values).success) return { ok: false, error: 'Сократите текст подвала подписи' };
  const changed = JSON.stringify(values) !== JSON.stringify(current.values);
  const snapshot = { revision: current.revision + Number(changed), values };
  if (changed) await persistSignatureSnapshot(tx, snapshot);
  const result: SignatureSaveResult = { ok: true, snapshot };
  await writeChangeLogInTransaction(tx, { id: receiptId, actorType: 'user', actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: 'orgSetting', entityId: SIGNATURE_DEFAULTS_KEY, action: 'kp.signature-defaults.update', oldValue: current,
    ...(changed ? { reversal: signatureSettingsReversal.command({ expected: snapshot, values: current.values }) } : {}),
    newValue: { fingerprint, result } },{kind:changed?'event':'receipt',entity:{type:'orgSetting',id:SIGNATURE_DEFAULTS_KEY,label:'Подпись и условия КП'},before:current.values,after:values});
  return result;
}
