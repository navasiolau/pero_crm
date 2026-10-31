import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { DomainActor } from '@/server/actor';
import { SIGNATURE_DEFAULTS_KEY, readSignatureDefaults, signatureValuesSchema, signatureFooterWithWarranty, type SignatureSnapshot } from '@/server/kp/signature-defaults';

const commandSchema = z.object({ operationId: z.uuid(), expectedRevision: z.number().int().nonnegative(), values: signatureValuesSchema }).strict();
export type SignatureSaveResult = { ok: true; snapshot: SignatureSnapshot; repeated?: boolean } | { ok: false; error: string; current?: SignatureSnapshot; unknownOutcome?: boolean };

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
  const changed = JSON.stringify(values) !== JSON.stringify(current.values);
  const snapshot = { revision: current.revision + Number(changed), values };
  if (changed) await tx.orgSetting.upsert({ where: { key: SIGNATURE_DEFAULTS_KEY }, create: { key: SIGNATURE_DEFAULTS_KEY, value: JSON.stringify(snapshot) }, update: { value: JSON.stringify(snapshot) } });
  const result: SignatureSaveResult = { ok: true, snapshot };
  await tx.changeLog.create({ data: { id: receiptId, actorType: 'user', actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: 'orgSetting', entityId: SIGNATURE_DEFAULTS_KEY, action: 'kp.signature-defaults.update', oldValue: current,
    newValue: { fingerprint, result } } });
  return result;
}
