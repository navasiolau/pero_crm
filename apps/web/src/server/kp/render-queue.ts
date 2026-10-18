import { Prisma } from "@prisma/client";
import { lifecycleFailure, type RenderJobClaim, type RenderKind } from "./lifecycle-contract";

export type LifecycleSqlTransaction = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
export interface RenderQueue {
  claim(kinds: readonly RenderKind[], owner: string, leaseMs: number, jobId?: string): Promise<RenderJobClaim | null>;
  renew(claim: RenderJobClaim, leaseMs: number): Promise<boolean>;
  fail(claim: RenderJobClaim, input: { code: string; terminal: boolean; retryMs: number }): Promise<boolean>;
  completed(jobId: string): Promise<boolean>;
}
function leaseMilliseconds(value: number) {
  if (!Number.isSafeInteger(value) || value < 1000 || value > 300_000) lifecycleFailure("KP_JOB_LEASE_INVALID", 400);
}

/** Только PDF/CONTRACT: MEDIA_UPLOAD и задания удаления этим worker никогда не захватываются. */
export function createPrismaRenderQueue(transaction: LifecycleSqlTransaction): RenderQueue {
  return {
    claim(kinds, owner, leaseMs, jobId) {
      leaseMilliseconds(leaseMs);
      if (!kinds.length || kinds.some(kind => kind !== "PDF" && kind !== "CONTRACT") || !/^[A-Za-z0-9_-]{1,180}$/.test(owner)) lifecycleFailure("KP_JOB_CLAIM_INVALID", 400);
      if (jobId !== undefined && (!jobId || jobId.length > 256)) lifecycleFailure("KP_JOB_CLAIM_INVALID", 400);
      return transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`UPDATE "ProposalJob" SET "state"='FAILED',"leaseOwner"=NULL,"leaseUntil"=NULL,"lastErrorCode"='KP_JOB_ATTEMPTS_EXHAUSTED',"updatedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE "kind"::text IN (${Prisma.join(kinds)}) ${jobId ? Prisma.sql`AND "id"=${jobId}` : Prisma.empty} AND "attempts">="maxAttempts" AND ("state"='PENDING' OR ("state"='PROCESSING' AND "leaseUntil"<=clock_timestamp() AT TIME ZONE 'UTC'))`);
        const rows = await tx.$queryRaw<{ id: string; kind: RenderKind; attempt: number }[]>(Prisma.sql`
          UPDATE "ProposalJob" j SET "state"='PROCESSING',"attempts"=j."attempts"+1,"leaseOwner"=${owner},
            "leaseUntil"=(clock_timestamp()+${leaseMs}*interval '1 millisecond') AT TIME ZONE 'UTC',"updatedAt"=clock_timestamp() AT TIME ZONE 'UTC'
          WHERE j."id"=(SELECT q."id" FROM "ProposalJob" q WHERE q."kind"::text IN (${Prisma.join(kinds)}) ${jobId ? Prisma.sql`AND q."id"=${jobId}` : Prisma.empty} AND q."attempts"<q."maxAttempts"
            AND ((q."state"='PENDING' AND q."availableAt"<=clock_timestamp() AT TIME ZONE 'UTC') OR (q."state"='PROCESSING' AND q."leaseUntil"<=clock_timestamp() AT TIME ZONE 'UTC'))
            ORDER BY q."availableAt",q."createdAt",q."id" LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING j."id",j."kind"::text AS kind,j."attempts" AS attempt`);
        return rows[0] ? { ...rows[0], owner } : null;
      });
    },
    renew(claim, leaseMs) {
      leaseMilliseconds(leaseMs);
      return transaction(async tx => await tx.$executeRaw`UPDATE "ProposalJob" SET "leaseUntil"=(clock_timestamp()+${leaseMs}*interval '1 millisecond') AT TIME ZONE 'UTC',"updatedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE "id"=${claim.id} AND "kind"::text=${claim.kind} AND "state"='PROCESSING' AND "leaseOwner"=${claim.owner} AND "attempts"=${claim.attempt} AND "leaseUntil">clock_timestamp() AT TIME ZONE 'UTC'` === 1);
    },
    fail(claim, input) {
      if (!/^[A-Z][A-Z0-9_]{1,100}$/.test(input.code) || !Number.isSafeInteger(input.retryMs) || input.retryMs < 0 || input.retryMs > 300_000) lifecycleFailure("KP_JOB_FAILURE_INVALID", 400);
      return transaction(async tx => await tx.$executeRaw`UPDATE "ProposalJob" SET "state"=CASE WHEN ${input.terminal} THEN 'CANCELLED'::"ProposalJobState" WHEN "attempts">="maxAttempts" THEN 'FAILED'::"ProposalJobState" ELSE 'PENDING'::"ProposalJobState" END,"leaseOwner"=NULL,"leaseUntil"=NULL,"lastErrorCode"=${input.code},"availableAt"=(clock_timestamp()+${input.retryMs}*interval '1 millisecond') AT TIME ZONE 'UTC',"updatedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE "id"=${claim.id} AND "kind"::text=${claim.kind} AND "state"='PROCESSING' AND "leaseOwner"=${claim.owner} AND "attempts"=${claim.attempt} AND "leaseUntil">clock_timestamp() AT TIME ZONE 'UTC'` === 1);
    },
    completed(jobId) { return transaction(async tx => (await tx.$queryRaw<{ done: boolean }[]>`SELECT "state"='SUCCEEDED' AS done FROM "ProposalJob" WHERE "id"=${jobId}`)[0]?.done === true); },
  };
}
