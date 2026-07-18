"use client";

import { useTransition } from "react";
import { Play } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { runPluginCommand } from "@/server/plugins/actions";

export function CommandButton({
  pluginId,
  commandId,
  name,
  description,
  disabled,
}: {
  pluginId: string;
  commandId: string;
  name: string;
  description?: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        disabled={pending || disabled}
        onClick={() =>
          startTransition(async () => {
            const result = await runPluginCommand(pluginId, commandId);
            if (result.ok) {
              toast.success(result.result ?? "Выполнено");
            } else {
              toast.error(result.error ?? "Команда завершилась ошибкой");
            }
          })
        }
      >
        <Play className="mr-1 size-4" />
        {pending ? "Выполняется…" : name}
      </Button>
      {description ? (
        <p className="max-w-56 text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
