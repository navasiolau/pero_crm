import { Prisma, type ApiToken } from "@prisma/client";
import type { PluginManifest } from "@pero/plugin-sdk";
import { ADMIN_ROLES } from "@/lib/roles";
import { isWorkRatesOnly, WORK_RATES_SCOPE } from "@/lib/estimate-rates";
import { requireActorRoles, type DomainActor } from "@/server/actor";
import type { JournalChange } from "@/server/changelog/contract";
import { sanitizeJournalValue } from "@/server/changelog/presentation";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { hashToken, TOKEN_PREFIX } from "./token-verification";

const json = (value: unknown): Prisma.JsonValue => value == null ? null : JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
function canonical(value: unknown): string {
  const normalized = json(value);
  if (Array.isArray(normalized)) return `[${normalized.map(canonical).join(",")}]`;
  if (normalized !== null && typeof normalized === "object") return `{${Object.keys(normalized).sort().map(key => `${JSON.stringify(key)}:${canonical(normalized[key])}`).join(",")}}`;
  return JSON.stringify(normalized);
}

export async function togglePluginInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, manifest: Pick<PluginManifest, "id" | "name">, enabled: boolean) {
  requireActorRoles(actor, ADMIN_ROLES);
  await tx.$queryRaw`SELECT id FROM "Plugin" WHERE id = ${manifest.id} FOR UPDATE`;
  const before = await tx.plugin.findUnique({ where: { id: manifest.id } });
  if (!before) return { ok: false as const, error: "Модуль не найден" };
  if (before.enabled === enabled) return { ok: true as const, noOp: true, eventId: null };
  await tx.plugin.update({ where: { id: manifest.id }, data: { enabled } });
  await writeChangeLogInTransaction(tx, { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "plugin", entityId: manifest.id, action: "toggle", field: "enabled", oldValue: before.enabled, newValue: enabled }, {
    before: before.enabled, after: enabled, entity: { label: `Модуль ${manifest.name}`, href: `/settings/modules/${encodeURIComponent(manifest.id)}` },
  });
  const event = await tx.domainEvent.create({ data: { type: "plugin.toggled", payload: { pluginId: manifest.id, enabled }, actor: actor.id } });
  return { ok: true as const, noOp: false, eventId: event.id };
}

export async function savePluginSettingsInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, manifest: PluginManifest, values: Record<string, unknown>) {
  requireActorRoles(actor, ADMIN_ROLES);
  await tx.$queryRaw`SELECT id FROM "Plugin" WHERE id = ${manifest.id} FOR UPDATE`;
  const fields = manifest.settingsSchema ?? [], rows = await tx.pluginSetting.findMany({ where: { pluginId: manifest.id } });
  const stored = new Map(rows.map(row => [row.key, row.value]));
  const before = Object.fromEntries([...fields.filter(field => field.default !== undefined).map(field => [field.key, field.default]), ...rows.map(row => [row.key, row.value])]);
  const accepted = Object.fromEntries(fields.filter(field => Object.prototype.hasOwnProperty.call(values, field.key)).map(field => [field.key, json(values[field.key])]));
  const changedKeys = Object.keys(accepted).filter(key => !stored.has(key) || canonical(stored.get(key)) !== canonical(accepted[key]));
  if (!changedKeys.length) return { ok: true as const, noOp: true };
  const after = { ...before, ...accepted };
  for (const key of changedKeys) {
    const value = accepted[key] === null ? Prisma.JsonNull : accepted[key] as Prisma.InputJsonValue;
    await tx.pluginSetting.upsert({ where: { pluginId_key: { pluginId: manifest.id, key } }, create: { pluginId: manifest.id, key, value }, update: { value } });
  }
  const changes: JournalChange[] = [];
  for (const key of changedKeys) {
    const field = fields.find(candidate => candidate.key === key)!;
    const display = (value: unknown) => sanitizeJournalValue(typeof value === "string" ? field.options?.find(option => option.value === value)?.label ?? value : value, key);
    if (canonical(before[key]) !== canonical(after[key])) changes.push({ path: key, label: field.label, before: display(before[key]), after: display(after[key]),
      beforeKnown: stored.has(key) || field.default !== undefined, afterKnown: true });
    else if (!stored.has(key)) changes.push({ path: `${key}.configured`, label: `Задано явно: ${field.label}`, before: false, after: true, beforeKnown: true, afterKnown: true });
  }
  await writeChangeLogInTransaction(tx, { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source, entity: "plugin", entityId: manifest.id,
    action: "update", field: "settings", oldValue: sanitizeJournalValue(before), newValue: sanitizeJournalValue(after) }, {
    before, after, changes, entity: { label: `Модуль ${manifest.name}`, href: `/settings/modules/${encodeURIComponent(manifest.id)}` },
  });
  return { ok: true as const, noOp: false };
}

export interface ApiTokenCreationInput { name: string; scopes: string[]; pluginId?: string; createdById?: string }
export const apiTokenAuditSnapshot = (row: Pick<ApiToken, "name" | "prefix" | "scopes" | "pluginId" | "createdById" | "createdAt" | "revokedAt">) => ({
  name: row.name, prefix: row.prefix, scopes: row.scopes, pluginId: row.pluginId ?? null, createdById: row.createdById ?? null,
  createdAt: row.createdAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null,
});

export async function createApiTokenInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, input: ApiTokenCreationInput, token: string) {
  requireActorRoles(actor, ADMIN_ROLES);
  if (input.scopes.includes(WORK_RATES_SCOPE) && (!isWorkRatesOnly(input.scopes) || input.pluginId)) {
    throw new Error("Ключ оценщика должен иметь только право чтения сдельного прайса");
  }
  if (input.createdById) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.createdById} FOR UPDATE`;
  const row = await tx.apiToken.create({ data: { ...input, prefix: token.slice(0, TOKEN_PREFIX.length + 6), tokenHash: hashToken(token) } });
  const after = apiTokenAuditSnapshot(row);
  const creator = row.createdById ? row.createdById === actor.id ? { id: actor.id, name: actor.name }
    : await tx.user.findUnique({ where: { id: row.createdById }, select: { id: true, name: true } }) : null;
  await writeChangeLogInTransaction(tx, { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "apiToken", entityId: row.id, action: "create", newValue: after,
    reversal: { kind: "account.api-token-issue", version: 1, data: { createdAt: after.createdAt, mode: "revoke" } },
  }, {
    before: null, after, entity: { label: `Доступ API «${row.name}»`, href: "/settings/api" },
    ...(creator ? { links: [{ type: "user", id: creator.id, label: creator.name, href: "/settings/users" }] } : {}),
  });
  return { token, id: row.id };
}

export async function revokeApiTokenInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, tokenId: string, options?: { reversal: true }) {
  requireActorRoles(actor, ADMIN_ROLES);
  await tx.$queryRaw`SELECT id FROM "ApiToken" WHERE id = ${tokenId} FOR UPDATE`;
  const before = await tx.apiToken.findUnique({ where: { id: tokenId } });
  if (!before) return { ok: false as const, error: "Токен не найден" };
  if (before.revokedAt) return { ok: true as const, noOp: true };
  const after = await tx.apiToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
  if (options?.reversal) return { ok: true as const, noOp: false, before: apiTokenAuditSnapshot(before), after: apiTokenAuditSnapshot(after) };
  await writeChangeLogInTransaction(tx, { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "apiToken", entityId: tokenId, action: "revoke", oldValue: apiTokenAuditSnapshot(before), newValue: apiTokenAuditSnapshot(after) }, {
    before: apiTokenAuditSnapshot(before), after: apiTokenAuditSnapshot(after), entity: { label: `Доступ API «${after.name}»`, href: "/settings/api" },
  });
  return { ok: true as const, noOp: false };
}
