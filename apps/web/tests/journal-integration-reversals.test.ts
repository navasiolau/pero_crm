import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { getManifest } from "../src/server/plugins/registry";
import { savePluginSettingsInTransaction } from "../src/server/plugins/mutation-core";
import { pluginMutationReversal } from "../src/server/plugins/settings-reversal";
import { markNotificationsReadInTransaction, notificationReadReversal } from "../src/server/notifications/read-reversal";

const actor = { id: "admin", name: "Администратор", roles: ["ADMIN" as const], source: "web" as const };

test("module setting undo returns to its default without deleting the configured row", async () => {
  const plugin = { settingsRevision: 0 };
  const stored = new Map<string, { value: string; configured: boolean }>();
  const audits: { reversal: { data: unknown } }[] = [];
  const tx = {
    $queryRaw: async () => [],
    plugin: {
      findFirst: async ({ where }: { where: { settingsRevision: number } }) =>
        plugin.settingsRevision === where.settingsRevision ? plugin : null,
      update: async () => ({ settingsRevision: ++plugin.settingsRevision }),
    },
    pluginSetting: {
      findMany: async () => [...stored].filter(([, row]) => row.configured).map(([key, row]) => ({ key, ...row })),
      upsert: async ({ create }: { create: { key: string; value: string } }) => {
        stored.set(create.key, { value: create.value, configured: true });
      },
      update: async ({ where }: { where: { pluginId_key: { key: string } } }) => {
        stored.get(where.pluginId_key.key)!.configured = false;
      },
    },
    changeLog: { create: async ({ data }: { data: typeof audits[number] }) => { audits.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  await savePluginSettingsInTransaction(tx, actor, getManifest("demo")!, { greeting: "Новый текст" });
  const handler = pluginMutationReversal.read(audits[0]?.reversal.data)!;
  const ctx = { tx, entityId: "demo", actor, entryId: "entry" };
  assert.equal(await handler.preview(ctx), null);
  const reversed = await handler.apply(ctx);
  assert.deepEqual(stored.get("greeting"), { value: "Новый текст", configured: false });
  assert.ok(await handler.preview(ctx), "старый снимок больше не подходит");
  await pluginMutationReversal.read(reversed.reversal.data)!.apply(ctx);
  assert.deepEqual(stored.get("greeting"), { value: "Новый текст", configured: true });
});

test("bulk notification reversal captures only business entries and refuses a changed revision", async () => {
  const audits: { reversal: { data: unknown } }[] = [];
  let revision = 1;
  const tx = {
    notification: {
      updateManyAndReturn: async (input: { where: unknown }) => {
        assert.match(JSON.stringify(input.where), /"not":"plan.reminder"/);
        return [{ id: "business", readRevision: revision }];
      },
      count: async ({ where }: { where: { OR: { id: string; readRevision: number }[] } }) =>
        Number(where.OR.some(row => row.id === "business" && row.readRevision === revision)),
      updateMany: async ({ where }: { where: { OR?: { id: string; readRevision: number }[] } }) => {
        if (!where.OR) return { count: 1 };
        if (!where.OR.some(row => row.id === "business" && row.readRevision === revision)) return { count: 0 };
        revision++;
        return { count: 1 };
      },
    },
    changeLog: { create: async ({ data }: { data: typeof audits[number] }) => { audits.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  await markNotificationsReadInTransaction(tx, actor, { userId: actor.id });
  assert.equal(audits.length, 1);
  const command = notificationReadReversal.read(audits[0]?.reversal.data)!;
  const ctx = { tx, entityId: actor.id, actor, entryId: "entry" };
  const reversed = await command.apply(ctx);
  await assert.rejects(() => command.apply(ctx), /изменились/);
  await notificationReadReversal.read(reversed.reversal.data)!.apply(ctx);
  assert.equal(revision, 3);
});
