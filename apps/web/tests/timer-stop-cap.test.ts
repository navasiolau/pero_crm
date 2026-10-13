import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { after, test } from "node:test";
import type { TaskTransaction } from "../src/server/tasks/transaction";
import { taskShareFixture } from "./helpers/task-share-fixture";
import type { FixtureRow } from "./helpers/visibility-fixture";

const require = createRequire(import.meta.url), originals = new Map<string, NodeJS.Module | undefined>();
function inject(name: string, exports: Record<string, unknown>) { const file = require.resolve(name); originals.set(file, require.cache[file]);
  const stub = new Module(file); stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub; }
const instant = new Date("2026-10-11T12:00:00Z");
let fixture = taskShareFixture(), outsideAuditFault = false;
const transaction: TaskTransaction = operation => fixture.transaction(tx => operation(new Proxy(tx, { get(db, key) {
  if (key === "$executeRaw") return async (strings: TemplateStringsArray, value: string) => {
    const field = strings.join("?").includes('WHERE "userId"') ? "userId" : "taskId";
    for (const timer of fixture.state().times) if (timer[field] === value && timer.stoppedAt !== null && timer.minutes === 0)
      timer.minutes = Math.max(1, Math.floor(((timer.stoppedAt as Date).getTime() - (timer.startedAt as Date).getTime()) / 60000));
    return 0;
  }; return Reflect.get(db, key);
} })));
inject("../src/lib/prisma", { prisma: new Proxy({}, { get: (_db, key) => fixture.database[key as keyof typeof fixture.database] }) });
inject("../src/auth", { auth: async () => ({ user: { id: "manager", name: "QA", roles: ["MANAGER"] } }) });
inject("../src/server/tasks/transaction", { withTaskTransaction: transaction });
inject("../src/server/plugins/changelog", { writeChangeLog: async (data: FixtureRow) => { if (outsideAuditFault) throw Error("QA132_AUDIT_FAULT"); fixture.state().logs.push(JSON.parse(JSON.stringify(data)) as FixtureRow); } });
inject("../src/server/plugins/events", { emitDomainEvent: async () => {}, dispatchEvent: async () => {} });
inject("../src/server/notifications/notify", { notifyOrg: async () => {}, notifyPerson: async () => {} });
inject("../src/server/products/revalidate", { revalidateProductPaths: async () => {} });
inject("next/cache", { revalidatePath: () => {} });
const { changeTaskStatusCore } = require("../src/server/tasks/completion-core") as typeof import("../src/server/tasks/completion-core");
const { updateTask } = require("../src/server/tasks/actions") as typeof import("../src/server/tasks/actions");
after(() => { for (const [file, old] of originals) if (old) require.cache[file] = old; else delete require.cache[file]; });
function reset(elapsed = 1200) {
  fixture = taskShareFixture(); outsideAuditFault = false;
  Object.assign(fixture.state().times[0], { source: "timer", startedAt: new Date(instant.getTime() - elapsed * 60000), minutes: 0, autoStopped: false });
}



test("mandatory reassignment audit failure rolls timer and assignment back together", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: instant.getTime() }); reset();
  const before = structuredClone(fixture.state()); outsideAuditFault = true; fixture.failOn("log.create");
  await assert.rejects(updateTask("source", { assigneeId: "recipient" }), /QA132_AUDIT_FAULT|Injected transactional failure/);
  assert.deepEqual(fixture.state(), before);
});

test("one pure snapshot covers second/minute/12h boundaries without mutating input dates", () => {
  const { timerStopSnapshot } = require("../src/server/time/timers") as typeof import("../src/server/time/timers");
  for (const [elapsed, minutes, autoStopped] of [[0, 1, false], [59000, 1, false], [719 * 60000 + 59000, 719, false],
    [720 * 60000 - 1, 719, false], [720 * 60000, 720, true], [721 * 60000, 720, true], [1200 * 60000, 720, true]] as const) {
    const start = new Date(instant.getTime() - elapsed), before = start.getTime();
    const stopped = timerStopSnapshot(start, instant);
    assert.equal(stopped.minutes, minutes); assert.equal(stopped.autoStopped, autoStopped);
    assert.equal(stopped.stoppedAt.getTime(), autoStopped ? before + 720 * 60000 : instant.getTime()); assert.equal(start.getTime(), before);
  }
  assert.throws(() => timerStopSnapshot(new Date(NaN), instant), /Некорректная дата/);
});

test("updateTask audit preserves exact previous JSON normalization and one visible business row", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: instant.getTime() }); reset();
  const previous = structuredClone(fixture.state().tasks[0]);
  const input = { title: "Уточнено", dueAt: "2026-10-12", estimateMinutes: 15, assigneeId: "recipient" };
  assert.equal((await updateTask("source", input)).ok, true);
  const [audit] = fixture.state().logs; assert.equal(fixture.state().logs.length, 1);
  assert.equal(audit.actorType, "user"); assert.equal(audit.actorId, "manager"); assert.equal(audit.actorName, "QA");
  assert.equal(audit.entity, "task"); assert.equal(audit.entityId, "source"); assert.equal(audit.action, "update"); assert.equal(audit.source, "web");
  assert.deepEqual(audit.oldValue, JSON.parse(JSON.stringify({ title: previous.title, type: previous.type, assigneeId: previous.assigneeId, dueAt: previous.dueAt, status: previous.status })));
  assert.deepEqual(audit.newValue, { ...input, status: "IN_PROGRESS" });
});

test("office completion manual minutes remain above720 and engineering reassignment remains rejected", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: instant.getTime() });
  for (const minutes of [721, 1200, 1440]) {
    reset(); fixture.state().times.length = 0;
    const result = await changeTaskStatusCore({ id: "manager", name: "QA", roles: ["MANAGER"], source: "web" }, "source", "DONE", minutes, transaction);
    assert.equal(result.ok, true); assert.equal(fixture.state().times[0].source, "manual"); assert.equal(fixture.state().times[0].minutes, minutes);
  }
  fixture = taskShareFixture("DESIGN");
  Object.assign(fixture.state().works[0], { paymentKind: "ENGINEERING", stagePayPoolId: "pool", poolWeightUnits: 1000000 });
  const previous = structuredClone(fixture.state());
  assert.equal((await updateTask("source", { assigneeId: "recipient" })).ok, false); assert.deepEqual(fixture.state(), previous);
});


import { TIMER_NATIVE_MANIFEST, assertTimerNativeApproval, timerNativeFailureCode, timerNativeHash, timerNativePins, timerNativeLockWitness, timerNativeBounded, type TimerNativeLockRow, type TimerNativeApproval } from "./timer-stop-cap-native";

test("native132 operation/source/target/lease guards reject without any database connection", () => {
  const hash = "a".repeat(64);
  const valid: TimerNativeApproval = { source: "root-reviewed", operation: "execute", runId: TIMER_NATIVE_MANIFEST.runId,
    sourceHash: hash, containerId: TIMER_NATIVE_MANIFEST.containerId, exclusiveLocalWindow: true, localOutboxInactive: true, observationEvidence: "root fresh observed existing local identity and no runtime" };
  assert.doesNotThrow(() => assertTimerNativeApproval(valid, hash));
  for (const changed of [{ source: "other" }, { operation: "diagnostic" }, { runId: "other" }, { sourceHash: "b".repeat(64) },
    { containerId: "c".repeat(64) }, { exclusiveLocalWindow: false }, { localOutboxInactive: false }, { observationEvidence: "" }])
    assert.throws(() => assertTimerNativeApproval({ ...valid, ...changed } as TimerNativeApproval, hash), /QA132_/);
  assert.equal(timerNativeFailureCode(Error("QA132_TARGET_STOP\nraw secret/URL")), "QA132_TARGET_STOP");
  assert.equal(timerNativeFailureCode(Error("raw secret and user details")), "QA132_SCENARIO_STOP");
});

test("native132 cold source closure pins all four production files and target/QA/runtime guards", async () => {
  const pins = await timerNativePins();
  for (const file of ["src/server/time/timers.ts", "src/server/time/actions.ts", "src/server/tasks/completion-core.ts", "src/server/tasks/actions.ts",
    "tests/timer-stop-cap-native.ts", "tests/helpers/local-crm-database.ts", "prisma/schema.prisma", "../../packages/plugins/demo/src/plugin.ts"])
    assert.equal(pins.some(pin => pin.file === file), true, file);
  assert.equal(pins.some(pin => pin.file.endsWith("runtime/library.js")), true); assert.match(timerNativeHash(pins), /^[a-f0-9]{64}$/);
  assert.ok(pins.every(pin => !pin.file.startsWith("<") && /^[a-f0-9]{64}$/.test(pin.sha256)));
});


test("native132 overlap requires actual same-lock holder and blocked waiter on independent backends", async () => {
  const holder: TimerNativeLockRow = { pid: 101, locktype: "advisory", database: 132, classid: 18435, objid: 55001, objsubid: 2, mode: "ExclusiveLock", granted: true };
  const waiter: TimerNativeLockRow = { ...holder, pid: 102, granted: false };
  assert.deepEqual(timerNativeLockWitness([holder, waiter], 101, 102), { holder, waiter });
  for (const rows of [[], [holder], [holder, { ...waiter, granted: true }], [holder, { ...waiter, pid: 103 }],
    [holder, { ...waiter, database: 133 }], [holder, { ...waiter, objsubid: 1 }], [holder, { ...waiter, classid: 55001 }],
    [holder, { ...waiter, objid: 18435 }], [holder, { ...waiter, mode: "ShareLock" }], [holder, { ...waiter, locktype: "relation" }]])
    assert.equal(timerNativeLockWitness(rows, 101, 102), undefined);
  assert.throws(() => timerNativeLockWitness([holder, waiter], 101, 101), /QA132_CONNECTION_STOP/);
  assert.equal(await timerNativeBounded(Promise.resolve("released"), performance.now() + 1000), "released");
  await assert.rejects(timerNativeBounded(new Promise<void>(() => {}), performance.now() + 5), /QA132_LOCK_BARRIER_TIMEOUT/);
});
