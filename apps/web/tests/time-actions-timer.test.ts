import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { after, test } from "node:test";
import type { Role } from "@prisma/client";
import { matches, type FixtureRow } from "./helpers/visibility-fixture";

const require = createRequire(import.meta.url), originals = new Map<string, NodeJS.Module | undefined>();
function inject(name: string, exports: Record<string, unknown>) { const file = require.resolve(name); originals.set(file, require.cache[file]);
  const stub = new Module(file); stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub; }
const instant = new Date("2026-10-11T12:00:00Z");
type Timer = { id: string; taskId: string; userId: string; source: string; startedAt: Date; stoppedAt: Date | null; minutes: number; autoStopped: boolean };
let actor: { id: string; name: string; roles: Role[] } | null;
let tasks: FixtureRow[] = [], timers: Timer[] = [], logs: FixtureRow[] = [], inTransaction = false, sequence = 0;
let beforeUpdate: (() => void) | undefined;
const hydrate = (row: Timer) => ({ ...row, task: tasks.find(task => task.id === row.taskId) });
const selected = (where: FixtureRow = {}) => timers.filter(row => matches(hydrate(row), where));
const db = {
  task: { findFirst: async ({ where }: { where: FixtureRow }) => structuredClone(tasks.find(row => matches(row, where)) ?? null), findMany: async () => [] },
  productPercentageParticipant: { findMany: async () => [] },
  timeEntry: {
    findFirst: async ({ where }: { where: FixtureRow }) => structuredClone(selected(where)[0] ?? null),
    findMany: async ({ where }: { where: FixtureRow }) => structuredClone(selected(where)),
    updateMany: async ({ where, data }: { where: FixtureRow; data: Partial<Timer> }) => { const hook = beforeUpdate; beforeUpdate = undefined; hook?.();
      const rows = selected(where); for (const row of rows) Object.assign(row, data); return { count: rows.length }; },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Timer> }) => { const hook = beforeUpdate; beforeUpdate = undefined; hook?.();
      const row = timers.find(timer => timer.id === where.id)!; Object.assign(row, data); return structuredClone(row); },
    create: async ({ data }: { data: Partial<Timer> & Pick<Timer, "taskId" | "userId" | "source"> }) => {
      const row: Timer = { id: "created-" + ++sequence, startedAt: new Date(), stoppedAt: null, minutes: 0, autoStopped: false, ...data }; timers.push(row); return structuredClone(row); },
    aggregate: async ({ where }: { where: FixtureRow }) => ({ _sum: { minutes: selected(where).reduce((sum, row) => sum + row.minutes, 0) } }),
  },
  $executeRaw: async (strings: TemplateStringsArray, value: string) => {
    // Эмулирует actual старый SQL, чтобы RED проверял его broad WHERE, а не пустую заглушку.
    const field = strings.join("?").includes('WHERE "userId"') ? "userId" : "taskId";
    for (const row of timers) if (row[field] === value && row.stoppedAt !== null && row.minutes === 0)
      row.minutes = Math.max(1, Math.floor((row.stoppedAt.getTime() - row.startedAt.getTime()) / 60000));
    return 0;
  },
};
let queue = Promise.resolve();
async function transaction<T>(operation: (database: typeof db) => Promise<T>) {
  const previous = queue; let release!: () => void; queue = new Promise<void>(done => { release = done; }); await previous;
  const before = structuredClone({ tasks, timers, logs, sequence }); inTransaction = true;
  try { return await operation(db); } catch (error) { ({ tasks, timers, logs, sequence } = before); throw error; }
  finally { inTransaction = false; release(); }
}
inject("../src/auth", { auth: async () => actor ? { user: actor } : null });
inject("../src/lib/prisma", { prisma: db });
inject("../src/server/tasks/transaction", { withTaskTransaction: transaction });
inject("../src/server/plugins/changelog", { writeChangeLog: async (row: FixtureRow) => logs.push(JSON.parse(JSON.stringify(row)) as FixtureRow) });
inject("next/cache", { revalidatePath: () => {} });
const actions = require("../src/server/time/actions") as typeof import("../src/server/time/actions");
after(() => { for (const [file, old] of originals) if (old) require.cache[file] = old; else delete require.cache[file]; });
function reset(roles: Role[] = ["WORKER"], elapsed = 1200) {
  actor = { id: "actor", name: "QA", roles }; sequence = 0; logs = []; beforeUpdate = undefined;
  const status = roles.includes("ENGINEER") ? "DESIGN" : roles.includes("MOUNTER") ? "INSTALLATION" : "PRODUCTION";
  const project = { id: "project", deletedAt: null };
  const product = { id: "product", projectId: "project", project, engineerId: "actor", status, deletedAt: null };
  tasks = ["first", "second"].map(id => ({ id, title: id, assigneeId: "actor", productId: "product", projectId: "project", project, product, work: null, status: "NEW" }));
  timers = [{ id: "active", taskId: "first", userId: "actor", source: "timer", startedAt: new Date(instant.getTime() - elapsed * 60000), stoppedAt: null, minutes: 0, autoStopped: false }];
}
function expected(timer: Timer, elapsed: number) {
  assert.equal(timer.minutes, elapsed >= 720 ? 720 : elapsed);
  assert.equal(timer.stoppedAt?.getTime(), elapsed >= 720 ? timer.startedAt.getTime() + 720 * 60000 : instant.getTime());
  assert.equal(timer.autoStopped, elapsed >= 720);
}


test("actual stale stop cannot overwrite a concurrently confirmed auto-stop", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: instant.getTime() }); reset();
  beforeUpdate = () => Object.assign(timers[0], { minutes: 720, autoStopped: true, stoppedAt: new Date(timers[0].startedAt.getTime() + 720 * 60000) });
  await actions.stopTimer(); expected(timers[0], 1200);
});



test("timer lookup and stop resolve grants after their transaction boundary", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: instant.getTime() }); reset(["ACCOUNTANT"]);
  const original = db.timeEntry.findMany, originalFirst = db.timeEntry.findFirst;
  db.timeEntry.findMany = async args => { assert.equal(inTransaction, true); return original(args); };
  db.timeEntry.findFirst = async args => { assert.equal(inTransaction, true); return originalFirst(args); };
  try { assert.equal(await actions.getActiveTimer(), null); assert.equal((await actions.stopTimer()).ok, false); }
  finally { db.timeEntry.findMany = original; db.timeEntry.findFirst = originalFirst; }
  actor = null; await assert.rejects(actions.getActiveTimer(), /Не авторизован/);
});

test("explicit start after12h closes old same-task cap before beginning a new timer", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: instant.getTime() }); reset(["WORKER"], 1200);
  assert.equal((await actions.startTimer("first")).ok, true); expected(timers[0], 1200);
  assert.equal(timers.length, 2); assert.equal(timers[1].taskId, "first"); assert.equal(timers[1].startedAt.getTime(), instant.getTime());
  assert.equal(timers.filter(row => row.stoppedAt === null).length, 1);
});

test("close CAS retains current execution predicate when assignment is revoked after lookup", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: instant.getTime() }); reset(); const previous = structuredClone(timers[0]);
  beforeUpdate = () => { tasks[0].assigneeId = "other"; };
  assert.equal((await actions.stopTimer()).ok, false); assert.deepEqual(timers[0], previous);
});

test("manual office bounds and role union remain distinct from automatic cap", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: instant.getTime() });
  for (const roles of [["MANAGER"], ["ENGINEER"], ["WORKER", "ENGINEER"], ["ACCOUNTANT", "MANAGER"]] as Role[][]) {
    for (const minutes of [721, 1200, 1440]) { reset(roles); timers = []; assert.equal((await actions.addManualTime({ taskId: "first", minutes })).ok, true);
      assert.equal(timers[0].source, "manual"); assert.equal(timers[0].minutes, minutes); assert.equal(logs.length, 1); }
    reset(roles); const before = structuredClone(timers); assert.equal((await actions.addManualTime({ taskId: "first", minutes: 1441 })).ok, false); assert.deepEqual(timers, before);
  }
  for (const role of ["WORKER", "MOUNTER", "ACCOUNTANT", "PROCUREMENT"] as Role[]) {
    reset([role]); const before = structuredClone(timers); assert.equal((await actions.addManualTime({ taskId: "first", minutes: 1200 })).ok, false); assert.deepEqual(timers, before);
  }
});
