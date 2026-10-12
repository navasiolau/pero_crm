import assert from "node:assert/strict";
import { memorySubscriberFixture } from "./helpers/subscriber-delivery-fixture";
import { createRequire, Module } from "node:module";
import { test } from "node:test";
import type { PluginContext, DomainEventPayload } from "@pero/plugin-sdk";

import { OBSOLETE_SKETCH_EVENT } from "../src/server/products/sketch-cleanup-contract";
import { createMemoryEventQueueFixture, memoryEvent } from "./helpers/event-queue-fixture";

const require = createRequire(import.meta.url);

test("actual plugin context keeps explicit emitter, trusted actor/audit and nested queue delivery", async () => {
  const originals = new Map<string, NodeModule | undefined>();
  function inject(specifier: string, exports: Record<string, unknown>) {
    const filename = require.resolve(specifier), stub = new Module(filename);
    originals.set(filename, require.cache[filename]);
    stub.filename = filename; stub.loaded = true; stub.exports = exports; require.cache[filename] = stub;
  }
  const fixture = createMemoryEventQueueFixture();
  const writes: { type: string; payload: unknown; actor: string }[] = [];
  const audit: Record<string, unknown>[] = [], logs: Record<string, unknown>[] = [];
  const plugins = [{ id: "qa152", enabled: true }, { id: "qa152-disabled", enabled: false }];
  let hook: (event: DomainEventPayload, ctx: PluginContext) => Promise<void> = async () => {};
  let internalCalls = 0;
  inject("../src/lib/prisma", { prisma: {
    domainEvent: { create: async ({ data }: { data: { type: string; payload: unknown; actor: string } }) => {
      writes.push(data);
      const row = { ...memoryEvent(writes.length), ...data, id: `qa152-event-${writes.length}`,
        createdAt: new Date(fixture.now()), nextAttemptAt: new Date(fixture.now()) };
      fixture.rows.push(row); return row;
    } },
    plugin: { findMany: async ({ where }: { where: { enabled: boolean } }) => {
      assert.equal(where.enabled, true);
      return plugins.filter(plugin => plugin.enabled === where.enabled);
    } },
  } });
  inject("../src/server/plugins/registry", { getManifest: (id: string) => ({ id, name: "Проверка", permissions: ["read"],
    hooks: { onDomainEvent: async (event: DomainEventPayload, ctx: PluginContext) => {
      assert.equal(id, "qa152", "disabled plugin must not run"); await hook(event, ctx);
    } } }) });
  inject("../src/server/plugins/run-log", {
    getPluginSettings: async () => ({ configured: true }), logPluginRun: async (entry: Record<string, unknown>) => { logs.push(entry); },
  });
  inject("../src/server/plugins/changelog", { writeChangeLog: async (entry: Record<string, unknown>) => { audit.push(entry); } });
  inject("../src/server/plugins/event-queue-store", { createPostgresEventQueueStore: () => fixture.store });
  inject("../src/server/plugins/event-subscriber-store", { createPostgresSubscriberStore: () => memorySubscriberFixture(fixture).store });
  inject("../src/server/products/sketch-cleanup-core", { executeObsoleteSketchCleanup: async () => { internalCalls++; } });
  for (const specifier of ["../src/server/plugins/context", "../src/server/plugins/events"]) {
    const filename = require.resolve(specifier); originals.set(filename, require.cache[filename]); delete require.cache[filename];
  }
  try {
    const { buildPluginContext } = require("../src/server/plugins/context") as typeof import("../src/server/plugins/context");
    const events = require("../src/server/plugins/events") as typeof import("../src/server/plugins/events");
    const sent: { type: string; payload: unknown; actor: string }[] = [];
    const ctx = await buildPluginContext("qa152", async (type, payload, actor) => { sent.push({ type, payload, actor }); });
    await ctx.emit("qa152.direct", { value: 1 });
    assert.deepEqual(sent, [{ type: "qa152.direct", payload: { value: 1 }, actor: "plugin:qa152" }]);
    assert.equal(writes.length, 0, "the factory must use only the supplied emitter");
    assert.equal(ctx.actor, "plugin:qa152"); assert.deepEqual(ctx.settings, { configured: true });
    ctx.requirePermission("read"); assert.throws(() => ctx.requirePermission("write"));
    await ctx.audit({ entity: "qa152", entityId: "owned", action: "check" });
    assert.equal(audit[0].actorType, "plugin"); assert.equal(audit[0].actorId, "plugin:qa152");
    assert.equal(audit[0].source, "plugin"); assert.equal(audit[0].actorName, "Проверка");
    await ctx.logger.info("qa152-info"); await ctx.logger.error("qa152-error");
    assert.deepEqual(logs.map(entry => entry.status), ["ok", "error"]); logs.length = 0;

    const delivered: string[] = [];
    hook = async (event, current) => {
      delivered.push(event.type); assert.equal(current.actor, "plugin:qa152");
      if (event.type === "qa152.parent") await current.emit("qa152.child", { parent: event.id });
    };
    await events.emitDomainEvent("qa152.parent", { value: 2 }, "qa152-actor");
    assert.deepEqual(delivered, ["qa152.parent", "qa152.child"]);
    assert.deepEqual(writes.map(({ type, actor }) => ({ type, actor })), [
      { type: "qa152.parent", actor: "qa152-actor" }, { type: "qa152.child", actor: "plugin:qa152" },
    ]);
    assert.equal(fixture.rows.length, 2); assert.ok(fixture.rows.every(row => row.processedAt));
    assert.equal(logs.filter(entry => entry.status === "ok").length, 2);

    let failureCalls = 0;
    hook = async () => { failureCalls++; throw Error("QA152_FAILURE"); };
    await events.emitDomainEvent("qa152.failure", {});
    const failed = fixture.rows[2]; assert.equal(failed.processedAt, null);
    assert.equal(failed.lastError, "EVENT_DELIVERY_FAILED"); assert.equal(failureCalls, 1);
    await events.dispatchEvent(failed.id); assert.equal(failureCalls, 1, "backoff still gates retry");
    await fixture.advance(fixture.settings.backoffBaseMs); hook = async () => { failureCalls++; };
    await events.dispatchEvent(failed.id); assert.equal(failureCalls, 2); assert.ok(failed.processedAt);
    await events.emitDomainEvent(OBSOLETE_SKETCH_EVENT, {});
    assert.equal(internalCalls, 1); assert.equal(failureCalls, 2, "internal cleanup stays outside plugin hooks");
  } finally {
    for (const [filename, original] of originals) {
      if (original) require.cache[filename] = original; else delete require.cache[filename];
    }
  }
});