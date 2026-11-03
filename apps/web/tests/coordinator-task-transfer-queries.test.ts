import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import test from "node:test";
import type { Role } from "@prisma/client";
import { taskShareFixture } from "./helpers/task-share-fixture";

const require = createRequire(import.meta.url);
let f = taskShareFixture();
const stub = new Module(require.resolve("@/lib/prisma"));
stub.filename = require.resolve("@/lib/prisma"); stub.loaded = true;
stub.exports = { prisma: new Proxy({}, { get: (_, key) => (f.database as unknown as Record<PropertyKey, unknown>)[key] }) };
require.cache[stub.filename] = stub;
const { mapTaskDetails } = require("../src/server/tasks/queries") as typeof import("../src/server/tasks/queries");
const { listPieceworkOptions } = require("../src/server/tasks/piecework-queries") as typeof import("../src/server/tasks/piecework-queries");

test("completed accrued task keeps both coordinator actions after foreign money is masked", async () => {
  f = taskShareFixture(); f.state().files.length = 0;
  Object.assign(f.state().works[0], { paymentConversions: [], settlementShares: [] });
  f.state().tasks[0].stageSettlementShares = [];
  f.state().users.push({ id: "coordinator", name: "Ответственный", roles: ["WORKER", "WORK_COORDINATOR"], active: true, payScheme: "PIECE" });
  Object.assign(f.state().tasks[0], { status: "DONE", doneAt: new Date("2026-10-15"), doneById: "worker" });
  f.state().entries.push({ id: "pay", taskId: "source", userId: "worker", scheme: "PIECE", amount: "1000" });
  const task = await f.database.task.findUnique({ where: { id: "source" } });
  const actor = { id: "coordinator", roles: ["WORKER", "WORK_COORDINATOR"] as Role[] };
  const [dto] = await mapTaskDetails([task as unknown as Parameters<typeof mapTaskDetails>[0][number]], actor);
  assert.equal(dto.canReassignOrdinaryTask, true); assert.equal(dto.canTransferPiecework, true);
  assert.equal(dto.workPriceSnapshot, null); assert.equal(dto.shareAmount, null);
  const options = await listPieceworkOptions(actor.id, "product", "source");
  assert.equal(options?.transferable, true); assert.equal(options.source?.completed, true); assert.equal(options.source?.amount, "1000.00");
  const [manager] = await mapTaskDetails([task as unknown as Parameters<typeof mapTaskDetails>[0][number]], { id: "manager", roles: ["MANAGER"] });
  assert.equal(manager.canReassignOrdinaryTask, false); assert.equal(manager.canTransferPiecework, false);
});
