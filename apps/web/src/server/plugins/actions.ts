"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/server/require-role";

import { writeChangeLog } from "./changelog";
import { buildPluginContext } from "./context";
import { emitDomainEvent } from "./events";
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

  await prisma.plugin.update({
    where: { id: pluginId },
    data: { enabled },
  });
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? session.user.email ?? undefined,
    entity: "plugin",
    entityId: pluginId,
    action: "toggle",
    field: "enabled",
    oldValue: !enabled,
    newValue: enabled,
  });

  // Хук жизненного цикла — best effort
  const hook = enabled ? manifest.hooks?.onEnable : manifest.hooks?.onDisable;
  if (hook) {
    const started = Date.now();
    try {
      const ctx = await buildPluginContext(pluginId, emitDomainEvent);
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

  await emitDomainEvent(
    "plugin.toggled",
    { pluginId, enabled },
    session.user.id,
  );
  revalidatePath("/settings/modules");
  revalidatePath("/");
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

  const allowed = new Set((manifest.settingsSchema ?? []).map((f) => f.key));
  const oldRows = await prisma.pluginSetting.findMany({
    where: { pluginId },
  });
  const oldValues = Object.fromEntries(oldRows.map((r) => [r.key, r.value]));

  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key)) continue;
    const json = value === null || value === undefined
      ? Prisma.JsonNull
      : JSON.parse(JSON.stringify(value));
    await prisma.pluginSetting.upsert({
      where: { pluginId_key: { pluginId, key } },
      create: { pluginId, key, value: json },
      update: { value: json },
    });
  }

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? session.user.email ?? undefined,
    entity: "plugin",
    entityId: pluginId,
    action: "update",
    field: "settings",
    oldValue: oldValues,
    newValue: values,
  });
  revalidatePath(`/settings/modules/${pluginId}`);
  revalidatePath("/");
  return { ok: true };
}

// Запуск команды модуля из UI.
export async function runPluginCommand(
  pluginId: string,
  commandId: string,
): Promise<{ ok: boolean; result?: string; error?: string }> {
  await requireAdmin();
  const manifest = getManifest(pluginId);
  const command = manifest?.commands?.find((c) => c.id === commandId);
  if (!manifest || !command) return { ok: false, error: "Команда не найдена" };

  const plugin = await prisma.plugin.findUnique({ where: { id: pluginId } });
  if (!plugin?.enabled) return { ok: false, error: "Модуль выключен" };

  const started = Date.now();
  try {
    const ctx = await buildPluginContext(pluginId, emitDomainEvent);
    const result = await command.run(ctx);
    await logPluginRun({
      pluginId,
      kind: "command",
      ref: commandId,
      status: "ok",
      message: result ?? undefined,
      durationMs: Date.now() - started,
    });
    revalidatePath(`/settings/modules/${pluginId}`);
    revalidatePath("/changelog");
    return { ok: true, result: result ?? "Выполнено" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
  const { token } = await createApiToken({
    name: name.trim(),
    scopes,
    createdById: session.user.id,
  });
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? session.user.email ?? undefined,
    entity: "apiToken",
    entityId: name.trim(),
    action: "create",
    newValue: { scopes },
  });
  revalidatePath("/settings/api");
  return { ok: true, token };
}

export async function revokeToken(
  tokenId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  const row = await prisma.apiToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date() },
  });
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? session.user.email ?? undefined,
    entity: "apiToken",
    entityId: row.name,
    action: "revoke",
  });
  revalidatePath("/settings/api");
  return { ok: true };
}
