import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { matches, type FixtureRow } from "./helpers/visibility-fixture";
const require = createRequire(import.meta.url);
function inject(name: string, exports: Record<string, unknown>) { const file = require.resolve(name), stub = new Module(file); stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub; }
let exists = true, inTransaction = false, writes = 0, revalidations = 0;
const before = new Date(Date.now() - 13 * 3600000), deadline = new Date(before.getTime() + 12 * 3600000);
let times: FixtureRow[] = [];
const tx = {
  task: { findMany: async () => { assert.equal(inTransaction, true); return []; }, findFirst: async () => { assert.equal(inTransaction, true); return exists ? { id: "t", assigneeId: "m", status: "NEW" } : null; } },
  timeEntry: {
    findMany: async ({ where }: { where: FixtureRow }) => { assert.equal(inTransaction, true); return times.filter(row => matches(row, where)); },
    findFirst: async ({ where }: { where: FixtureRow }) => { assert.equal(inTransaction, true); return times.find(row => matches(row, where)) ?? null; },
    updateMany: async ({ where, data }: { where: FixtureRow; data: FixtureRow }) => { assert.equal(inTransaction, true); const changed = times.filter(row => matches(row, where));
      for (const row of changed) Object.assign(row, data); writes += changed.length; return { count: changed.length }; },
    create: async ({ data }: { data: FixtureRow }) => { assert.equal(inTransaction, true); writes++; times.push({ id: "new", stoppedAt: null, minutes: 0, autoStopped: false, ...data }); return times.at(-1); },
  },
  $executeRaw: async () => assert.fail("Broad UPDATE закрытой истории не должен исполняться"),
};
inject("../src/auth", { auth: async () => ({ user: { id: "m", roles: ["MANAGER"] } }) });
inject("../src/lib/prisma", { prisma: new Proxy({}, { get() { throw Error("GLOBAL_DB_BEFORE_SERIALIZATION_FORBIDDEN"); } }) });
inject("../src/server/tasks/transaction", { withTaskTransaction: async (operation: (database: unknown) => Promise<unknown>) => { inTransaction = true; try { return await operation(tx); } finally { inTransaction = false; } } });
inject("../src/server/plugins/changelog", { writeChangeLog: async () => {} }); inject("next/cache", { revalidatePath: () => { revalidations++; } });
const { startTimer } = require("../src/server/time/actions") as typeof import("../src/server/time/actions");
function reset() {
  writes = revalidations = 0;
  times = [{ id: "previous", userId: "m", taskId: "old", source: "timer", startedAt: before, stoppedAt: null, minutes: 0, autoStopped: false },
    { id: "closed-zero", userId: "m", taskId: "old", source: "timer", startedAt: before, stoppedAt: before, minutes: 0, autoStopped: false }];
}
test("timer start reads current task after global transaction boundary, missing/deleted execution context refuses all timer writes", async () => {
  exists = false; reset(); const prior = structuredClone(times);
  assert.equal((await startTimer("t")).ok, false); assert.equal(writes, 0); assert.equal(revalidations, 0); assert.deepEqual(times, prior);
});
test("permitted timer start closes only the old active fact with cap and creates one new timer inside transaction", async () => {
  exists = true; reset(); const closed = structuredClone(times[1]);
  assert.equal((await startTimer("t")).ok, true); assert.equal(revalidations, 1);
  assert.equal(times[0].minutes, 720); assert.equal(times[0].autoStopped, true); assert.deepEqual(times[0].stoppedAt, deadline);
  assert.deepEqual(times[1], closed); assert.equal(times.filter(row => row.stoppedAt === null).length, 1);
  assert.equal(times[2].taskId, "t"); assert.equal(times[2].userId, "m"); assert.equal(times[2].source, "timer");
});
