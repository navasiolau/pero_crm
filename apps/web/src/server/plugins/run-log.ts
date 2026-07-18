import { prisma } from "@/lib/prisma";

import { getManifest } from "./registry";

// Запись в журнал запусков плагина (Настройки → Модули → журнал).
export async function logPluginRun(input: {
  pluginId: string;
  kind: "hook" | "command" | "slot" | "api";
  ref?: string;
  status: "ok" | "error";
  message?: string;
  durationMs?: number;
}): Promise<void> {
  try {
    await prisma.pluginRunLog.create({ data: input });
  } catch (error) {
    // Журнал не должен ронять основной сценарий
    console.error(`[plugins] Не удалось записать PluginRunLog:`, error);
  }
}

// Действующие настройки плагина: default из settingsSchema + значения из БД.
export async function getPluginSettings(
  pluginId: string,
): Promise<Record<string, unknown>> {
  const manifest = getManifest(pluginId);
  const settings: Record<string, unknown> = {};
  for (const field of manifest?.settingsSchema ?? []) {
    if (field.default !== undefined) settings[field.key] = field.default;
  }
  const rows = await prisma.pluginSetting.findMany({ where: { pluginId } });
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}
