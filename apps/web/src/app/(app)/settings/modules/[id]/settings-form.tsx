"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { SettingField } from "@pero/plugin-sdk";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { savePluginSettings } from "@/server/plugins/actions";

// Автоформа настроек модуля по settingsSchema манифеста (§14).
export function SettingsForm({
  pluginId,
  schema,
  values,
}: {
  pluginId: string;
  schema: SettingField[];
  values: Record<string, unknown>;
}) {
  const [form, setForm] = useState<Record<string, unknown>>(values);
  const [pending, startTransition] = useTransition();

  function set(key: string, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form
      className="flex max-w-lg flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await savePluginSettings(pluginId, form);
          if (result.ok) {
            toast.success("Настройки сохранены");
          } else {
            toast.error(result.error ?? "Не удалось сохранить настройки");
          }
        });
      }}
    >
      {schema.map((field) => {
        const value = form[field.key];
        return (
          <div key={field.key} className="flex flex-col gap-1.5">
            {field.type === "boolean" ? (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor={field.key}>{field.label}</Label>
                  {field.description ? (
                    <p className="text-xs text-muted-foreground">
                      {field.description}
                    </p>
                  ) : null}
                </div>
                <Switch
                  id={field.key}
                  checked={value === true}
                  onCheckedChange={(checked) => set(field.key, checked)}
                />
              </div>
            ) : (
              <>
                <Label htmlFor={field.key}>{field.label}</Label>
                {field.type === "select" ? (
                  <Select
                    value={typeof value === "string" ? value : ""}
                    onValueChange={(selected) => set(field.key, selected)}
                  >
                    <SelectTrigger id={field.key}>
                      <SelectValue placeholder="Выберите…">
                        {field.options?.find((option) => option.value === value)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options ?? []).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={field.key}
                    type={field.type === "number" ? "number" : "text"}
                    value={
                      typeof value === "string" || typeof value === "number"
                        ? value
                        : ""
                    }
                    required={field.required}
                    onChange={(event) =>
                      set(
                        field.key,
                        field.type === "number"
                          ? Number(event.target.value)
                          : event.target.value,
                      )
                    }
                  />
                )}
                {field.description ? (
                  <p className="text-xs text-muted-foreground">
                    {field.description}
                  </p>
                ) : null}
              </>
            )}
          </div>
        );
      })}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Сохранение…" : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}
