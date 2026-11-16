import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import type { PluginManifest } from "@pero/plugin-sdk";
import { togglePluginInTransaction, savePluginSettingsInTransaction, createApiTokenInTransaction, revokeApiTokenInTransaction } from "../src/server/plugins/mutation-core";
import { setNotificationPreferenceInTransaction } from "../src/server/notifications/preference-core";
import { parseJournalPresentation } from "../src/server/changelog/presentation";

const actor = { id: "admin", name: "Администратор", roles: ["ADMIN"] as const, source: "web" as const };
const manifest: PluginManifest = { id: "demo", name: "Демо", version: "1", apiVersion: 1, permissions: [], settingsSchema: [
  { key: "greeting", label: "Приветствие", type: "string", default: "Привет" }, { key: "accessToken", label: "Токен", type: "string" },
] };
function fixture() {
  let plugin = { id: "demo", name: "Демо", enabled: false }, token: Record<string, unknown> | null = null, fail = false;
  const settings = new Map<string, unknown>([["greeting", "Привет"], ["accessToken", "old-secret"]]);
  const preferences = new Map<string, boolean>(), audits: Prisma.ChangeLogCreateInput[] = [], events: unknown[] = [];
  const tx = { $queryRaw: async () => [], plugin: { findUnique: async () => plugin, update: async ({ data }: { data: { enabled: boolean } }) => plugin = { ...plugin, ...data } },
    pluginSetting: { findMany: async () => [...settings].map(([key, value]) => ({ key, value })), upsert: async ({ where, update }: { where: { pluginId_key: { key: string } }; update: { value: unknown } }) => { settings.set(where.pluginId_key.key, update.value); return update; } },
    apiToken: { create: async ({ data }: { data: Record<string, unknown> }) => token = { id: "token-id", createdAt: new Date(), revokedAt: null, ...data }, findUnique: async () => token,
      update: async ({ data }: { data: Record<string, unknown> }) => token = { ...token, ...data } },
    notificationPreference: { findMany: async () => [...preferences].map(([type, enabled]) => ({ type, enabled })),
      findUnique: async ({ where }: { where: { userId_type: { type: string } } }) => preferences.has(where.userId_type.type) ? { type: where.userId_type.type, enabled: preferences.get(where.userId_type.type) } : null,
      upsert: async ({ create }: { create: { type: string; enabled: boolean } }) => { preferences.set(create.type, create.enabled); return create; } },
    changeLog: { create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { if (fail) throw new Error("AUDIT_FAILED"); audits.push(data); return data; } },
    domainEvent: { create: async (input: unknown) => { events.push(input); return { id: "event-id" }; } },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, audits, settings, events, get token() { return token; }, fail: () => { fail = true; } };
}

test("plugin toggle reads actual before, suppresses no-op and queues event in its transaction", async () => {
  const f = fixture(), user = { ...actor, roles: [...actor.roles] };
  await togglePluginInTransaction(f.tx, user, manifest, false); assert.equal(f.audits.length, 0);
  await togglePluginInTransaction(f.tx, user, manifest, true); await togglePluginInTransaction(f.tx, user, manifest, true);
  assert.equal(f.audits.length, 1); assert.equal(f.events.length, 1);
  assert.equal(f.audits[0]?.oldValue, false); assert.equal(f.audits[0]?.newValue, true);
});

test("settings save only allowed keys, use manifest labels and keep secrets outside audit", async () => {
  const f = fixture();
  await savePluginSettingsInTransaction(f.tx, { ...actor, roles: [...actor.roles] }, manifest, { greeting: "Здравствуйте", accessToken: "new-secret", forbidden: "ignored" });
  assert.equal(f.settings.get("greeting"), "Здравствуйте"); assert.equal(f.settings.has("forbidden"), false);
  const view = parseJournalPresentation(f.audits[0]?.presentation)!;
  assert.ok(view.changes.some(change => change.label === "Приветствие"));
  assert.ok(!JSON.stringify(f.audits).includes("old-secret")); assert.ok(!JSON.stringify(f.audits).includes("new-secret"));
  await savePluginSettingsInTransaction(f.tx, { ...actor, roles: [...actor.roles] }, manifest, { greeting: "Здравствуйте", accessToken: "new-secret" });
  assert.equal(f.audits.length, 1);
});

test("API token logs stable record ID and complete safe metadata, repeated revoke is no-op", async () => {
  const f = fixture(), user = { ...actor, roles: [...actor.roles] };
  await createApiTokenInTransaction(f.tx, user, { name: "Интеграция", scopes: ["read", "write"], createdById: actor.id }, "pero_full-secret-token-value");
  assert.equal(f.audits[0]?.entityId, "token-id"); assert.equal(f.token?.name, "Интеграция");
  assert.ok(!JSON.stringify(f.audits).includes("full-secret-token-value")); assert.ok(!JSON.stringify(f.audits).includes("tokenHash"));
  await revokeApiTokenInTransaction(f.tx, user, "token-id"); await revokeApiTokenInTransaction(f.tx, user, "token-id");
  assert.equal(f.audits.length, 2);
});

test("preferences audit explicit changes but never private plan settings", async () => {
  const f = fixture(), user = { ...actor, roles: [...actor.roles] };
  await setNotificationPreferenceInTransaction(f.tx, user, "task.assigned", false, "Вам назначена задача");
  await setNotificationPreferenceInTransaction(f.tx, user, "task.assigned", false, "Вам назначена задача");
  await setNotificationPreferenceInTransaction(f.tx, user, "plan.reminder", false, "Личный план");
  assert.equal(f.audits.length, 1); assert.equal(f.audits[0]?.entity, "notificationPreference");
});

test("mandatory plugin/settings/token/preference audit failures propagate", async () => {
  const user = { ...actor, roles: [...actor.roles] };
  for (const operation of [
    (tx: Prisma.TransactionClient) => togglePluginInTransaction(tx, user, manifest, true),
    (tx: Prisma.TransactionClient) => savePluginSettingsInTransaction(tx, user, manifest, { greeting: "Изменено" }),
    (tx: Prisma.TransactionClient) => createApiTokenInTransaction(tx, user, { name: "API", scopes: [] }, "pero_secret"),
    (tx: Prisma.TransactionClient) => setNotificationPreferenceInTransaction(tx, user, "task.assigned", false, "Задачи"),
  ]) { const f = fixture(); f.fail(); await assert.rejects(() => operation(f.tx), /AUDIT_FAILED/); }
});
