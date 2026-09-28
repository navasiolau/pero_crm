import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createTaskTransaction } from "../src/server/tasks/transaction";

test("task mutation adapter acquires its transaction lock before running the mutation", async () => {
  const calls: string[] = [];
  const tx = { $queryRaw: async (sql: TemplateStringsArray) => {
    assert.match(sql.join(""), /pg_advisory_xact_lock\(18435, 55001\)/);
    calls.push("lock"); return [{ locked: 1 }];
  } };
  const database = { $transaction: async (operation: (client: Prisma.TransactionClient) => Promise<unknown>, options: { timeout: number }) => {
    assert.equal(options.timeout, 15_000); calls.push("begin");
    const result = await operation(tx as unknown as Prisma.TransactionClient);
    calls.push("commit"); return result;
  } };
  const transaction = createTaskTransaction(database as unknown as Pick<PrismaClient, "$transaction">);
  assert.equal(await transaction(async () => { calls.push("mutation"); return 42; }), 42);
  assert.deepEqual(calls, ["begin", "lock", "mutation", "commit"]);
});
