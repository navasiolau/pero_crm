import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createTaskTransaction } from "../src/server/tasks/transaction";
import {withTaskTransaction} from "../src/server/tasks/transaction";
import {createMutationTransaction,withMutationTransaction} from "../src/server/transactions/coordinator";

test("task mutation adapter acquires its transaction lock before running the mutation", async () => {
  const calls: string[] = [];
  const tx = { $queryRaw: async (sql: TemplateStringsArray) => {
    assert.match(sql.join(""), /pg_advisory_xact_lock\(18435, 55001\)/);
    calls.push("lock"); return [{ locked: 1 }];
  } };
  const database = { $transaction: async (operation: (client: Prisma.TransactionClient) => Promise<unknown>, options: { timeout: number }) => {
    assert.deepEqual(options,{maxWait:5_000,timeout:15_000,isolationLevel:"ReadCommitted"}); calls.push("begin");
    const result = await operation(tx as unknown as Prisma.TransactionClient);
    calls.push("commit"); return result;
  } };
  const transaction = createTaskTransaction(database as unknown as Pick<PrismaClient, "$transaction">);
  assert.equal(await transaction(async () => { calls.push("mutation"); return 42; }), 42);
  assert.deepEqual(calls, ["begin", "lock", "mutation", "commit"]);
});

test("neutral and task aliases share factory/singleton and retain abort after the same lock",async()=>{
 assert.equal(createTaskTransaction,createMutationTransaction);assert.equal(withTaskTransaction,withMutationTransaction);
 const calls:string[]=[],abort=Error("OWN_ABORT");let ownRows=0;
 const tx={$queryRaw:async(sql:TemplateStringsArray)=>{assert.match(sql.join(""),/pg_advisory_xact_lock\(18435, 55001\)/);calls.push("lock");return[{locked:1}]}};
 const database={$transaction:async(operation:(client:Prisma.TransactionClient)=>Promise<unknown>)=>{const before=ownRows;calls.push("begin");try{return await operation(tx as never)}catch(error){ownRows=before;calls.push("rollback");throw error}}};
 const transaction=createMutationTransaction(database as unknown as Pick<PrismaClient,"$transaction">);
 await assert.rejects(transaction(async()=>{calls.push("mutation");ownRows++;throw abort}),error=>error===abort);
 assert.equal(ownRows,0);assert.deepEqual(calls,["begin","lock","mutation","rollback"]);
});
