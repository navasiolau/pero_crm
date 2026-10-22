import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { timerStopSnapshot } from "./timers";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function guard(condition: unknown, code: string): asserts condition { if (!condition) throw Error(code); }
const revision = z.string().regex(/^[a-f0-9]{40}$/);
const databaseSchema = z.object({ name: z.string().min(1), schema: z.literal("public"), systemIdentifier: z.string().regex(/^\d+$/) }).strict();
const targetSchema = z.object({ kind: z.enum(["local5433", "staging"]), revision,
  imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(), database: databaseSchema }).strict()
  .refine(value => value.kind === "local5433" || value.imageDigest !== null, "Для staging требуется digest фактического образа");
export type TaskTimeCutoffTarget = z.infer<typeof targetSchema>;
const requestSchema = z.object({ operationId: z.uuid().transform(value => value.toLowerCase()), actorId: z.string().min(1),
  retiredRevision: revision, target: targetSchema }).strict().refine(value => value.retiredRevision !== value.target.revision, "Нужен новый SHA без writers времени");
export type TaskTimeCutoffRequest = z.infer<typeof requestSchema>;
export type TaskTimeCutoffPorts = {
  transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  /** Root проверяет живую local5433/paired staging identity, новый SHA и отсутствие старых writers; флаг не заменяет proof. */
  verifyTargetAndNoOldWriters(expected: TaskTimeCutoffTarget, retiredRevision: string): Promise<TaskTimeCutoffTarget>;
};

async function assertTarget(tx: Prisma.TransactionClient, ports: TaskTimeCutoffPorts, request: TaskTimeCutoffRequest) {
  const actual = targetSchema.parse(await ports.verifyTargetAndNoOldWriters(request.target, request.retiredRevision));
  guard(JSON.stringify(actual) === JSON.stringify(request.target), "TASK_TIME_CUTOFF_TARGET_MISMATCH");
  guard(request.target.database.name === (request.target.kind === "local5433" ? "pero_crm" : "crm"), "TASK_TIME_CUTOFF_DATABASE_NOT_ALLOWED");
  const rows = await tx.$queryRaw<{ name: string; schema: string; systemIdentifier: string }[]>`
    SELECT current_database() AS name,current_schema() AS schema,system_identifier::text AS "systemIdentifier" FROM pg_control_system()`;
  guard(rows.length === 1 && JSON.stringify(databaseSchema.parse(rows[0])) === JSON.stringify(request.target.database), "TASK_TIME_CUTOFF_DATABASE_MISMATCH");
}

async function lockCutoff(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
  await tx.$executeRaw`LOCK TABLE "TimeEntry" IN SHARE ROW EXCLUSIVE MODE NOWAIT`;
}

async function authorize(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, name: true, active: true, roles: true } });
  guard(actor?.active && actor.roles.includes("ADMIN"), "TASK_TIME_CUTOFF_ADMIN_REQUIRED");
  return actor;
}

async function snapshot(tx: Prisma.TransactionClient) {
  return tx.timeEntry.findMany({ where: { source: "timer", stoppedAt: null }, orderBy: { id: "asc" },
    select: { id: true, taskId: true, userId: true, source: true, startedAt: true, stoppedAt: true, minutes: true, autoStopped: true } });
}
export type TaskTimeCutoffPlan = { schema: 1; request: TaskTimeCutoffRequest; timers: Awaited<ReturnType<typeof snapshot>>; fingerprint: string };

/** Только чтение плана; импорт модуля не создаёт соединение и не запускает cutoff. */
export async function planTaskTimeCutoff(ports: TaskTimeCutoffPorts, input: TaskTimeCutoffRequest): Promise<TaskTimeCutoffPlan> {
  const request = requestSchema.parse(input);
  return ports.transaction(async tx => {
    await assertTarget(tx, ports, request); await lockCutoff(tx); await authorize(tx, request.actorId);
    const plan = { schema: 1 as const, request, timers: await snapshot(tx) };
    await assertTarget(tx, ports, request);
    return { ...plan, fingerprint: digest(plan) };
  });
}

/** Не подключено к web/API/cron. Apply только через reviewed Root transport с точным hash плана. */
export async function applyTaskTimeCutoff(ports: TaskTimeCutoffPorts, plan: TaskTimeCutoffPlan, reviewedFingerprint: string) {
  const request = requestSchema.parse(plan.request);
  guard(plan.schema === 1 && /^[a-f0-9]{64}$/.test(reviewedFingerprint) && plan.fingerprint === reviewedFingerprint &&
    digest({ schema: 1, request, timers: plan.timers }) === reviewedFingerprint, "TASK_TIME_CUTOFF_PLAN_MISMATCH");
  return ports.transaction(async tx => {
    await assertTarget(tx, ports, request); await lockCutoff(tx);
    const actor = await authorize(tx, request.actorId), receiptId = `task-time-cutoff:${request.operationId}`;
    const previous = await tx.changeLog.findUnique({ where: { id: receiptId } });
    if (previous) {
      const saved = previous.newValue;
      guard(previous.actorId === actor.id && previous.entity === "taskTimeCutoff" && previous.entityId === request.operationId && previous.action === "retire" &&
        saved && typeof saved === "object" && !Array.isArray(saved) && saved.fingerprint === reviewedFingerprint && typeof saved.cutoffAt === "string", "TASK_TIME_CUTOFF_OPERATION_REUSED");
      await assertTarget(tx, ports, request);
      return { operationId: request.operationId, replayed: true, closedIds: plan.timers.map(row => row.id), cutoffAt: saved.cutoffAt };
    }
    const timers = await snapshot(tx);
    guard(digest(timers) === digest(plan.timers), "TASK_TIME_CUTOFF_SNAPSHOT_CHANGED");
    const cutoffAt = (await tx.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`)[0]?.at;
    guard(cutoffAt instanceof Date && Number.isFinite(cutoffAt.getTime()), "TASK_TIME_CUTOFF_CLOCK_UNAVAILABLE");
    const closed = [];
    for (const timer of timers) {
      const data = timerStopSnapshot(timer.startedAt, cutoffAt);
      const changed = await tx.timeEntry.updateMany({ where: { id: timer.id, taskId: timer.taskId, userId: timer.userId,
        source: "timer", stoppedAt: null, startedAt: timer.startedAt, minutes: timer.minutes, autoStopped: timer.autoStopped }, data });
      guard(changed.count === 1, "TASK_TIME_CUTOFF_TIMER_CONFLICT");
      const result = { id: timer.id, taskId: timer.taskId, userId: timer.userId, ...data, stoppedAt: data.stoppedAt.toISOString() };
      closed.push(result);
      await tx.changeLog.create({ data: { id: `${receiptId}:${timer.id}`, actorType: "user", actorId: actor.id, actorName: actor.name, source: "api",
        entity: "timeEntry", entityId: timer.id, action: "timer.retire", oldValue: JSON.parse(JSON.stringify(timer)) as Prisma.InputJsonValue,
        newValue: { ...result, cutoffAt: cutoffAt.toISOString(), operationId: request.operationId }, createdAt: cutoffAt } });
    }
    await tx.changeLog.create({ data: { id: receiptId, actorType: "user", actorId: actor.id, actorName: actor.name, source: "api",
      entity: "taskTimeCutoff", entityId: request.operationId, action: "retire",
      newValue: { fingerprint: reviewedFingerprint, target: request.target, retiredRevision: request.retiredRevision, cutoffAt: cutoffAt.toISOString(), closed }, createdAt: cutoffAt } });
    await assertTarget(tx, ports, request);
    return { operationId: request.operationId, replayed: false, closedIds: closed.map(row => row.id), cutoffAt: cutoffAt.toISOString() };
  });
}
