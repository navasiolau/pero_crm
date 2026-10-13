import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import type { TaskTransaction } from "../src/server/tasks/transaction";
import { confirmMutation } from "../src/server/operations/confirmation";
import { deliverPostCommit } from "../src/server/operations/post-commit";
const tx = {} as Prisma.TransactionClient;

test("only transaction ACK commits a detached candidate without extra proof", async () => {
  const transaction: TaskTransaction = operation => operation(tx); let proofs = 0;
  const result = await confirmMutation(transaction, async () => ({ id: "row" }), async () => { proofs++; return null; });
  assert.deepEqual(result, { outcome: "COMMITTED", value: { id: "row" }, recovered: false }); assert.equal(proofs, 0);
});

test("completed callback plus rejected commit stays UNKNOWN on absent proof", async () => {
  let calls = 0, mutations = 0;
  const error = Error("lost commit ACK");
  const transaction: TaskTransaction = async operation => { const result = await operation(tx); if (++calls === 1) throw error; return result; };
  const result = await confirmMutation(transaction, async () => { mutations++; return { id: "candidate" }; }, async () => null);
  assert.equal(result.outcome, "UNKNOWN"); assert.equal(mutations, 1); assert.equal(calls, 2);
});

test("exact durable proof resolves lost commit ACK with the same ID", async () => {
  let calls = 0; const transaction: TaskTransaction = async operation => { const result = await operation(tx); if (++calls === 1) throw Error("lost ACK"); return result; };
  const result = await confirmMutation(transaction, async () => ({ id: "original" }), async (_tx, candidate) => candidate!);
  assert.deepEqual(result, { outcome: "COMMITTED", value: { id: "original" }, recovered: true }); assert.equal(calls, 2);
});

test("callback abort needs a successful fresh fence before reporting rollback", async () => {
  for (const fenceFails of [false, true]) {
    let calls = 0; const error = Error("business failure");
    const transaction: TaskTransaction = async operation => { calls++; if (calls === 2 && fenceFails) throw Error("lost rollback/fence ACK"); return operation(tx); };
    const result = await confirmMutation(transaction, async () => { throw error; }, async () => null);
    assert.equal(result.outcome, fenceFails ? "UNKNOWN" : "ROLLED_BACK"); assert.equal(calls, 2);
    if (result.outcome === "ROLLED_BACK") assert.equal(result.error, error);
  }
});

test("fresh proof read rejection cannot be called rollback or trigger another mutation", async () => {
  let calls = 0, mutations = 0;
  const transaction: TaskTransaction = async operation => { const value = await operation(tx); if (++calls === 1) throw Error("lost commit ACK"); return value; };
  const result = await confirmMutation(transaction, async () => { mutations++; return { id: "candidate" }; }, async () => { throw Error("read unavailable"); });
  assert.equal(result.outcome, "UNKNOWN"); assert.equal(mutations, 1);
});

test("failure before the application callback proves no business mutation started", async () => {
  let mutations = 0; const transaction: TaskTransaction = async () => { throw Error("transaction could not start"); };
  const result = await confirmMutation(transaction, async () => { mutations++; return {}; }, async () => null);
  assert.equal(result.outcome, "ROLLED_BACK"); assert.equal(mutations, 0);
});

test("each sync/async/diagnostic fault preserves subsequent effects and emits no raw error", async () => {
  const calls: string[] = [], diagnostics: unknown[] = [];
  await deliverPostCommit("task-status", "row-id", [
    { kind: "dispatch", run: () => { calls.push("dispatch"); throw Error("private PII credential URL"); } },
    { kind: "org", run: async () => { calls.push("org"); throw Error("private payload"); } },
    { kind: "cache", run: () => calls.push("cache") },
  ], entry => { diagnostics.push(entry); throw Error("diagnostic failed"); });
  assert.deepEqual(calls, ["dispatch", "org", "cache"]); assert.equal(diagnostics.length, 2);
  assert.ok(!JSON.stringify(diagnostics).includes("private")); assert.ok(!JSON.stringify(diagnostics).includes("URL"));
});
