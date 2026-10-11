import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, open, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, Prisma } from "@prisma/client";
import { createPostgresEventQueueStore } from "../src/server/plugins/event-queue-store";
import { createEventQueueProcessor } from "../src/server/plugins/event-queue-core";
import { DEFAULT_EVENT_QUEUE_SETTINGS, EventDeliveryError, type OwnedDomainEvent } from "../src/server/plugins/event-queue-contract";
import { OBSOLETE_SKETCH_EVENT, obsoleteSketchEventId } from "../src/server/products/sketch-cleanup-contract";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return "{" + Object.keys(row).sort().map(key => JSON.stringify(key) + ":" + canonical(row[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}
const digest = (value: unknown) => sha(canonical(value));
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`F135_${code}`); }
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const resultsRoot = fileURLToPath(new URL("../test-results/event-queue-native/", import.meta.url));
const legacyColumns = Prisma.sql`"id", "type", "payload", "actor", "createdAt", "processedAt", "attempts", "lastError"`;
const addedColumns = ["queueAttempts", "claimToken", "leaseUntil", "nextAttemptAt", "exhaustedAt"];
const sourcePaths = ["apps/web/prisma/schema.prisma", "apps/web/prisma/migrations/20261011120000_domain_event_queue/migration.sql",
  "apps/web/src/server/plugins/event-queue-store.ts", "apps/web/src/server/plugins/event-queue-contract.ts", "apps/web/src/server/plugins/event-queue-core.ts",
  "apps/web/src/server/products/sketch-cleanup-contract.ts", "pnpm-lock.yaml", "apps/web/tests/event-queue-store-native.ts"];
const orderIds = (runId: string) => Array.from({ length: 51 }, (_, index) => `qa135:${runId}:order-${index}`);
const staticFacts = (row: Record<string, unknown>) => ({ id: row.id, type: row.type, payload: row.payload, actor: row.actor, createdAt: row.createdAt });
type Blueprint = { id: string; type: string; payload: unknown; actor: string; createdAt: string; processedAt: string | null; attempts: number; lastError: string };
type Pre = { namespace: "qa135-native-v2"; kind: "pre"; runId: string; actor: string; containerId: string; sourceHash: string; pins: Record<string, string>;
  fixtures: Blueprint[]; orderIds: string[]; protectedHash: string; protectedCount: number; mutationId: string };
type Observation = { namespace: "qa135-native-v2"; kind: "observation"; runId: string; preHash: string; sourceHash: string;
  ids: string[]; ownedHash: string; protectedHash: string; protectedCount: number; activeClaims: number };

async function privatePath(name: string) {
  check(/^[a-f0-9-]+\.(pre|prepared|verify|observe-[a-f0-9-]+|cleanup-intent-[a-f0-9-]+|cleanup-ack)\.json$/.test(name), "PRIVATE_PART_NAME");
  let current = path.parse(resultsRoot).root;
  for (const part of path.relative(current, resultsRoot).split(path.sep)) {
    current = path.join(current, part);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    check(!info?.isSymbolicLink(), "CHECKPOINT_REPARSE_GUARD");
  }
  await mkdir(resultsRoot, { recursive: true });
  const target = path.join(resultsRoot, name);
  const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  check(!existing?.isSymbolicLink(), "CHECKPOINT_REPARSE_GUARD"); return target;
}
async function publish(name: string, value: unknown) {
  const target = await privatePath(name), bytes = Buffer.from(JSON.stringify(value, null, 2));
  const handle = await open(target, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  check(sha(await readFile(target)) === sha(bytes), "DURABLE_PART_READBACK"); return { file: target, sha256: sha(bytes), semanticHash: digest(value) };
}
async function sourcePins() {
  return Object.fromEntries(await Promise.all(sourcePaths.map(async relative => [relative, sha(await readFile(path.join(repoRoot, relative)))])));
}
async function targetUrl(expectedContainer: string, phase: (value: string) => void) {
  check(/^[a-f0-9]{64}$/.test(expectedContainer), "CONTAINER_ID_REQUIRED");
  phase("docker");
  const raw = execFileSync("docker", ["inspect", "--format", '{{.Id}}|{{.State.Running}}|{{.State.Paused}}|{{.State.Restarting}}|{{json .NetworkSettings.Ports}}', "pero_crm_pg"], { encoding: "utf8" });
  const [id, running, paused, restarting, portsJson] = raw.trim().split("|");
  const ports = JSON.parse(portsJson) as Record<string, { HostIp: string; HostPort: string }[] | null>;
  check(id === expectedContainer && running === "true" && paused === "false" && restarting === "false", "DOCKER_IDENTITY_GUARD");
  check(ports["5432/tcp"]?.some(binding => binding.HostIp === "127.0.0.1" && binding.HostPort === "5433"), "DOCKER_PORT_GUARD");
  phase("private-config");
  let databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    const text = (await readFile("D:/Projects/pero_crm_v2/.env", "utf8")).replace(/^\uFEFF/, "");
    const match = text.match(/^DATABASE_URL\s*=\s*(.+)$/m); check(match, "DATABASE_URL_MISSING"); databaseUrl = match[1].trim();
    if ((databaseUrl.startsWith('"') && databaseUrl.endsWith('"')) || (databaseUrl.startsWith("'") && databaseUrl.endsWith("'"))) databaseUrl = databaseUrl.slice(1, -1);
  }
  phase("database-url");
  const url = new URL(databaseUrl);
  check(["postgresql:", "postgres:"].includes(url.protocol) && ["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "5433" &&
    url.pathname === "/pero_crm" && (!url.searchParams.has("schema") || url.searchParams.get("schema") === "public") && !url.searchParams.has("options"), "DATABASE_TARGET_GUARD");
  return databaseUrl;
}
async function dbGuard(db: PrismaClient) {
  const identity = await db.$queryRaw<{ name: string; schema: string; recovery: boolean }[]>(Prisma.sql`SELECT current_database() AS name, current_schema() AS schema, pg_is_in_recovery() AS recovery`);
  check(identity[0]?.name === "pero_crm" && identity[0]?.schema === "public" && identity[0]?.recovery === false, "DATABASE_IDENTITY_GUARD");
}
type ReadDb = Pick<Prisma.TransactionClient, "$queryRaw">;
async function legacyRows(db: ReadDb, exclude: readonly string[]) {
  const filter = exclude.length ? Prisma.sql`"id" NOT IN (${Prisma.join(exclude)})` : Prisma.sql`TRUE`;
  return db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT ${legacyColumns} FROM "DomainEvent" WHERE ${filter} ORDER BY "id"`);
}
async function columnNames(db: ReadDb) {
  return (await db.$queryRaw<{ column_name: string }[]>(Prisma.sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='DomainEvent'`)).map(row => row.column_name);
}
function allIds(pre: Pre) { return [...pre.fixtures.map(row => row.id), ...pre.orderIds]; }
function expectedStatic(pre: Pre, id: string) {
  const legacy = pre.fixtures.find(row => row.id === id); if (legacy) return staticFacts(legacy);
  const index = pre.orderIds.indexOf(id); check(index >= 0, "UNKNOWN_FIXTURE_ID");
  return { id, type: "qa135.fixture", payload: { qa135Run: pre.runId, index }, actor: pre.actor, createdAt: new Date(index).toISOString() };
}
function validateOwned(pre: Pre, rows: Record<string, unknown>[]) {
  const allowed = allIds(pre);
  check(rows.every(row => typeof row.id === "string" && allowed.includes(row.id) && row.actor === pre.actor && digest(staticFacts(row)) === digest(expectedStatic(pre, row.id))), "OWNED_IMMUTABLE_GUARD");
}
async function observe(db: PrismaClient, pre: Pre, sourceHash: string): Promise<Observation> {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const ids = allIds(pre), rows = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT * FROM "DomainEvent" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id"`);
    validateOwned(pre, rows);
    const foreign = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "DomainEvent" WHERE "actor"=${pre.actor} AND "id" NOT IN (${Prisma.join(ids)})`);
    check(foreign.length === 0, "UNDECLARED_OWN_ROWS");
    const [{ observed }] = await tx.$queryRaw<{ observed: Date }[]>(Prisma.sql`SELECT clock_timestamp() AS observed`);
    const protectedRows = await legacyRows(tx, ids); check(digest(protectedRows) === pre.protectedHash && protectedRows.length === pre.protectedCount, "PROTECTED_DATA_GUARD");
    return { namespace: "qa135-native-v2", kind: "observation", runId: pre.runId, preHash: digest(pre), sourceHash,
      ids: rows.map(row => String(row.id)), ownedHash: digest(rows), protectedHash: digest(protectedRows), protectedCount: protectedRows.length,
      activeClaims: rows.filter(row => row.leaseUntil instanceof Date && row.leaseUntil.getTime() > observed.getTime()).length };
  }, { isolationLevel: "RepeatableRead", timeout: 15_000 });
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
/** Импорт файла ничего не запускает; actual writes только после отдельного reviewer/root/window GO. */
export async function runEventQueueNative(args: string[]) {
  const clients: PrismaClient[] = [];
  let phase = "arguments", frozenHash: string | null = null;
  try {
    check(args.includes("--authorized-local"), "LOCAL_AUTHORIZATION_FLAG_REQUIRED");
    const argument = (name: string) => { const index = args.indexOf(name); check(index >= 0 && args[index + 1], "ARGUMENT_REQUIRED"); return args[index + 1]; };
    const mode = argument("--mode"); check(["prepare", "verify", "inspect", "cleanup"].includes(mode), "MODE_INVALID");
    const runId = argument("--run-id"), containerId = argument("--container-id"), sourceHash = argument("--source-hash");
    check(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runId), "RUN_ID_INVALID");
    frozenHash = /^[a-f0-9]{64}$/.test(sourceHash) ? sourceHash : null; phase = "source";
    const pins = await sourcePins(); check(sha(JSON.stringify(pins)) === sourceHash, "SOURCE_PIN_GUARD");
    const databaseUrl = await targetUrl(containerId, value => { phase = value; }); phase = "client";
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } }); clients.push(db);
    const peer = new PrismaClient({ datasources: { db: { url: databaseUrl } } }); clients.push(peer);
    const settings = { ...DEFAULT_EVENT_QUEUE_SETTINGS, enabled: false }; phase = "target";
    await dbGuard(db); await dbGuard(peer);
    if (mode === "prepare") {
      phase = "prepare-pre";
      const columns = await columnNames(db); check(addedColumns.every(name => !columns.includes(name)), "EXPECTED_PRE_MIGRATION_SCHEMA");
      const actor = `qa135:${runId}`, mutationId = randomUUID(), stamp = "2026-10-11T00:00:00.000Z";
      const fixtures: Blueprint[] = [
        { id: `qa135:${runId}:completed`, type: "qa135.fixture", payload: { qa135Run: runId, kind: "completed" }, actor, createdAt: stamp, processedAt: stamp, attempts: 5, lastError: "QA135_HISTORY" },
        { id: `qa135:${runId}:pending`, type: "qa135.fixture", payload: { qa135Run: runId, kind: "pending" }, actor, createdAt: stamp, processedAt: null, attempts: 999, lastError: "QA135_HISTORY" },
        { id: obsoleteSketchEventId(mutationId), type: OBSOLETE_SKETCH_EVENT, payload: { projectId: `qa135-${runId}`, productId: `qa135-product-${runId}`,
          fileId: `qa135-old-${runId}`, storedName: "obsolete.png", newFileId: `qa135-new-${runId}`, clientMutationId: mutationId }, actor, createdAt: stamp, processedAt: null, attempts: 5, lastError: "QA135_HISTORY" },
      ];
      const ids = [...fixtures.map(row => row.id), ...orderIds(runId)], protectedRows = await legacyRows(db, []);
      const collision = await db.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "DomainEvent" WHERE "id" IN (${Prisma.join(ids)})`); check(collision.length === 0, "FIXTURE_COLLISION");
      const pre: Pre = { namespace: "qa135-native-v2", kind: "pre", runId, actor, containerId, sourceHash, pins, fixtures, orderIds: orderIds(runId),
        protectedHash: digest(protectedRows), protectedCount: protectedRows.length, mutationId };
      const durablePre = await publish(`${runId}.pre.json`, pre);
      // PRE уже fsync/readback до первого INSERT и содержит все3+51 exact IDs и before hashes.
      phase = "prepare-insert";
      await db.$transaction(async tx => {
        for (const row of fixtures) await tx.$executeRaw(Prisma.sql`INSERT INTO "DomainEvent" ("id","type","payload","actor","createdAt","processedAt","attempts","lastError")
          VALUES (${row.id},${row.type},${JSON.stringify(row.payload)}::jsonb,${row.actor},${new Date(row.createdAt)},${row.processedAt ? new Date(row.processedAt) : null},${row.attempts},${row.lastError})`);
      });
      const observation = await observe(db, pre, sourceHash); check(observation.ids.length === 3, "PREPARED_FIXTURE_COUNT");
      const part = await publish(`${runId}.prepared.json`, observation);
      console.log(JSON.stringify({ ok: true, phase: "prepared", runId, pre: durablePre, observation: part, protectedCount: pre.protectedCount })); return;
    }
    const pre = JSON.parse(await readFile(await privatePath(`${runId}.pre.json`), "utf8")) as Pre;
    check(pre.namespace === "qa135-native-v2" && pre.kind === "pre" && pre.runId === runId && pre.actor === `qa135:${runId}` && pre.containerId === containerId &&
      pre.orderIds.join("|") === orderIds(runId).join("|") && pre.fixtures.length === 3 && pre.fixtures[0].id === `qa135:${runId}:completed` && pre.fixtures[1].id === `qa135:${runId}:pending` &&
      pre.fixtures[2].id === obsoleteSketchEventId(pre.mutationId) && pre.pins[sourcePaths[0]] === pins[sourcePaths[0]] && pre.pins[sourcePaths[1]] === pins[sourcePaths[1]], "PRE_MANIFEST_GUARD");
    const ids = allIds(pre), seededIds = pre.fixtures.map(row => row.id);
    if (mode === "inspect") {
      const observation = await observe(db, pre, sourceHash), receipt = await publish(`${runId}.observe-${randomUUID()}.json`, observation);
      console.log(JSON.stringify({ ok: true, phase: "observed", runId, receipt, ownedCount: observation.ids.length, activeClaims: observation.activeClaims, reconciliationRequired: true })); return;
    }
    if (mode === "cleanup") {
      phase = "cleanup-intent";
      const observationName = path.basename(argument("--observation-file"));
      const observation = JSON.parse(await readFile(await privatePath(observationName), "utf8")) as Observation;
      check(observation.namespace === "qa135-native-v2" && observation.kind === "observation" && observation.runId === runId && observation.preHash === digest(pre) &&
        observation.sourceHash === sourceHash && observation.activeClaims === 0 && observation.ids.every(id => ids.includes(id)), "CURRENT_OBSERVATION_REQUIRED");
      const intent = { namespace: "qa135-native-v2", kind: "cleanup-intent", runId, preHash: digest(pre), observationHash: digest(observation), sourceHash,
        ids: observation.ids, expectedOwnedHash: observation.ownedHash, expectedProtectedHash: observation.protectedHash };
      const durableIntent = await publish(`${runId}.cleanup-intent-${randomUUID()}.json`, intent);
      phase = "cleanup-transaction";
      const deleted = await db.$transaction(async tx => {
        const rows = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT * FROM "DomainEvent" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
        validateOwned(pre, rows);
        const [{ observed }] = await tx.$queryRaw<{ observed: Date }[]>(Prisma.sql`SELECT clock_timestamp() AS observed`);
        check(rows.every(row => !(row.leaseUntil instanceof Date) || row.leaseUntil.getTime() <= observed.getTime()), "CLEANUP_ACTIVE_LEASE_GUARD");
        check(digest(rows) === observation.ownedHash && rows.map(row => String(row.id)).join("|") === observation.ids.join("|"), "CLEANUP_MUTABLE_STATE_GUARD");
        const foreign = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "DomainEvent" WHERE "actor"=${pre.actor} AND "id" NOT IN (${Prisma.join(ids)})`);
        check(foreign.length === 0, "UNDECLARED_OWN_ROWS");
        const protectedRows = await legacyRows(tx, ids); check(digest(protectedRows) === pre.protectedHash && protectedRows.length === pre.protectedCount, "CLEANUP_PROTECTED_GUARD");
        const count = rows.length ? await tx.$executeRaw(Prisma.sql`DELETE FROM "DomainEvent" WHERE "id" IN (${Prisma.join(observation.ids)}) AND "actor"=${pre.actor}`) : 0;
        check(count === rows.length, "EXACT_DELETE_COUNT"); check(digest(await legacyRows(tx, [])) === pre.protectedHash, "CLEANUP_TRANSACTION_PRESERVATION"); return count;
      }, { isolationLevel: "RepeatableRead", timeout: 15_000 });
      const terminal = await observe(db, pre, sourceHash); check(terminal.ids.length === 0 && terminal.protectedHash === pre.protectedHash, "CLEANUP_POST_COMMIT_GUARD");
      const ack = await publish(`${runId}.cleanup-ack.json`, { namespace: "qa135-native-v2", kind: "cleanup-ack", runId, intentHash: durableIntent.semanticHash, sourceHash, deleted, terminal });
      console.log(JSON.stringify({ ok: true, phase: "cleanup", runId, deleted, ack })); return;
    }
    phase = "verify-migration";
    check(pre.sourceHash === sourceHash, "VERIFY_SOURCE_CHANGED");
    const prepared = JSON.parse(await readFile(await privatePath(`${runId}.prepared.json`), "utf8")) as Observation;
    check(prepared.preHash === digest(pre) && prepared.ids.length === 3 && prepared.sourceHash === sourceHash, "PREPARED_OBSERVATION_REQUIRED");
    const columns = await columnNames(db); check(addedColumns.every(name => columns.includes(name)), "EXPECTED_MIGRATED_SCHEMA");
    const legacy = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT ${legacyColumns} FROM "DomainEvent" WHERE "id" IN (${Prisma.join(seededIds)}) ORDER BY "id"`);
    check(legacy.length === 3 && legacy.every(row => digest(row) === digest(pre.fixtures.find(item => item.id === row.id))), "MIGRATION_LEGACY_PRESERVATION");
    check(digest(await legacyRows(db, ids)) === pre.protectedHash, "MIGRATION_PROTECTED_DATA");
    const own = createPostgresEventQueueStore(db, settings, seededIds), peerStore = createPostgresEventQueueStore(peer, settings, seededIds);
    const completed = await own.read(seededIds[0]), pending = await own.read(seededIds[1]);
    check(completed?.processedAt && completed.queueAttempts === 0 && pending?.attempts === 999 && pending.queueAttempts === 0, "MIGRATION_BUDGET_DEFAULTS");
    const cases: string[] = [];
    phase = "two-backend-overlap";
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
    phase = "expiry-during-row-wait";
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
    phase = "ordering-51";
    const collision = await db.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "DomainEvent" WHERE "id" IN (${Prisma.join(pre.orderIds)})`); check(collision.length === 0, "ORDERING_COLLISION");
    await db.domainEvent.createMany({ data: pre.orderIds.map((id, index) => ({ id, actor: pre.actor, type: "qa135.fixture", payload: { qa135Run: runId, index }, createdAt: new Date(index), nextAttemptAt: new Date(0) })) });
    let healthy = 0;
    const benchmarkStore = createPostgresEventQueueStore(db, settings, pre.orderIds), benchmark = createEventQueueProcessor({ store: benchmarkStore, settings, deliver: async event => {
      if ((event.payload as { index: number }).index < 50) throw new EventDeliveryError("EVENT_DELIVERY_FAILED"); healthy++;
    } });
    check(await benchmark.dispatchPending(50) === 50 && await benchmark.dispatchPending(50) === 1 && healthy === 1, "NATIVE_ORDERING_SECOND_CYCLE");
    check((await benchmarkStore.read(pre.orderIds[50]))?.processedAt, "HEALTHY_PROCESSED"); cases.push("real SQL 50failures+1healthy delivered in second cycle");
    const terminal = await observe(db, pre, sourceHash); check(terminal.ids.length === 54 && terminal.activeClaims === 0, "VERIFY_TERMINAL_STATE");
    const receipt = await publish(`${runId}.verify.json`, { namespace: "qa135-native-v2", kind: "verify", runId, preHash: digest(pre), sourceHash,
      backendPids: [pid1, pid2], heldOverlapWitness: true, waitWitness, cases, terminal, physicalStorage: "NOT_RUN; no plugin/executor calls" });
    console.log(JSON.stringify({ ok: true, phase: "verify", runId, backendPids: [pid1, pid2], cases, receipt }));
  } catch (error) {
    const diagnostic = nativeFailureDiagnostic(error, phase, frozenHash);
    console.error(JSON.stringify(diagnostic)); throw Error(diagnostic.code);
  } finally { await Promise.allSettled(clients.map(client => client.$disconnect())); }
}

const directlyInvoked = path.resolve(process.argv[1] ?? "").toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (directlyInvoked) void runEventQueueNative(process.argv.slice(2)).catch(() => { process.exitCode = 1; });