import { assertPluginAuditEntry, assertPluginEventType, pluginReadDatabase } from "./read-database";
import type { Prisma } from "@prisma/client";
import type { PluginContext, PluginManifest } from "@pero/plugin-sdk";
import { ADMIN_ROLES } from "@/lib/roles";
import { requireActorRoles, type DomainActor } from "@/server/actor";
import type { JournalActor, JournalEntityReference } from "@/server/changelog/contract";
import { sanitizeJournalValue } from "@/server/changelog/presentation";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import type { VerifiedToken } from "./token-verification";

/** Проверенный DB-only контракт установленной команды. Новые команды требуют своей проверки границы. */
export async function runPluginCommandInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, manifest: PluginManifest, commandId: string) {
  requireActorRoles(actor, ADMIN_ROLES);
  return executeCommand(tx, { type: "user", id: actor.id, name: actor.name }, actor.source, manifest, commandId);
}

/** Публичный API сохраняет прежнюю авторизацию write/admin scope, а не ролевой grant web-страницы. */
export async function runApiPluginCommandInTransaction(tx: Prisma.TransactionClient, verified: VerifiedToken, manifest: PluginManifest, commandId: string) {
  if (!verified.scopes.some(scope => scope === "write" || scope === "admin")) throw new Error("PLUGIN_API_FORBIDDEN");
  const token = await tx.apiToken.findUnique({ where: { id: verified.id } });
  if (!token || token.revokedAt) throw new Error("PLUGIN_API_UNAUTHORIZED");
  if (!token.scopes.some(scope => scope === "write" || scope === "admin")) throw new Error("PLUGIN_API_FORBIDDEN");
  const owner = token.createdById ? await tx.user.findUnique({ where: { id: token.createdById }, select: { id: true, name: true, active: true } }) : null;
  if (token.createdById && !owner?.active) throw new Error("PLUGIN_API_UNAUTHORIZED");
  const actor: JournalActor = owner ? { type: "user", id: owner.id, name: owner.name } : { type: "system", id: `apiToken:${token.id}`, name: "Система" };
  return executeCommand(tx, actor, "api", manifest, commandId, { type: "apiToken", id: token.id, label: `Доступ API «${token.name}»`, href: "/settings/api" });
}

async function executeCommand(tx: Prisma.TransactionClient, actor: JournalActor, source: DomainActor["source"], manifest: PluginManifest, commandId: string, token?: JournalEntityReference) {
  if (manifest.id !== "demo" || manifest.version !== "0.1.0" || manifest.apiVersion !== 1 || commandId !== "ping")
    throw new Error("PLUGIN_COMMAND_TRANSACTION_UNSUPPORTED");
  const command = manifest.commands?.find(item => item.id === commandId);
  if (!command) throw new Error("PLUGIN_COMMAND_NOT_FOUND");
  const plugin = await tx.plugin.findUnique({ where: { id: manifest.id } });
  if (!plugin?.enabled) throw new Error("PLUGIN_DISABLED");
  const settings = Object.fromEntries([
    ...(manifest.settingsSchema ?? []).filter(field => field.default !== undefined).map(field => [field.key, field.default]),
    ...(await tx.pluginSetting.findMany({ where: { pluginId: manifest.id } })).map(row => [row.key, row.value]),
  ]);
  const eventIds: string[] = [], logs: { status: "ok" | "error"; message: string }[] = [], pluginActor = `plugin:${manifest.id}`;
  const context: PluginContext = {
    pluginId: manifest.id, actor: pluginActor, settings, db: pluginReadDatabase(tx, manifest.permissions),
    logger: { info: async message => { logs.push({ status: "ok", message: String(sanitizeJournalValue(message)) }); },
      error: async message => { logs.push({ status: "error", message: String(sanitizeJournalValue(message)) }); } },
    audit: async entry => {
      assertPluginAuditEntry(manifest.id, entry);
      await writeChangeLogInTransaction(tx, { ...entry, actorType: "plugin", actorId: pluginActor, actorName: manifest.name, source: "plugin" }, {
        actor: { type: "system", id: "system", name: "Система" }, ...(actor.type === "user" ? { initiator: { id: actor.id, name: actor.name } } : {}), reason: `Команда модуля: ${command.name}`,
        ...(entry.entity === "plugin" && entry.entityId === manifest.id ? { entity: { label: `Модуль ${manifest.name}`, href: `/settings/modules/${encodeURIComponent(manifest.id)}` } } : {}),
      });
    },
    emit: async (type, payload) => {
      assertPluginEventType(manifest.id, type);
      const event = await tx.domainEvent.create({ data: { type, payload: JSON.parse(JSON.stringify(payload ?? {})) as Prisma.InputJsonValue, actor: pluginActor } });
      eventIds.push(event.id);
    },
    requirePermission: permission => { if (!manifest.permissions.includes(permission)) throw new Error("PLUGIN_PERMISSION_NOT_DECLARED"); },
  };
  const result = await command.run(context);
  const after = { commandId, commandName: command.name, result: result ?? null, ...(token ? { tokenId: token.id } : {}) };
  await writeChangeLogInTransaction(tx, { actorType: actor.type, actorId: actor.id, actorName: actor.name, source,
    entity: "plugin", entityId: manifest.id, action: "command", newValue: sanitizeJournalValue(after) }, {
    before: null, after, entity: { label: `Модуль ${manifest.name}`, href: `/settings/modules/${encodeURIComponent(manifest.id)}` }, ...(token ? { links: [token] } : {}),
  });
  return { result: result ?? null, eventIds, logs };
}
