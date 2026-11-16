import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import type { PluginManifest } from "@pero/plugin-sdk";
import { demoPlugin } from "@pero/plugin-demo";
import { runPluginCommandInTransaction, runApiPluginCommandInTransaction } from "../src/server/plugins/command-core";

const actor = { id: "admin", name: "Администратор", roles: ["ADMIN"] as const, source: "web" as const };
test("registered DB-only command stores user/system audit and outbox before any external dispatcher", async () => {
  const audits: Prisma.ChangeLogCreateInput[] = [], events: Prisma.DomainEventCreateInput[] = [];
  const tx = { plugin: { findUnique: async () => ({ id: "demo", enabled: true }) }, pluginSetting: { findMany: async () => [] },
    changeLog: { create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { audits.push(data); return data; } },
    domainEvent: { create: async ({ data }: { data: Prisma.DomainEventCreateInput }) => { events.push(data); return { id: "queued-event" }; } },
  } as unknown as Prisma.TransactionClient;
  const result = await runPluginCommandInTransaction(tx, { ...actor, roles: [...actor.roles] }, demoPlugin, "ping");
  assert.deepEqual(result.eventIds, ["queued-event"]); assert.equal(events.length, 1);
  assert.deepEqual(audits.map(row => row.actorType), ["plugin", "user"]);
  assert.equal(audits[1]?.action, "command"); assert.ok(result.result?.includes("Понг"));
  // В core отсутствует outward emitter: вызывающая сторона получает только committed-ready IDs.
  assert.equal("dispatch" in result, false);
});

test("API command keeps scope-based grant for non-admin owner and identifies ownerless automation", async () => {
  const audits: Prisma.ChangeLogCreateInput[] = [];
  let owned = true, active = true;
  const tx = { apiToken: { findUnique: async () => ({ id: "token", name: "API", scopes: ["write"], createdById: owned ? "manager" : null, revokedAt: null }) },
    user: { findUnique: async () => ({ id: "manager", name: "Менеджер", active, roles: ["MANAGER"] }) },
    plugin: { findUnique: async () => ({ id: "demo", enabled: true }) }, pluginSetting: { findMany: async () => [] },
    changeLog: { create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { audits.push(data); return data; } },
    domainEvent: { create: async () => ({ id: "queued" }) },
  } as unknown as Prisma.TransactionClient;
  const verified = { id: "token", name: "API", scopes: ["write"], pluginId: null };
  await runApiPluginCommandInTransaction(tx, verified, demoPlugin, "ping");
  assert.equal(audits.at(-1)?.actorId, "manager"); assert.equal(audits.at(-1)?.source, "api");
  active = false; await assert.rejects(() => runApiPluginCommandInTransaction(tx, verified, demoPlugin, "ping"), /PLUGIN_API_UNAUTHORIZED/);
  owned = false; await runApiPluginCommandInTransaction(tx, verified, demoPlugin, "ping");
  assert.equal(audits.at(-1)?.actorType, "system"); assert.equal(audits.at(-1)?.actorName, "Система");
  await assert.rejects(() => runApiPluginCommandInTransaction(tx, { ...verified, scopes: ["read"] }, demoPlugin, "ping"), /PLUGIN_API_FORBIDDEN/);
});

test("unregistered future command never runs inside database transaction", async () => {
  let ran = false;
  const manifest: PluginManifest = { id: "external", name: "External", version: "1", apiVersion: 1, permissions: [],
    commands: [{ id: "send", name: "Send", run: async () => { ran = true; } }] };
  await assert.rejects(() => runPluginCommandInTransaction({} as Prisma.TransactionClient, { ...actor, roles: [...actor.roles] }, manifest, "send"), /PLUGIN_COMMAND_TRANSACTION_UNSUPPORTED/);
  assert.equal(ran, false);
});

test("mandatory user audit failure propagates after DB-only command instead of returning success", async () => {
  let auditCalls = 0;
  const tx = { plugin: { findUnique: async () => ({ id: "demo", enabled: true }) }, pluginSetting: { findMany: async () => [] },
    changeLog: { create: async () => { if (++auditCalls === 2) throw new Error("AUDIT_FAILED"); return {}; } },
    domainEvent: { create: async () => ({ id: "queued-event" }) },
  } as unknown as Prisma.TransactionClient;
  await assert.rejects(() => runPluginCommandInTransaction(tx, { ...actor, roles: [...actor.roles] }, demoPlugin, "ping"), /AUDIT_FAILED/);
});
