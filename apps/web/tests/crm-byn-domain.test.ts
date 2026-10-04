import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { captureProductPercentageCompletion } from "../src/server/product-percentage-pay/core";
import { changeTaskStatusCore } from "../src/server/tasks/completion-core";
import { splitTaskCore } from "../src/server/tasks/share-core";
import { taskShareFixture } from "./helpers/task-share-fixture";
import { randomUUID } from "node:crypto";

const actor = { id: "manager", name: "Manager", roles: ["MANAGER" as const], source: "web" as const };

test("new percentage snapshot rejects foreign project before snapshot/audit writes", async () => {
  let writes = 0;
  const tx = {
    productStatusHistory: { findFirst: async () => null },
    productPercentageCompletion: { findUnique: async () => null, create: async () => { writes++; return { id: "new" }; } },
    product: { findUnique: async () => ({ status: "INSTALLATION", quantity: 3, expectedPrice: "1000", mounterId: "m", mounter: { id: "m", name: "M", active: true, roles: ["MOUNTER"] }, project: { currency: "USD" }, percentageConfigs: [{ ratePercent: "5" }], stagePayPools: [] }) },
    orgSetting: { findUnique: async () => ({ value: "BYN" }) },
    changeLog: { create: async () => { writes++; } },
  } as unknown as Prisma.TransactionClient;
  await assert.rejects(captureProductPercentageCompletion(tx, actor, "p", "INSTALLATION", "DONE"), /BYN/);
  assert.equal(writes, 0);
});

test("existing frozen pending completion is returned without rewriting foreign history", async () => {
  const tx = {
    productPercentageCompletion: { findUnique: async () => ({ state: "PENDING_FX" }) },
    product: { findUnique: async () => { throw new Error("must not read a new basis"); } },
  } as unknown as Prisma.TransactionClient;
  assert.equal(await captureProductPercentageCompletion(tx, actor, "p", "INSTALLATION", "DONE"), "PENDING_FX");
});

test("ordinary allocation cannot create a foreign monetary group", async () => {
  const f = taskShareFixture(); f.state().currency = "USD";
  const result = await splitTaskCore(actor, { taskId: "source", recipientId: "recipient", percent: "30", expectedRevision: 0, requestId: randomUUID() }, f.transaction);
  assert.equal(result.ok, false);
  assert.equal(f.state().groups.length, 0);
});

test("unknown foreign ordinary work cannot accrue payroll under BYN", async () => {
  const f = taskShareFixture(); f.state().currency = "USD";
  const before = structuredClone(f.state().tasks);
  const result = await changeTaskStatusCore(actor, "source", "DONE", undefined, f.transaction);
  assert.equal(result.ok, false);
  assert.equal(f.state().entries.length, 0);
  assert.deepEqual(f.state().tasks, before);
});
