import { Prisma } from "@prisma/client";
import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { getManifest } from "./registry";

const settingValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const patch = z.object({ key: z.enum(["greeting", "showEventTip", "widgetStyle"]),
  value: settingValue, configured: z.boolean() }).strict();
const schema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("toggle"), revision: z.int().nonnegative(), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal("settings"), revision: z.int().nonnegative(), version: z.string(),
    fields: z.array(patch).min(1).max(3) }).strict(),
]);
type Command = z.infer<typeof schema>;

export function pluginSettingsUndoFields(rows: ReadonlyMap<string, Prisma.JsonValue>, keys: string[]) {
  const parsed = z.array(patch).safeParse(keys.map(key => ({
    key, value: rows.get(key) ?? null, configured: rows.has(key),
  })));
  return parsed.success ? parsed.data : null;
}

async function currentPlugin(tx: Prisma.TransactionClient, id: string, command: Command) {
  const manifest = getManifest(id);
  if (!manifest || (command.operation === "settings" && (id !== "demo" || manifest.version !== command.version))) return null;
  return tx.plugin.findFirst({ where: { id, settingsRevision: command.revision } });
}

const refusal = "Модуль изменился после этого действия";

export const pluginMutationReversal = defineJournalReversal({
  kind: "plugin.settings", version: 1, schema,
  async preview({ tx, entityId }, command) {
    return await currentPlugin(tx, entityId, command) ? null : refusal;
  },
  async apply({ tx, entityId, actor }, command) {
    await tx.$queryRaw`SELECT id FROM "Plugin" WHERE id = ${entityId} FOR UPDATE`;
    const plugin = await currentPlugin(tx, entityId, command);
    if (!plugin) throw new JournalReversalRefusal(refusal);
    const cachePaths = ["/", "/settings/modules", "/settings/modules/" + encodeURIComponent(entityId)];
    if (command.operation === "toggle") {
      const updated = await tx.plugin.update({ where: { id: entityId },
        data: { enabled: command.enabled, settingsRevision: { increment: 1 } } });
      const event = await tx.domainEvent.create({ data: { type: "plugin.toggled",
        actor: actor.id, payload: { pluginId: entityId, enabled: command.enabled } } });
      return {
        inverse: { ...command, revision: updated.settingsRevision, enabled: plugin.enabled },
        oldValue: plugin.enabled, newValue: updated.enabled, eventIds: [event.id], cachePaths,
      };
    }
    const rows = await tx.pluginSetting.findMany({ where: { pluginId: entityId, configured: true } });
    const previous = pluginSettingsUndoFields(new Map(rows.map(row => [row.key, row.value])), command.fields.map(field => field.key));
    if (!previous) throw new JournalReversalRefusal(refusal);
    for (const field of command.fields) {
      const value = field.value === null ? Prisma.JsonNull : field.value;
      if (field.configured) {
        await tx.pluginSetting.upsert({ where: { pluginId_key: { pluginId: entityId, key: field.key } },
          create: { pluginId: entityId, key: field.key, value }, update: { value, configured: true } });
      } else {
        await tx.pluginSetting.update({ where: { pluginId_key: { pluginId: entityId, key: field.key } }, data: { configured: false } });
      }
    }
    const updated = await tx.plugin.update({ where: { id: entityId }, data: { settingsRevision: { increment: 1 } } });
    const values = (fields: typeof previous) => Object.fromEntries(fields.map(field => [field.key, field.configured ? field.value : null]));
    return {
      inverse: { ...command, revision: updated.settingsRevision, fields: previous },
      oldValue: values(previous), newValue: values(command.fields), cachePaths,
    };
  },
});
