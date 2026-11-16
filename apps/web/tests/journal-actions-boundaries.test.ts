import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire, Module } from "node:module";
import type { Prisma } from "@prisma/client";

test("actual plugin command action dispatches only after commit and never after audit rollback", async () => {
  const require = createRequire(import.meta.url), originals = new Map<string, NodeModule | undefined>();
  function inject(name: string, value: unknown) { const id = require.resolve(name), stubModule = new Module(id); originals.set(id, require.cache[id]); stubModule.filename = id; stubModule.loaded = true; stubModule.exports = value; require.cache[id] = stubModule; }
  const audits: Prisma.ChangeLogCreateInput[] = [], outbox: unknown[] = [], dispatched: string[] = [];
  let inTransaction = false, failAudit = false, committed = false;
  const tx = { plugin: { findUnique: async () => ({ id: "demo", enabled: true }) }, pluginSetting: { findMany: async () => [] },
    changeLog: { create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { assert.equal(inTransaction, true); if (failAudit && data.actorType === "user") throw new Error("AUDIT_FAILED"); audits.push(data); return data; } },
    domainEvent: { create: async (data: unknown) => { assert.equal(inTransaction, true); outbox.push(data); return { id: `event-${outbox.length}` }; } },
  };
  inject("../src/lib/prisma", { prisma: { ...tx, $transaction: async (operation: (value: typeof tx) => Promise<unknown>) => {
    const counts = [audits.length, outbox.length]; inTransaction = true;
    try { const result = await operation(tx); committed = true; return result; }
    catch (error) { audits.length = counts[0]!; outbox.length = counts[1]!; throw error; }
    finally { inTransaction = false; }
  } } });
  inject("../src/server/require-role", { requireAdmin: async () => ({ user: { id: "admin", name: "Администратор", roles: ["ADMIN"] } }) });
  inject("../src/server/plugins/events", { emitDomainEvent: async () => { throw new Error("OUTWARD_EMITTER_MUST_NOT_RUN"); }, dispatchEvent: async (id: string) => {
    assert.equal(inTransaction, false); assert.equal(committed, true); dispatched.push(id);
  } });
  inject("../src/server/plugins/run-log", { logPluginRun: async () => { assert.equal(inTransaction, false); }, getPluginSettings: async () => ({}) });
  inject("next/cache", { revalidatePath: () => { assert.equal(inTransaction, false); } });
  const actionPath = require.resolve("../src/server/plugins/actions"); originals.set(actionPath, require.cache[actionPath]); delete require.cache[actionPath];
  try {
    const { runPluginCommand } = require("../src/server/plugins/actions") as typeof import("../src/server/plugins/actions");
    assert.equal((await runPluginCommand("demo", "ping")).ok, true); assert.equal(dispatched.length, 1);
    assert.equal(audits.length, 2); assert.equal(outbox.length, 1);
    failAudit = true; committed = false; dispatched.length = 0;
    assert.equal((await runPluginCommand("demo", "ping")).ok, false);
    assert.equal(dispatched.length, 0); assert.equal(audits.length, 2); assert.equal(outbox.length, 1);
  } finally { for (const [id, entry] of originals) { if (entry) require.cache[id] = entry; else delete require.cache[id]; } }
});

test("actual user action keeps confirmed creation successful after optional notification failure", async () => {
  const require = createRequire(import.meta.url), originals = new Map<string, NodeModule | undefined>();
  function inject(name: string, value: unknown) { const id = require.resolve(name), stubModule = new Module(id); originals.set(id, require.cache[id]); stubModule.filename = id; stubModule.loaded = true; stubModule.exports = value; require.cache[id] = stubModule; }
  let inTransaction = false, committed = false, notifications = 0;
  const audits: Prisma.ChangeLogCreateInput[] = [], diagnostics: unknown[] = [];
  const tx = { user: { findFirst: async () => null, create: async ({ data }: { data: Record<string, unknown> }) => { assert.equal(inTransaction, true); return { id: "created-user", sessionVersion: 0, calendarEnabled: null, ...data }; } },
    changeLog: { create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { assert.equal(inTransaction, true); audits.push(data); return data; } },
  };
  inject("../src/lib/prisma", { prisma: { $transaction: async (operation: (value: typeof tx) => Promise<unknown>) => {
    inTransaction = true; try { const result = await operation(tx); committed = true; return result; } finally { inTransaction = false; }
  } } });
  inject("../src/server/require-role", { requireAdmin: async () => ({ user: { id: "admin", name: "Администратор", roles: ["ADMIN"] } }) });
  inject("../src/lib/password", { hashPassword: async () => "private-hash-fixture" });
  inject("../src/server/notifications/notify", { notifyPerson: async () => { assert.equal(inTransaction, false); assert.equal(committed, true); notifications++; throw new Error("private-notification-error"); } });
  inject("next/cache", { revalidatePath: () => { assert.equal(inTransaction, false); } });
  const actionPath = require.resolve("../src/server/users/actions"); originals.set(actionPath, require.cache[actionPath]); delete require.cache[actionPath];
  const report = console.error; console.error = (...args: unknown[]) => { diagnostics.push(args); };
  try {
    const { createUser } = require("../src/server/users/actions") as typeof import("../src/server/users/actions");
    const result = await createUser({ name: "Иван", email: "ivan@example.invalid", roles: ["WORKER"], payScheme: "PIECE", active: true, password: "private-password-fixture" });
    assert.equal(result.ok, true); assert.equal(audits.length, 1); assert.equal(notifications, 1); assert.equal(diagnostics.length, 1);
    const encoded = JSON.stringify({ audits, diagnostics });
    for (const secret of ["private-hash-fixture", "private-password-fixture", "private-notification-error"]) assert.ok(!encoded.includes(secret));
  } finally { console.error = report; for (const [id, entry] of originals) { if (entry) require.cache[id] = entry; else delete require.cache[id]; } }
});
