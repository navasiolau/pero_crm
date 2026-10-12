import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OBSOLETE_SKETCH_EVENT } from "@/server/products/sketch-cleanup-contract";
import { FILE_STORAGE_DELETE_EVENT } from "@/server/files/delete-contract";
import { eventRetryDelay, type ClaimRequest, type EventQueueSettings, type EventQueueStore,
  type OwnedDomainEvent, type QueuedDomainEvent, type QueueStats } from "./event-queue-contract";

type QueueDatabase = Pick<PrismaClient, "$queryRaw">;

/** Owned scope нужен только server-side native probes; [] всегда означает пустую область. */
export function createPostgresEventQueueStore(db: QueueDatabase, settings: Readonly<EventQueueSettings>,
  ownedScope?: readonly string[]): EventQueueStore {
  const scope = (alias: "e" | "") => {
    const identifier = alias ? Prisma.sql`e."id"` : Prisma.sql`"id"`;
    return ownedScope === undefined ? Prisma.sql`TRUE` : ownedScope.length
      ? Prisma.sql`${identifier} IN (${Prisma.join(ownedScope)})` : Prisma.sql`FALSE`;
  };
  // Срок проверяется после row lock: ожидание чужого lock не превращает старый ACK в действующий.
  const locked = (event: OwnedDomainEvent) => Prisma.sql`WITH owned AS MATERIALIZED (
    SELECT locked."id", clock_timestamp() AS observed FROM (
      SELECT "id" FROM "DomainEvent" WHERE "id" = ${event.id} AND "claimToken" = ${event.claimToken}
        AND "processedAt" IS NULL AND ${scope("")} FOR UPDATE
    ) locked
  )`;
  const fence = (event: OwnedDomainEvent) => Prisma.sql`e."id" = o."id" AND e."claimToken" = ${event.claimToken}
    AND e."processedAt" IS NULL AND e."leaseUntil" > o.observed`;
  return {
    async claim(request: ClaimRequest = {}) {
      const token = randomUUID(), retry = request.internalRetry === true && request.eventId !== undefined;
      const target = request.eventId === undefined ? Prisma.sql`TRUE` : Prisma.sql`e."id" = ${request.eventId}`;
      const retryAllowed = retry ? Prisma.sql`e."type" IN (${OBSOLETE_SKETCH_EVENT},${FILE_STORAGE_DELETE_EVENT})` : Prisma.sql`FALSE`;
      const rows = await db.$queryRaw<QueuedDomainEvent[]>(Prisma.sql`
        WITH candidate AS (
          SELECT e."id", CASE WHEN ${retryAllowed} AND e."queueAttempts" >= ${settings.maxAttempts}
            THEN 0 ELSE e."queueAttempts" END AS budget
          FROM "DomainEvent" e
          WHERE e."processedAt" IS NULL AND ${scope("e")} AND ${target}
            AND (e."leaseUntil" IS NULL OR e."leaseUntil" <= clock_timestamp())
            AND ((e."exhaustedAt" IS NULL AND e."nextAttemptAt" <= clock_timestamp()) OR ${retryAllowed})
          ORDER BY e."nextAttemptAt", e."createdAt", e."id"
          FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE "DomainEvent" e SET
          "claimToken" = CASE WHEN c.budget < ${settings.maxAttempts} THEN ${token} ELSE NULL END,
          "leaseUntil" = CASE WHEN c.budget < ${settings.maxAttempts}
            THEN clock_timestamp() + ${settings.leaseMs} * interval '1 millisecond' ELSE NULL END,
          "nextAttemptAt" = CASE WHEN ${retryAllowed} THEN clock_timestamp() ELSE e."nextAttemptAt" END,
          "attempts" = e."attempts" + CASE WHEN c.budget < ${settings.maxAttempts} THEN 1 ELSE 0 END,
          "queueAttempts" = c.budget + CASE WHEN c.budget < ${settings.maxAttempts} THEN 1 ELSE 0 END,
          "exhaustedAt" = CASE WHEN c.budget < ${settings.maxAttempts} THEN NULL ELSE clock_timestamp() END,
          "lastError" = CASE WHEN c.budget < ${settings.maxAttempts} THEN e."lastError" ELSE 'EVENT_RETRY_EXHAUSTED' END
        FROM candidate c WHERE e."id" = c."id" RETURNING e.*
      `);
      const event = rows[0];
      if (!event) return null;
      return event.claimToken && event.leaseUntil
        ? { kind: "claimed", event: event as OwnedDomainEvent }
        : { kind: "exhausted", event };
    },
    async renew(event) {
      const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`${locked(event)} UPDATE "DomainEvent" e
        SET "leaseUntil" = o.observed + ${settings.leaseMs} * interval '1 millisecond'
        FROM owned o WHERE ${fence(event)} RETURNING e."id"`);
      return rows.length === 1;
    },
    async complete(event) {
      const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`${locked(event)} UPDATE "DomainEvent" e
        SET "processedAt" = (o.observed AT TIME ZONE 'UTC'), "claimToken" = NULL,
          "leaseUntil" = NULL, "exhaustedAt" = NULL, "lastError" = NULL
        FROM owned o WHERE ${fence(event)} RETURNING e."id"`);
      return rows.length === 1;
    },
    async fail(event, code) {
      const delay = eventRetryDelay(event.queueAttempts, settings);
      const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`${locked(event)} UPDATE "DomainEvent" e
        SET "claimToken" = NULL, "leaseUntil" = NULL, "lastError" = ${code},
          "nextAttemptAt" = o.observed + ${delay} * interval '1 millisecond',
          "exhaustedAt" = CASE WHEN e."queueAttempts" >= ${settings.maxAttempts} THEN o.observed ELSE NULL END
        FROM owned o WHERE ${fence(event)} RETURNING e."id"`);
      return rows.length === 1;
    },
    async read(eventId) {
      const rows = await db.$queryRaw<QueuedDomainEvent[]>(Prisma.sql`SELECT * FROM "DomainEvent"
        WHERE "id" = ${eventId} AND ${scope("")} LIMIT 1`);
      return rows[0] ?? null;
    },
    async observe(eventId) {
      const rows = await db.$queryRaw<(QueuedDomainEvent & { leaseActive: boolean })[]>(Prisma.sql`SELECT e.*,
        COALESCE(e."processedAt" IS NULL AND e."claimToken" IS NOT NULL AND e."leaseUntil" > clock_timestamp(), FALSE) AS "leaseActive"
        FROM "DomainEvent" e WHERE e."id" = ${eventId} AND ${scope("e")} LIMIT 1`);
      const row = rows[0]; if (!row) return null;
      const { leaseActive, ...event } = row; return { event, leaseActive };
    },
    async stats() {
      const rows = await db.$queryRaw<{ ready: bigint; active: bigint; exhausted: bigint; oldestPendingAgeMs: number | null }[]>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE "exhaustedAt" IS NULL AND "queueAttempts" < ${settings.maxAttempts}
            AND "nextAttemptAt" <= clock_timestamp() AND ("leaseUntil" IS NULL OR "leaseUntil" <= clock_timestamp())) AS ready,
          COUNT(*) FILTER (WHERE "claimToken" IS NOT NULL AND "leaseUntil" > clock_timestamp()) AS active,
          COUNT(*) FILTER (WHERE "exhaustedAt" IS NOT NULL OR ("queueAttempts" >= ${settings.maxAttempts}
            AND ("leaseUntil" IS NULL OR "leaseUntil" <= clock_timestamp()))) AS exhausted,
          MAX(EXTRACT(EPOCH FROM (clock_timestamp() - ("createdAt" AT TIME ZONE 'UTC'))) * 1000)
            FILTER (WHERE "exhaustedAt" IS NULL AND ("queueAttempts" < ${settings.maxAttempts}
              OR "leaseUntil" > clock_timestamp()))::double precision AS "oldestPendingAgeMs"
        FROM "DomainEvent" WHERE "processedAt" IS NULL AND ${scope("")}
      `);
      const row = rows[0];
      return { ready: Number(row?.ready ?? 0), active: Number(row?.active ?? 0), exhausted: Number(row?.exhausted ?? 0),
        oldestPendingAgeMs: row?.oldestPendingAgeMs === null || row?.oldestPendingAgeMs === undefined ? null : Math.max(0, row.oldestPendingAgeMs) } satisfies QueueStats;
    },
  };
}
