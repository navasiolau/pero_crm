"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/server/require-role";

import { togglePluginInTransaction, savePluginSettingsInTransaction, revokeApiTokenInTransaction } from "./mutation-core";
import { runPluginCommandInTransaction } from "./command-core";
import { deliverPostCommit } from "@/server/operations/post-commit";
import { buildPluginContext } from "./context";
import { emitDomainEvent, dispatchEvent } from "./events";
import { getManifest } from "./registry";
import { logPluginRun } from "./run-log";
import { createApiToken } from "./tokens";

// Вкл/выкл модуля одной кнопкой (§14). Данные и настройки не удаляются.
export async function togglePlugin(
  pluginId: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  const manifest = getManifest(pluginId);
  if (!manifest) return { ok: false, error: "Модуль не найден в реестре" };

  const actor = { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" as const };
  const saved = await prisma.$transaction(tx => togglePluginInTransaction(tx, actor, manifest, enabled));
  if (!saved.ok) return saved;
  if (saved.noOp) return { ok: true };

  // Хук жизненного цикла — best effort
  const hook = enabled ? manifest.hooks?.onEnable : manifest.hooks?.onDisable;
  if (hook) {
    const started = Date.now();
    try {
      const ctx = await buildPluginContext(pluginId, emitDomainEvent, { id: actor.id, name: actor.name });
      await hook(ctx);
      await logPluginRun({
        pluginId,
        kind: "hook",
        ref: enabled ? "onEnable" : "onDisable",
        status: "ok",
        durationMs: Date.now() - started,
      });
    } catch (error) {
      await logPluginRun({
        pluginId,
        kind: "hook",
        ref: enabled ? "onEnable" : "onDisable",
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });
    }
  }

  await deliverPostCommit("plugin-toggle", pluginId, [
    ...(saved.eventId ? [{ kind: "dispatch" as const, run: () => dispatchEvent(saved.eventId!) }] : []),
    { kind: "cache", run: () => { revalidatePath("/settings/modules"); revalidatePath("/"); } },
  ]);
  return { ok: true };
}

// Сохранение настроек модуля (автоформа по settingsSchema).
export async function savePluginSettings(
  pluginId: string,
  values: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  const manifest = getManifest(pluginId);
  if (!manifest) return { ok: false, error: "Модуль не найден в реестре" };

  await prisma.$transaction(tx => savePluginSettingsInTransaction(tx, {
    id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web",
  }, manifest, values));
  await deliverPostCommit("plugin-settings", pluginId, [{ kind: "cache", run: () => { revalidatePath(`/settings/modules/${pluginId}`); revalidatePath("/"); } }]);
  return { ok: true };
}

// Запуск команды модуля из UI.
export async function runPluginCommand(
  pluginId: string,
  commandId: string,
): Promise<{ ok: boolean; result?: string; error?: string }> {
  const session = await requireAdmin();
  const manifest = getManifest(pluginId);
  const command = manifest?.commands?.find((c) => c.id === commandId);
  if (!manifest || !command) return { ok: false, error: "Команда не найдена" };

  const plugin = await prisma.plugin.findUnique({ where: { id: pluginId } });
  if (!plugin?.enabled) return { ok: false, error: "Модуль выключен" };

  const started = Date.now();
  try {
    const committed = await prisma.$transaction(tx => runPluginCommandInTransaction(tx, {
      id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web",
    }, manifest, commandId));
    await deliverPostCommit("plugin-command", pluginId, [
      ...committed.eventIds.map(eventId => ({ kind: "dispatch" as const, run: () => dispatchEvent(eventId) })),
      { kind: "dispatch", run: async () => {
        for (const log of committed.logs) await logPluginRun({ pluginId, kind: "command", ref: commandId, ...log });
        await logPluginRun({ pluginId, kind: "command", ref: commandId, status: "ok", message: committed.result ?? undefined, durationMs: Date.now() - started });
      } },
      { kind: "cache", run: () => { revalidatePath(`/settings/modules/${pluginId}`); revalidatePath("/changelog"); } },
    ]);
    return { ok: true, result: committed.result ?? "Выполнено" };
  } catch (error) {
    const message = error instanceof Error && error.message === "PLUGIN_COMMAND_TRANSACTION_UNSUPPORTED"
      ? "Для команды не настроено безопасное выполнение" : "Не удалось выполнить команду";
    await logPluginRun({
      pluginId,
      kind: "command",
      ref: commandId,
      status: "error",
      message,
      durationMs: Date.now() - started,
    });
    return { ok: false, error: message };
  }
}

// ─── API-токены (/api/v1) ────────────────────────────────────────────────────

export async function createToken(
  name: string,
  scopes: string[],
): Promise<{ ok: boolean; token?: string; error?: string }> {
  const session = await requireAdmin();
  if (!name.trim()) return { ok: false, error: "Укажите название токена" };
  const { token, id } = await createApiToken({
    name: name.trim(),
    scopes,
    createdById: session.user.id,
  }, { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" });
  await deliverPostCommit("api-token-create", id, [{ kind: "cache", run: () => revalidatePath("/settings/api") }]);
  return { ok: true, token };
}

export async function revokeToken(
  tokenId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  const result = await prisma.$transaction(tx => revokeApiTokenInTransaction(tx, {
    id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web",
  }, tokenId));
  if (!result.ok) return result;
  await deliverPostCommit("api-token-revoke", tokenId, [{ kind: "cache", run: () => revalidatePath("/settings/api") }]);
  return { ok: true };
}
