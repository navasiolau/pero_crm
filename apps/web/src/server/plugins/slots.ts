import type { SlotId, SlotLoader } from "@pero/plugin-sdk";

import { prisma } from "@/lib/prisma";

import { getManifest } from "./registry";

export interface SlotContribution<S extends SlotId> {
  pluginId: string;
  pluginName: string;
  loader: SlotLoader<S>;
}

// Вклады включённых плагинов в слот. Отключённый плагин не рендерится (§14).
export async function getSlotContributions<S extends SlotId>(
  slot: S,
): Promise<SlotContribution<S>[]> {
  const enabled = await prisma.plugin.findMany({
    where: { enabled: true },
    select: { id: true, name: true },
  });
  const contributions: SlotContribution<S>[] = [];
  for (const plugin of enabled) {
    const loader = getManifest(plugin.id)?.slots?.[slot] as
      | SlotLoader<S>
      | undefined;
    if (loader) {
      contributions.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        loader,
      });
    }
  }
  return contributions;
}
