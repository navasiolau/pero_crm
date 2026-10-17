import type { Prisma } from "@prisma/client";
import { DEFAULT_CASH_ACCOUNT_MANAGE_ROLES } from "@/lib/cash-account-default";
import { hasAnyRole, FINANCE_ROLES } from "@/lib/roles";
import type { DomainActor } from "@/server/actor";
import {
  DEFAULT_CASH_ACCOUNT_KEY, EMPTY_DEFAULT_CASH_ACCOUNT, defaultCashAccountSnapshotSchema,
  defaultCashAccountPatchSchema, type DefaultCashAccountResult, type DefaultCashAccountSnapshot,
} from "./default-cash-contracts";

type SettingsReader = Pick<Prisma.TransactionClient, "orgSetting">;
export async function readDefaultCashAccount(db: SettingsReader): Promise<DefaultCashAccountSnapshot> {
  const row = await db.orgSetting.findUnique({ where: { key: DEFAULT_CASH_ACCOUNT_KEY }, select: { value: true } });
  if (!row) return { ...EMPTY_DEFAULT_CASH_ACCOUNT };
  try { return defaultCashAccountSnapshotSchema.parse(JSON.parse(row.value)); }
  catch { throw Error("Проверьте настройку кассы по умолчанию"); }
}

export function markDefaultCashAccount<T extends { id: string; active?: boolean }>(accounts: readonly T[], accountId: string | null): (T & { isDefault: boolean })[] {
  return accounts.map(account => ({ ...account, isDefault: account.active !== false && account.id === accountId }));
}

export async function listActiveCashAccountOptions(db: SettingsReader & Pick<Prisma.TransactionClient, "cashAccount">, orderBy: "createdAt" | "name" = "createdAt") {
  const [accounts, setting] = await Promise.all([
    db.cashAccount.findMany({ where: { active: true }, select: { id: true, name: true, currency: true }, orderBy: { [orderBy]: "asc" } }),
    readDefaultCashAccount(db),
  ]);
  return markDefaultCashAccount(accounts, setting.accountId);
}

async function writeDefaultCashAccount(actor: DomainActor, current: DefaultCashAccountSnapshot, accountId: string | null, tx: Prisma.TransactionClient) {
  const snapshot = { revision: current.revision + 1, accountId };
  const value = JSON.stringify(snapshot);
  await tx.orgSetting.upsert({ where: { key: DEFAULT_CASH_ACCOUNT_KEY }, create: { key: DEFAULT_CASH_ACCOUNT_KEY, value }, update: { value } });
  await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "orgSetting", entityId: DEFAULT_CASH_ACCOUNT_KEY, action: "default-cash.update", oldValue: current, newValue: snapshot } });
  return snapshot;
}

/** Вызывать только внутри общей денежной транзакции: тот же lock защищает active кассы и setting. */
export async function saveDefaultCashAccount(actor: DomainActor, input: unknown, tx: Prisma.TransactionClient): Promise<DefaultCashAccountResult> {
  if (!hasAnyRole(actor.roles, DEFAULT_CASH_ACCOUNT_MANAGE_ROLES)) return { ok: false, kind: "forbidden", error: "Недостаточно прав" };
  const parsed = defaultCashAccountPatchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, kind: "validation", error: "Проверьте выбранную кассу" };
  const current = await readDefaultCashAccount(tx);
  if (parsed.data.expectedRevision !== current.revision) return { ok: false, kind: "conflict", error: "Касса по умолчанию изменена другим пользователем", current };
  if (parsed.data.accountId) {
    const account = await tx.cashAccount.findUnique({ where: { id: parsed.data.accountId }, select: { active: true } });
    if (!account?.active) return { ok: false, kind: "validation", error: "Выберите активную кассу" };
  }
  if (current.accountId === parsed.data.accountId) return { ok: true, snapshot: current };
  return { ok: true, snapshot: await writeDefaultCashAccount(actor, current, parsed.data.accountId, tx) };
}

/** Деактивация и снятие назначения, включая оба audit, атомарны под тем же общим lock. */
export async function toggleCashAccountCore(actor: DomainActor, accountId: string, tx: Prisma.TransactionClient) {
  if (!hasAnyRole(actor.roles, FINANCE_ROLES)) return { ok: false as const, error: "Недостаточно прав" };
  const account = await tx.cashAccount.findUnique({ where: { id: accountId }, select: { active: true } });
  if (!account) return { ok: false as const, error: "Касса не найдена" };
  const current = await readDefaultCashAccount(tx);
  await tx.cashAccount.update({ where: { id: accountId }, data: { active: !account.active } });
  if (account.active && current.accountId === accountId) await writeDefaultCashAccount(actor, current, null, tx);
  await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "cashAccount", entityId: accountId, action: "update", field: "active", oldValue: account.active, newValue: !account.active } });
  return { ok: true as const };
}
