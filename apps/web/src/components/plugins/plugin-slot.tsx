import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { SlotId, SlotPropsMap } from "@pero/plugin-sdk";

import { getPluginSettings } from "@/server/plugins/run-log";
import { getSlotContributions } from "@/server/plugins/slots";

import { SlotErrorBoundary } from "./slot-error-boundary";

// Точка монтирования слота (§14): рендерит вклады всех включённых плагинов.
// UI грузится через next/dynamic — код плагина не тянется, пока слот не открыт.
// Ошибка одного плагина не роняет страницу (ErrorBoundary на каждый вклад).
export async function PluginSlot<S extends SlotId>({
  slot,
  props,
}: {
  slot: S;
  props: Omit<SlotPropsMap[S], "settings">;
}) {
  const contributions = await getSlotContributions(slot);
  if (contributions.length === 0) return null;

  const rendered = await Promise.all(
    contributions.map(async (contribution) => {
      const settings = await getPluginSettings(contribution.pluginId);
      const Component = dynamic(contribution.loader) as ComponentType<
        Record<string, unknown>
      >;
      return { contribution, settings, Component };
    }),
  );

  return (
    <>
      {rendered.map(({ contribution, settings, Component }) => (
        <SlotErrorBoundary
          key={contribution.pluginId}
          pluginName={contribution.pluginName}
        >
          <Component {...props} settings={settings} />
        </SlotErrorBoundary>
      ))}
    </>
  );
}
