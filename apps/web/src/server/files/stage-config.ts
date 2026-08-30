import type { FileCategory } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getPluginSettings } from "@/server/plugins/run-log";
import { buildExtensionsMap } from "@pero/plugin-file-stages";

const PLUGIN_ID = "file-stages";

// Конфигурация группировки файлов для вкладки «Файлы» проекта/изделия.
// Активна только когда плагин file-stages включён в /settings/modules.
export async function getFileStageConfig(): Promise<{
  enabled: boolean;
  extensions: Record<FileCategory, string[]> | null;
}> {
  const plugin = await prisma.plugin.findUnique({
    where: { id: PLUGIN_ID },
    select: { enabled: true },
  });
  if (!plugin?.enabled) return { enabled: false, extensions: null };

  const settings = await getPluginSettings(PLUGIN_ID);
  const map = buildExtensionsMap(settings) as Record<FileCategory, string[]>;
  return { enabled: true, extensions: map };
}
