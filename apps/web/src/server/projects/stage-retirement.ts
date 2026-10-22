import { createHash } from "node:crypto";
import type { Prisma, ProjectStage } from "@prisma/client";
import { z } from "zod";
import { createPrismaLifecycleStore } from "../kp/lifecycle-store";

const ordinaryStages: readonly ProjectStage[] = ["LEAD", "ESTIMATE", "CONTRACT", "IN_WORK", "DONE"];
const retiredStages: readonly ProjectStage[] = ["PAUSED", "RECLAMATION"];
const canonical = (value: unknown): string => JSON.stringify(value);
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
function guard(condition: unknown, code: string): asserts condition { if (!condition) throw Error(code); }

export function retiredProjectTarget(stage: "PAUSED" | "RECLAMATION", history: readonly { fromStage: ProjectStage | null; toStage: ProjectStage }[]): ProjectStage {
  if (stage === "RECLAMATION") return "IN_WORK";
  // Вход отсортирован от самого свежего события; исходный этап перехода в PAUSED учитывается.
  for (const row of history) for (const candidate of [row.toStage, row.fromStage])
    if (candidate && ordinaryStages.includes(candidate)) return candidate;
  return "IN_WORK";
}

const databaseSchema = z.object({ name: z.string().min(1), schema: z.literal("public"), systemIdentifier: z.string().regex(/^\d+$/) }).strict();
const targetSchema = z.object({ kind: z.enum(["local5433", "staging", "production"]), revision: z.string().regex(/^[a-f0-9]{40}$/),
  imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(), database: databaseSchema }).strict()
  .refine(value => value.kind === "local5433" || value.imageDigest !== null, "Для staging и production требуется digest фактического образа");
export type StageRetirementTarget = z.infer<typeof targetSchema>;
const requestSchema = z.object({ operationId: z.uuid(), actorId: z.string().min(1), target: targetSchema }).strict();
export type StageRetirementRequest = z.infer<typeof requestSchema>;
export type StageRetirementPorts = {
  transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  /** Root проверяет ЖИВЫЕ image/SHA/DB/процессы тем же guarded transport; подтверждение-флаг не допускается. */
  verifyTargetAndNoOldWriters(expected: StageRetirementTarget): Promise<StageRetirementTarget>;
};

async function assertTarget(tx: Prisma.TransactionClient, ports: StageRetirementPorts, expected: StageRetirementTarget) {
  const actual = targetSchema.parse(await ports.verifyTargetAndNoOldWriters(expected));
  guard(canonical(actual) === canonical(expected), "STAGE_RETIREMENT_TARGET_MISMATCH");
  guard(expected.kind === "local5433" ? expected.database.name === "pero_crm" : expected.database.name === "crm", "STAGE_RETIREMENT_DATABASE_NOT_ALLOWED");
  const rows = await tx.$queryRaw<{ name: string; schema: string; systemIdentifier: string }[]>`
    SELECT current_database() AS name,current_schema() AS schema,system_identifier::text AS "systemIdentifier" FROM pg_control_system()`;
  guard(rows.length === 1 && canonical(rows[0]) === canonical(expected.database), "STAGE_RETIREMENT_DATABASE_MISMATCH");
}

async function lockRetirement(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
  await tx.$executeRaw`LOCK TABLE "Project","Product","ProjectStageHistory","ProductStatusHistory","CommercialProposal","ProposalJob","ChangeLog" IN SHARE ROW EXCLUSIVE MODE NOWAIT`;
}

async function snapshot(tx: Prisma.TransactionClient) {
  const projects = await tx.project.findMany({ where: { stage: { in: [...retiredStages] } }, orderBy: { id: "asc" },
    select: { id: true, stage: true, stageChangedAt: true, deletedAt: true,
      stageHistory: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, fromStage: true, toStage: true, createdAt: true } } } });
  const products = await tx.product.findMany({ where: { status: "RECLAMATION" }, orderBy: { id: "asc" },
    select: { id: true, projectId: true, status: true, statusChangedAt: true, deletedAt: true } });
  const rows = projects.map(project => ({ ...project, toStage: retiredProjectTarget(project.stage as "PAUSED" | "RECLAMATION", project.stageHistory) }));
  const leadIds = rows.filter(project => project.toStage === "LEAD").map(project => project.id);
  const proposals = leadIds.length ? await tx.commercialProposal.findMany({ where: { projectId: { in: leadIds }, isArchive: false }, orderBy: { id: "asc" },
    select: { id: true, projectId: true, revision: true, acceptedVersionId: true, acceptedAt: true, retentionEpoch: true, deletedAt: true } }) : [];
  const jobs = proposals.length ? await tx.proposalJob.findMany({ where: { proposalId: { in: proposals.map(row => row.id) }, kind: "PRUNE_VERSIONS", state: { in: ["PENDING", "PROCESSING", "FAILED"] } }, orderBy: { id: "asc" },
    select: { id: true, proposalId: true, state: true, attempts: true, leaseOwner: true, leaseUntil: true } }) : [];
  return { projects: rows, products, proposals, jobs };
}
type RetirementSnapshot = Awaited<ReturnType<typeof snapshot>>;
export type StageRetirementPlan = { schema: 1; request: StageRetirementRequest; snapshot: RetirementSnapshot; fingerprint: string };

async function authorize(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, name: true, active: true, roles: true } });
  guard(actor?.active && actor.roles.includes("ADMIN"), "STAGE_RETIREMENT_ADMIN_REQUIRED");
  return actor;
}
export async function planStageRetirement(ports: StageRetirementPorts, input: StageRetirementRequest): Promise<StageRetirementPlan> {
  const request = requestSchema.parse(input);
  return ports.transaction(async tx => {
    await assertTarget(tx, ports, request.target); await lockRetirement(tx); await authorize(tx, request.actorId);
    const data = await snapshot(tx);
    const plan = { schema: 1 as const, request, snapshot: data };
    await assertTarget(tx, ports, request.target);
    return { ...plan, fingerprint: digest(plan) };
  });
}

/** Не подключено к web/API/cron. Вызывается только Root через проверенный transport с exact plan hash. */
export async function applyStageRetirement(ports: StageRetirementPorts, plan: StageRetirementPlan, reviewedFingerprint: string) {
  const request = requestSchema.parse(plan.request);
  const planned = { schema: 1 as const, request, snapshot: plan.snapshot };
  guard(plan.schema === 1 && /^[a-f0-9]{64}$/.test(reviewedFingerprint) && plan.fingerprint === reviewedFingerprint && digest(planned) === reviewedFingerprint, "STAGE_RETIREMENT_PLAN_MISMATCH");
  return ports.transaction(async tx => {
    await assertTarget(tx, ports, request.target); await lockRetirement(tx);
    const actor = await authorize(tx, request.actorId);
    const receiptId = `stage-retirement:${request.operationId}`;
    const previous = await tx.changeLog.findUnique({ where: { id: receiptId } });
    if (previous) {
      const saved = previous.newValue;
      guard(previous.actorId === actor.id && previous.entity === "stageRetirement" && previous.action === "retire" && saved && typeof saved === "object" && !Array.isArray(saved) && saved.fingerprint === reviewedFingerprint, "STAGE_RETIREMENT_OPERATION_REUSED");
      return { operationId: request.operationId, replayed: true, projects: plan.snapshot.projects.length, products: plan.snapshot.products.length };
    }
    const current = await snapshot(tx);
    guard(digest(current) === digest(plan.snapshot), "STAGE_RETIREMENT_SNAPSHOT_CHANGED");
    const at = (await tx.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`)[0]?.at;
    guard(at instanceof Date, "STAGE_RETIREMENT_CLOCK_UNAVAILABLE");
    const comment = "Служебный перенос статусов №193, без начислений и выпуска документов";
    for (const project of current.projects) {
      const changed = await tx.project.updateMany({ where: { id: project.id, stage: project.stage }, data: { stage: project.toStage, stageChangedAt: at } });
      guard(changed.count === 1, "STAGE_RETIREMENT_PROJECT_CONFLICT");
      await tx.projectStageHistory.create({ data: { projectId: project.id, fromStage: project.stage, toStage: project.toStage, changedById: actor.id, comment, createdAt: at } });
      await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: "api", entity: "project", entityId: project.id, action: "stage.retire", field: "stage", oldValue: project.stage, newValue: { stage: project.toStage, operationId: request.operationId, fingerprint: reviewedFingerprint }, createdAt: at } });
    }
    const lifecycle = createPrismaLifecycleStore(tx);
    for (const proposal of current.proposals) {
      await lifecycle.accept(proposal.id, null, null, proposal.retentionEpoch + 1);
      await lifecycle.cancelPruneJobs(proposal.id);
      await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: "api", entity: "commercialProposal", entityId: proposal.id,
        action: "acceptance.retire", oldValue: { acceptedVersionId: proposal.acceptedVersionId, retentionEpoch: proposal.retentionEpoch }, newValue: { acceptedVersionId: null, retentionEpoch: proposal.retentionEpoch + 1, operationId: request.operationId }, createdAt: at } });
    }
    for (const product of current.products) {
      const changed = await tx.product.updateMany({ where: { id: product.id, status: "RECLAMATION" }, data: { status: "PRODUCTION", statusChangedAt: at } });
      guard(changed.count === 1, "STAGE_RETIREMENT_PRODUCT_CONFLICT");
      await tx.productStatusHistory.create({ data: { productId: product.id, fromStatus: "RECLAMATION", toStatus: "PRODUCTION", changedById: actor.id, comment, createdAt: at } });
      await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: "api", entity: "product", entityId: product.id, action: "status.retire", field: "status", oldValue: "RECLAMATION", newValue: { status: "PRODUCTION", operationId: request.operationId, fingerprint: reviewedFingerprint }, createdAt: at } });
    }
    await tx.changeLog.create({ data: { id: receiptId, actorType: "user", actorId: actor.id, actorName: actor.name, source: "api", entity: "stageRetirement", entityId: request.operationId, action: "retire",
      newValue: { fingerprint: reviewedFingerprint, target: request.target, projects: current.projects.length, products: current.products.length, proposals: current.proposals.length, cancelledPrunes: current.jobs.map(job => job.id) }, createdAt: at } });
    await assertTarget(tx, ports, request.target);
    return { operationId: request.operationId, replayed: false, projects: current.projects.length, products: current.products.length };
  });
}
