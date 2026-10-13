// Общие неизменённые сценарии native135; не создают клиентов или таймеров при import.
import {Prisma, type PrismaClient} from '@prisma/client';
import {createPostgresEventQueueStore} from '../src/server/plugins/event-queue-store';
import {createEventQueueProcessor} from '../src/server/plugins/event-queue-core';
import {EventDeliveryError, type EventQueueSettings, type OwnedDomainEvent} from '../src/server/plugins/event-queue-contract';
function check(value: unknown,code:string):asserts value{if(!value)throw Error('F135_'+code);}
export type Native135Plan={runId:string;actor:string;fixtures:readonly {id:string}[];orderIds:string[]};
export async function verifyNative135Cases(db:PrismaClient,peer:PrismaClient,pre:Native135Plan,settings:EventQueueSettings,setPhase:(phase:string)=>void=()=>{},orderingCycles:(processor:ReturnType<typeof createEventQueueProcessor>)=>Promise<number[]>=async processor=>[await processor.dispatchPending(50),await processor.dispatchPending(50)]){
 const runId=pre.runId,seededIds=pre.fixtures.map(row=>row.id);
    const own = createPostgresEventQueueStore(db, settings, seededIds), peerStore = createPostgresEventQueueStore(peer, settings, seededIds);
    const completed = await own.read(seededIds[0]), pending = await own.read(seededIds[1]);
    check(completed?.processedAt && completed.queueAttempts === 0 && pending?.attempts === 999 && pending.queueAttempts === 0, "MIGRATION_BUDGET_DEFAULTS");
    const cases: string[] = [];
    setPhase("two-backend-overlap");
    let releaseFirst: () => void = () => {}, signalFirst: () => void = () => {}, firstError: unknown, firstHeld = false, pid1 = 0, pid2 = 0;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; }), firstReady = new Promise<void>(resolve => { signalFirst = resolve; });
    const firstTransaction = db.$transaction(async tx => {
      pid1 = (await tx.$queryRaw<{ pid: number }[]>(Prisma.sql`SELECT pg_backend_pid() AS pid`))[0].pid;
      const claimed = await createPostgresEventQueueStore(tx, settings, seededIds).claim({ eventId: seededIds[1] }); check(claimed?.kind === "claimed", "FIRST_CLAIM_REQUIRED");
      firstHeld = true; signalFirst(); await firstGate; firstHeld = false; return claimed.event;
    }, { timeout: 5000 }).catch(error => { firstError = error; signalFirst(); return null; });
    await firstReady;
    try {
      if (firstError) throw firstError;
      await peer.$transaction(async tx => {
        pid2 = (await tx.$queryRaw<{ pid: number }[]>(Prisma.sql`SELECT pg_backend_pid() AS pid`))[0].pid;
        check(pid1 !== pid2 && firstHeld, "DISTINCT_OVERLAPPING_BACKENDS");
        check(!await createPostgresEventQueueStore(tx, settings, seededIds).claim({ eventId: seededIds[1] }), "LOCKED_CLAIM_SKIPPED");
        check(firstHeld, "OVERLAP_WITNESS_LOST");
      });
    } finally { releaseFirst(); await firstTransaction; }
    if (firstError) throw firstError;
    const first = await firstTransaction; check(first, "FIRST_CLAIM_REQUIRED"); cases.push("distinct pg_backend_pid with held-claim overlap");
    check((await own.observe(first.id))?.leaseActive, "OBSERVE_ACTIVE_DB_CLOCK");
    await db.$executeRaw(Prisma.sql`UPDATE "DomainEvent" SET "leaseUntil"=clock_timestamp()-interval '1 second' WHERE "id"=${first.id} AND "actor"=${pre.actor}`);
    check((await own.observe(first.id))?.leaseActive === false, "OBSERVE_EXPIRED_DB_CLOCK");
    const replacement = await peerStore.claim({ eventId: first.id }); check(replacement?.kind === "claimed" && replacement.event.claimToken !== first.claimToken, "RECLAIM_REQUIRED");
    check(!await own.complete(first) && !await own.renew(first) && !await own.fail(first, "STALE"), "STALE_FENCE_REQUIRED");
    check(await peerStore.complete(replacement.event), "CURRENT_ACK_REQUIRED");
    const completedObservation = await own.observe(first.id); check(completedObservation?.event.processedAt && !completedObservation.leaseActive, "OBSERVE_DURABLE_COMPLETION"); cases.push("expiry/reclaim/stale ACK-renew-fail");
    setPhase("expiry-during-row-wait");
    const result = await own.claim({ eventId: seededIds[2] }); check(result?.kind === "claimed", "INTERNAL_CLAIM_REQUIRED"); const internal: OwnedDomainEvent = result.event;
    const [{ leaseUntil }] = await db.$queryRaw<{ leaseUntil: Date }[]>(Prisma.sql`UPDATE "DomainEvent" SET "leaseUntil"=clock_timestamp()+interval '2 seconds' WHERE "id"=${internal.id} AND "actor"=${pre.actor} RETURNING "leaseUntil"`);
    let unlock: () => void = () => {}, locked: () => void = () => {}, waiterReady: () => void = () => {}, witnessed: () => void = () => {};
    let lockFailure: unknown, waiterPid = 0;
    let waitWitness: { lockerPid: number; waiterPid: number; observed: string; leaseUntil: string } | null = null;
    const held = new Promise<void>(resolve => { locked = resolve; }), gate = new Promise<void>(resolve => { unlock = resolve; });
    const waiterKnown = new Promise<void>(resolve => { waiterReady = resolve; }), waitingObserved = new Promise<void>(resolve => { witnessed = resolve; });
    const locker = db.$transaction(async tx => {
      const [{ pid: lockerPid }] = await tx.$queryRaw<{ pid: number }[]>(Prisma.sql`SELECT pg_backend_pid() AS pid`);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "DomainEvent" WHERE "id"=${internal.id} FOR UPDATE`); locked();
      await waiterKnown; check(waiterPid > 0 && lockerPid !== waiterPid, "DISTINCT_ROW_WAIT_BACKENDS");
      const deadline = performance.now() + 2000;
      while (performance.now() < deadline) {
        const [{ observed, waiting }] = await tx.$queryRaw<{ observed: Date; waiting: boolean }[]>(Prisma.sql`SELECT clock_timestamp() AS observed,
          EXISTS(SELECT 1 FROM pg_locks WHERE pid=${waiterPid} AND NOT granted) AS waiting`);
        check(observed.getTime() < leaseUntil.getTime(), "WAIT_WITNESS_BEFORE_EXPIRY_REQUIRED");
        if (waiting) { waitWitness = { lockerPid, waiterPid, observed: observed.toISOString(), leaseUntil: leaseUntil.toISOString() }; witnessed(); await gate; return; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      check(false, "ROW_WAIT_WITNESS_REQUIRED");
    }, { timeout: 6000 }).catch(error => { lockFailure = error; locked(); witnessed(); });
    let delayed: Promise<{ value: boolean; error: unknown }> | null = null;
    try {
      await held; if (lockFailure) throw lockFailure;
      delayed = peer.$transaction(async tx => {
        waiterPid = (await tx.$queryRaw<{ pid: number }[]>(Prisma.sql`SELECT pg_backend_pid() AS pid`))[0].pid; waiterReady();
        return createPostgresEventQueueStore(tx, settings, seededIds).complete(internal);
      }, { timeout: 6000 }).then(value => ({ value, error: null }), error => { waiterReady(); return { value: false, error }; });
      await waitingObserved; if (lockFailure) throw lockFailure;
      const witness = waitWitness as { lockerPid: number; waiterPid: number; observed: string; leaseUntil: string } | null;
      check(witness, "ROW_WAIT_WITNESS_REQUIRED");
      await new Promise(resolve => setTimeout(resolve, leaseUntil.getTime() - new Date(witness.observed).getTime() + 150)); unlock(); await locker;
      if (lockFailure) throw lockFailure; const outcome = await delayed; if (outcome.error) throw outcome.error;
      check(!outcome.value && !(await own.read(internal.id))?.processedAt, "EXPIRY_AFTER_ROW_LOCK");
    } finally { unlock(); await locker; if (delayed) await delayed; }
    cases.push("distinct-backend pg_locks wait before expiry; post-lock DB clock rejects stale ACK");
    await db.$executeRaw(Prisma.sql`UPDATE "DomainEvent" SET "queueAttempts"=${settings.maxAttempts},"leaseUntil"=clock_timestamp()-interval '1 second' WHERE "id"=${internal.id} AND "actor"=${pre.actor}`);
    check((await peerStore.claim({ eventId: internal.id }))?.kind === "exhausted", "LAST_CRASH_EXHAUSTED"); check(!await peerStore.claim({ eventId: internal.id }), "EXHAUSTED_NOT_READY");
    const manual = await peerStore.claim({ eventId: internal.id, internalRetry: true }); check(manual?.kind === "claimed" && manual.event.queueAttempts === 1 && manual.event.attempts > internal.attempts, "INTERNAL_HISTORY_RETRY");
    check(!await own.claim({ eventId: internal.id, internalRetry: true }), "ACTIVE_NOT_STOLEN"); check(await peerStore.complete(manual.event), "INTERNAL_ACK_REQUIRED");
    check(!await peerStore.claim({ eventId: internal.id, internalRetry: true }) && !await own.claim({ eventId: seededIds[0] }), "COMPLETED_NOT_REOPENED");
    check(!await createPostgresEventQueueStore(db, settings, []).claim(), "EMPTY_SCOPE_NOT_GLOBAL"); cases.push("last crash/internal retry/no active steal/completed preserved");
    setPhase("ordering-51");
    const collision = await db.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "DomainEvent" WHERE "id" IN (${Prisma.join(pre.orderIds)})`); check(collision.length === 0, "ORDERING_COLLISION");
    await db.domainEvent.createMany({ data: pre.orderIds.map((id, index) => ({ id, actor: pre.actor, type: "qa135.fixture", payload: { qa135Run: runId, index }, createdAt: new Date(index), nextAttemptAt: new Date(0) })) });
    let healthy = 0;
    const benchmarkStore = createPostgresEventQueueStore(db, settings, pre.orderIds), benchmark = createEventQueueProcessor({ store: benchmarkStore, settings, deliver: async event => {
      const payload=event.payload as {qa135Run?:unknown;index?:unknown};
      check(event.actor===pre.actor&&event.type==='qa135.fixture'&&payload.qa135Run===runId&&typeof payload.index==='number'&&Number.isInteger(payload.index)&&payload.index>=0&&payload.index<=50&&event.id===pre.orderIds[payload.index]&&Object.keys(payload).sort().join('|')==='index|qa135Run','EXACT_LITERAL_DELIVERY_SCOPE');
      if (payload.index < 50) throw new EventDeliveryError("EVENT_DELIVERY_FAILED"); healthy++;
    } });
    check((await orderingCycles(benchmark)).join("|") === "50|1" && healthy === 1, "NATIVE_ORDERING_SECOND_CYCLE");
    check((await benchmarkStore.read(pre.orderIds[50]))?.processedAt, "HEALTHY_PROCESSED"); cases.push("real SQL 50failures+1healthy delivered in second cycle");

 return {backendPids:[pid1,pid2],heldOverlapWitness:true,waitWitness,cases};
}

const safeErrnos = new Set(["EACCES", "EPERM", "ENOENT", "ENOTDIR", "EISDIR", "ELOOP", "ENOSPC", "EIO", "EMFILE", "ENFILE", "EAGAIN", "EINVAL", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENOMEM", "ENOEXEC"]);
/** Приватные raw message/URL/stack/cause не выходят даже при ошибке до первого DB connection. */
export function nativeFailureDiagnostic(error: unknown, phase: string, sourceHash: string | null) {
  const row = typeof error === "object" && error !== null ? error as { message?: unknown; code?: unknown } : {};
  const code = typeof row.message === "string" && /^F135_[A-Z0-9_]{1,64}$/.test(row.message) ? row.message : "F135_NATIVE_FAILED";
  const databaseCode = typeof row.code === "string" && /^P\d{4}$/.test(row.code) ? row.code : null;
  const errno = typeof row.code === "string" && safeErrnos.has(row.code) ? row.code : null;
  return { ok: false, phase: /^[a-z][a-z0-9-]{0,47}$/.test(phase) ? phase : "native", code, databaseCode, errno,
    hold: true, sourceHash: typeof sourceHash === "string" && /^[a-f0-9]{64}$/.test(sourceHash) ? sourceHash : null };
}
