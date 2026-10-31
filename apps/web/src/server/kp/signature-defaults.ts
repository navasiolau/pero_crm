import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { proposalObject, type ProposalState } from './proposal-contract';

export const SIGNATURE_DEFAULTS_KEY = 'kp.signatureDefaults';
export const signatureValuesSchema = z.object({ managerName: z.string().max(2000), managerRole: z.string().max(2000), managerPhone: z.string().max(2000),
  warrantyMonths: z.number().int().min(1).max(1200), footer: z.string().max(10000) }).strict();
export const signatureSnapshotSchema = z.object({ revision: z.number().int().nonnegative(), values: signatureValuesSchema }).strict();
export type SignatureValues = z.infer<typeof signatureValuesSchema>;
export type SignatureSnapshot = z.infer<typeof signatureSnapshotSchema>;
export const INITIAL_SIGNATURE: SignatureSnapshot = { revision: 0, values: {
  managerName: 'Суботка Роман Петрович', managerRole: 'Директор', managerPhone: '+375 33 308-63-08', warrantyMonths: 12,
  footer: 'ООО «ПеРо Лайв» · УНП 291231014 · 225305 Брестская обл., г.Кобрин, ул.Железнодорожная, д.50 · Гарантия — 12 месяцев.' } };

export async function readSignatureDefaults(db: Pick<Prisma.TransactionClient, 'orgSetting'>): Promise<SignatureSnapshot> {
  const row = await db.orgSetting.findUnique({ where: { key: SIGNATURE_DEFAULTS_KEY }, select: { value: true } });
  if (!row) return structuredClone(INITIAL_SIGNATURE);
  try { return signatureSnapshotSchema.parse(JSON.parse(row.value)); }
  catch { throw Error('Проверьте настройки подписи и реквизитов КП'); }
}

/** Только создание, после проверки UUID. Явные пустые строки не заменяются defaults. */
export function initializeSignature(state: ProposalState, values: SignatureValues): ProposalState {
  const manager = proposalObject(state.manager);
  return { ...state, manager: { name: values.managerName, role: values.managerRole, phone: values.managerPhone, ...manager },
    ...(Object.hasOwn(state, 'warrantyMonths') ? {} : { warrantyMonths: values.warrantyMonths }),
    ...(Object.hasOwn(state, 'footer') ? {} : { footer: values.footer }) };
}

export function signatureFooterWithWarranty(footer: string, months: number): string {
  const tens = months % 100, last = months % 10;
  const unit = tens > 10 && tens < 20 ? 'месяцев' : last === 1 ? 'месяц' : last >= 2 && last <= 4 ? 'месяца' : 'месяцев';
  return footer.replace(/Гарантия\s*[—–-]\s*\d+\s*месяц(?:а|ев)?\.?/i, `Гарантия — ${months} ${unit}.`);
}
