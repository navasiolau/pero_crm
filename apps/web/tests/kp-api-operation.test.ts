import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { KpApiError, type KpApiContext } from "../src/server/kp/api-contract";
import { readApiReceipt, runApiCommand, type ApiOperation } from "../src/server/kp/api-operation";

function fixture() {
  const state = { value: 0, logs: [] as Record<string, unknown>[], prepares: 0, writes: 0, revoked: false, deleted: false, failAudit: false, loseAck: false };
  const context: KpApiContext = { actor: { id: "owner", name: "Owner", roles: ["MANAGER"], source: "api" },
    binding: { id: "owner", source: "api", tokenId: "key" }, authorize: async () => { if (state.revoked) throw new KpApiError("KP_AUTH_REQUIRED", 401, "Revoked"); return context.actor; } };
  const db = { changeLog: {
    findUnique: async ({ where }: { where: { id: string } }) => structuredClone(state.logs.find(row => row.id === where.id) ?? null),
    create: async ({ data }: { data: Record<string, unknown> }) => { if (state.failAudit) throw Error("AUDIT_FAILED"); state.logs.push(structuredClone(data)); return data; },
  }, commercialProposal: { findFirst: async () => state.deleted ? null : ({ id: "proposal" }) }, client: { findUnique: async () => ({ id: "client" }) } } as unknown as Prisma.TransactionClient;
  let tail = Promise.resolve();
  const transaction = async <T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
    const beforeWait = tail; let release!: () => void; tail = new Promise<void>(yes => { release = yes; }); await beforeWait;
    const before = structuredClone({ value: state.value, logs: state.logs, writes: state.writes });
    let result: T;
    try { result = await run(db); }
    catch (error) { Object.assign(state, before); release(); throw error; }
    release();
    if (state.loseAck && state.logs.length > before.logs.length) { state.loseAck = false; throw Error("ACK_LOST_AFTER_COMMIT"); }
    return result;
  };
  const operationId = randomUUID();
  const command = (input: unknown = { state: { items: [] } }, prepare?: () => Promise<string>) => runApiCommand({ context, transaction,
    scope: "kp:write", kind: "document.create", operationId, input,
    prepare: prepare ?? (async () => { state.prepares++; return "ready"; }),
    mutate: async (_tx, ready) => { assert.equal(ready, "ready"); state.value++; state.writes++; return { entityId: "proposal", result: { id: "proposal", revision: 0, state: { value: state.value } } }; },
  });
  return { state, db, context, command, operationId, transaction };
}
test("immutable command result replays before IO even when the current entity changed", async () => {
  const f = fixture(); const result = await f.command(); f.state.value = 999;
  assert.deepEqual(await f.command(), result); assert.equal(f.state.prepares, 1); assert.equal(f.state.writes, 1); assert.equal(f.state.logs.length, 1);
  const receipt = await readApiReceipt(f.db, f.context, f.operationId) as ApiOperation;
  assert.deepEqual(receipt, { operationId: f.operationId, kind: "document.create", result });
  assert.equal((f.state.logs[0].newValue as Record<string, unknown>).tokenId, "key");
});
test("lost transaction ACK is resolved by immutable receipt without a second write", async () => {
  const f = fixture(); f.state.loseAck = true; await assert.rejects(f.command(), /ACK_LOST_AFTER_COMMIT/);
  assert.equal(f.state.value, 1); assert.equal(f.state.logs.length, 1);
  assert.deepEqual(await f.command(), { id: "proposal", revision: 0, state: { value: 1 } });
  assert.equal(f.state.prepares, 1); assert.equal(f.state.writes, 1);
});
test("same UUID with a different body rejects before preparing or mutating", async () => {
  const f = fixture(); await f.command(); await assert.rejects(f.command({ state: { items: [], changed: true } }), error => error instanceof KpApiError && error.status === 409);
  assert.equal(f.state.prepares, 1); assert.equal(f.state.writes, 1);
});
test("receipt audit failure and revoked final authorization prevent partial business writes", async () => {
  const f = fixture(); f.state.failAudit = true; await assert.rejects(f.command(), /AUDIT_FAILED/);
  assert.equal(f.state.value, 0); assert.equal(f.state.writes, 0); assert.equal(f.state.logs.length, 0);
  f.state.failAudit = false;
  await assert.rejects(f.command(undefined, async () => { f.state.revoked = true; return "ready"; }), error => error instanceof KpApiError && error.status === 401);
  assert.equal(f.state.value, 0); assert.equal(f.state.logs.length, 0);
});
test("concurrent identical operations commit one result and deleted owner blocks receipt disclosure", async () => {
  const f = fixture(); const values = await Promise.all(Array.from({ length: 5 }, () => f.command()));
  assert.ok(values.every(value => JSON.stringify(value) === JSON.stringify(values[0]))); assert.equal(f.state.writes, 1); assert.equal(f.state.logs.length, 1);
  f.state.deleted = true; await assert.rejects(readApiReceipt(f.db, f.context, f.operationId), error => error instanceof KpApiError && error.status === 404);
});

test("business mutation and audit use freshly locked actor after a long preparation", async () => {
  const f = fixture(); let latest = { ...f.context.actor };
  f.context.authorize = async () => latest;
  await runApiCommand({ context: f.context, transaction: f.transaction, scope: "kp:write", kind: "document.create", operationId: f.operationId, input: {},
    prepare: async () => { latest = { ...latest, name: "Обновлённое имя", roles: ["DIRECTOR"] }; },
    mutate: async () => { assert.deepEqual(f.context.actor.roles, ["DIRECTOR"]); return { entityId: "proposal", result: { id: "proposal" } }; } });
  assert.equal(f.state.logs[0].actorName, "Обновлённое имя");
});
