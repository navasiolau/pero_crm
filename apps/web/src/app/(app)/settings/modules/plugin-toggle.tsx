"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { togglePlugin } from "@/server/plugins/actions";

export function PluginToggle({
  pluginId,
  enabled,
}: {
  pluginId: string;
  enabled: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Switch
      checked={enabled}
      disabled={pending}
      aria-label="Включить или выключить модуль"
      onCheckedChange={(checked) =>
        startTransition(async () => {
          const result = await togglePlugin(pluginId, checked);
          if (result.ok) {
            toast.success(checked ? "Модуль включён" : "Модуль выключен");
          } else {
            toast.error(result.error ?? "Не удалось переключить модуль");
          }
        })
      }
    />
  );
}
