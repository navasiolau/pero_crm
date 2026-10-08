import { execFileSync } from "node:child_process";
import { PrismaClient, type Prisma } from "@prisma/client";
import { createProductCore } from "../src/server/products/core";
import { patchProjectStageTransaction } from "../src/server/projects/stage-core";
import type { DomainActor } from "../src/server/projects/core";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";
import {
  NATIVE_CONTAINER, OwnedNativeRun, need, equal, failure,
  type Phase,
} from "./helpers/product-draft-owned-native-lifecycle";
import { randomUUID } from "node:crypto";

/**
 * Run с durable PRE до setup и receipt до каждого COMMIT.
 * При любой ошибке сохраняются PRE/intent/proof: rerun запрещён до root cleanup-only.
 * Успешный recovery старого run без baseline не являлся functional PASS.
 * Root normal entry: product-draft-local.ts concurrency-native.
 * Recovery: inspect --manifest <pre.json> --manifest-sha256 <SHA>
 * cleanup-only: те же flags + --parts-sha256 <inspect SHA>
 *   --root-ack task111-reviewed-native-cleanup
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function modeArguments() {
  const argument = process.argv[2];
  const mode = argument === "inspect" || argument === "cleanup-only" ? argument : "run";
  need(mode !== "run" || argument === undefined || argument === "run" || argument === "concurrency-native", "native_mode");
  const args = new Map<string, string>();
  for (let index = 3; index < process.argv.length; index += 2) {
    const key = process.argv[index], value = process.argv[index + 1];
    need(["--manifest", "--manifest-sha256", "--parts-sha256", "--root-ack"].includes(key) && !args.has(key) && typeof value === "string", "native_arguments");
    args.set(key, value);
  }
  if (mode === "run") need(args.size === 0, "run_no_recovery_args");
  else {
    need(typeof args.get("--manifest") === "string" && /^[a-f0-9]{64}$/.test(args.get("--manifest-sha256") ?? ""), "exact_manifest_digest_required");
    if (mode === "inspect") need(args.size === 2, "inspect_arguments");
    else need(args.size === 4 && /^[a-f0-9]{64}$/.test(args.get("--parts-sha256") ?? "") && args.get("--root-ack") === "task111-reviewed-native-cleanup", "cleanup_review_arguments");
  }
  return { mode, args };
}
function guardedUrl() {
  need(process.platform === "win32" && process.env.CRM_MODERNIZATION_TARGET === "local" && process.env.CRM_LOCAL_CONTAINER_ID === NATIVE_CONTAINER, "explicit_existing_local");
  need(!process.env.DOCKER_CONTEXT || process.env.DOCKER_CONTEXT === "desktop-linux", "docker_context_override");
  need(!process.env.DOCKER_HOST || process.env.DOCKER_HOST === "npipe:////./pipe/dockerDesktopLinuxEngine", "docker_host_override");
  const context = execFileSync("docker", ["context", "show"], { encoding: "utf8", windowsHide: true }).trim();
  need(context === "desktop-linux", "docker_context");
  const [configuration] = JSON.parse(execFileSync("docker", ["context", "inspect", "desktop-linux"], { encoding: "utf8", windowsHide: true }));
  need(configuration.Endpoints.docker.Host === "npipe:////./pipe/dockerDesktopLinuxEngine", "docker_local_pipe_endpoint");
  const url = existingLocalCrmDatabaseUrl();
  const parsed = new URL(url);
  need(parsed.protocol === "postgresql:" && parsed.hostname === "127.0.0.1" && parsed.port === "5433" && parsed.pathname === "/pero_crm" && parsed.username === "pero" && parsed.search === "", "existing_loopback5433_url");
  if (process.env.DATABASE_URL) {
    const inherited = new URL(process.env.DATABASE_URL);
    need(["localhost", "127.0.0.1"].includes(inherited.hostname) && inherited.port === "5433" && inherited.pathname === "/pero_crm" && inherited.username === "pero", "inherited_url_target");
  }
  const [container] = JSON.parse(execFileSync("docker", ["--context", "desktop-linux", "inspect", "pero_crm_pg"], { encoding: "utf8", windowsHide: true })) as {
    Id: string; Name: string; State: { Running: boolean; Health?: { Status: string } };
    Mounts: { Type: string; Name?: string; Destination: string }[];
  }[];
  need(container.Id === NATIVE_CONTAINER && container.Name === "/pero_crm_pg" && container.State.Running
    && (!container.State.Health || container.State.Health.Status === "healthy")
    && container.Mounts.some(mount => mount.Type === "volume" && mount.Name === "pero_crm_v2_pgdata" && mount.Destination === "/var/lib/postgresql/data"), "exact_running_local_container");
  // URL/пароль остаются только в памяти; inherited env-файлы не меняются.
  process.env.DATABASE_URL = url;
  return url;
}
export async function runProductDraftConcurrencyNative() {
  const { mode, args } = modeArguments();
  if (mode === "inspect") {
    const { run, journal } = OwnedNativeRun.inspect(args.get("--manifest")!, args.get("--manifest-sha256")!);
    console.log(JSON.stringify({
      kind: "product-draft-concurrency-native-journal", status: "READ_ONLY_JOURNAL",
      privateManifest: run.preFile, manifestSha256: run.preSha256, partsSha256: journal.partsSha256,
      receipts: journal.parts.length, unpublishedTemps: journal.unpublishedTemps,
      originalBaselineAvailable: true, functionalAcceptance: false,
    }));
    return;
  }
  const url = guardedUrl();
  const db = new PrismaClient({ datasources: { db: { url } } });
  let disconnected = false;
  async function disconnect() { if (!disconnected) { await db.$disconnect(); disconnected = true; } }
  let phase = "durable_pre_baseline";
  let run: OwnedNativeRun | undefined;
  const checks: string[] = [];
  const lockChecks: { firstPid: number; secondPid: number; phase: string; exactBlockerObserved: true }[] = [];
  try {
    if (mode === "cleanup-only") {
      phase = "reviewed_cleanup_only";
      run = OwnedNativeRun.resume(args.get("--manifest")!, args.get("--manifest-sha256")!, args.get("--parts-sha256")!, args.get("--root-ack")!);
      const restored = await run.cleanup(db);
      await disconnect();
      console.log(JSON.stringify({
        kind: "product-draft-concurrency-native-cleanup", target: "local", status: "CLEANUP_VERIFIED",
        ...restored, privateManifest: run.preFile, manifestSha256: run.preSha256,
        originalBaselineAvailable: true, functionalAcceptance: false,
      }));
      return;
    }
    run = await OwnedNativeRun.begin(db);
    const owned = run;
    const actor: DomainActor = { id: owned.keys.actorId, name: owned.name, roles: ["MANAGER"], source: "web" };
    phase = "setup_owned_QA";
    await owned.transaction(db, "setup", null, async tx => {
      await tx.$queryRawUnsafe("SELECT 1 FROM pg_advisory_xact_lock(18435,55001)");
      await tx.user.create({ data: {
        id: owned.keys.actorId, email: "qa111-concurrency-" + owned.keys.runId + "@invalid.test",
        name: owned.name, passwordHash: "QA_DISABLED_NOT_A_PASSWORD", roles: ["MANAGER"],
      } });
      await tx.client.create({ data: { id: owned.keys.clientId, name: owned.clientName, phone: "111" } });
      const max = (await tx.project.aggregate({ _max: { numberInt: true } }))._max.numberInt ?? 0;
      for (let index = 0; index < 3; index++) {
        await tx.project.create({ data: {
          id: owned.keys.projectIds[index], number: String(max + index + 1), numberInt: max + index + 1,
          title: owned.name, stage: index === 2 ? "CONTRACT" : "LEAD", currency: "BYN",
          clientId: owned.keys.clientId, managerId: owned.keys.actorId,
        } });
      }
    });
    async function create(tx: Prisma.TransactionClient, projectId: string, title: string) {
      const result = await createProductCore(actor, { projectId, title }, f => f(tx));
      need(result.ok && result.product, "product_create_result");
      return result.product;
    }
    async function contract(tx: Prisma.TransactionClient, projectId: string) {
      const result = await patchProjectStageTransaction(actor, {
        projectId, expectedStage: "LEAD", toStage: "CONTRACT", clientMutationId: randomUUID(),
      }, tx);
      need(result.result.ok, "project_contract_result");
      const processed = await tx.domainEvent.updateMany({
        where: { id: { in: result.eventIds }, actor: actor.id }, data: { processedAt: new Date() },
      });
      need(processed.count === result.eventIds.length, "owned_outbox_processed_before_commit");
      return result;
    }
    async function waitForExactBlocker(firstPid: number, secondPid: number, isCancelled: () => boolean) {
      need(firstPid !== secondPid && Number.isInteger(firstPid) && Number.isInteger(secondPid), "two_distinct_backend_sessions");
      const limit = Date.now() + 8_000;
      while (Date.now() < limit) {
        if (isCancelled()) return;
        const rows = await db.$queryRawUnsafe<{ blockers: number[] }[]>("SELECT pg_blocking_pids($1::integer) blockers", secondPid);
        if (isCancelled()) return;
        need(rows.length === 1 && Array.isArray(rows[0].blockers), "blocking_pid_array");
        if (rows[0].blockers.includes(firstPid)) return;
        if (isCancelled()) return;
        await new Promise(done => setTimeout(done, 50));
        if (isCancelled()) return;
      }
      if (isCancelled()) return;
      need(false, "exact_first_project_blocker_not_observed");
    }
    async function paired(
      projectId: string, firstPhase: Phase, secondPhase: Phase,
      firstWork: (tx: Prisma.TransactionClient) => Promise<unknown>,
      secondWork: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) {
      const firstReady = deferred<number>(), release = deferred<void>(), secondPid = deferred<number>();
      const runs: Promise<unknown>[] = [];
      let cancelled = false;
      let observerPromise: Promise<void> | undefined;
      const first = owned.transaction(db, firstPhase, projectId, async tx => {
        const [{ pid }] = await tx.$queryRawUnsafe<{ pid: number }[]>("SELECT pg_backend_pid() pid");
        await firstWork(tx);
        firstReady.resolve(pid);
        await release.promise;
        need(!cancelled, "paired_cancel_before_commit");
      });
      runs.push(first); void first.catch(() => {});
      try {
        const firstPid = await Promise.race([firstReady.promise, first.then(() => { throw Error("EARLY_FIRST"); })]);
        const second = owned.transaction(db, secondPhase, projectId, async tx => {
          const [{ pid }] = await tx.$queryRawUnsafe<{ pid: number }[]>("SELECT pg_backend_pid() pid");
          secondPid.resolve(pid);
          await secondWork(tx);
          need(!cancelled, "paired_cancel_before_commit");
        });
        runs.push(second); void second.catch(() => {});
        const otherPid = await Promise.race([secondPid.promise, second.then(() => { throw Error("EARLY_SECOND"); })]);
        observerPromise = waitForExactBlocker(firstPid, otherPid, () => cancelled);
        await Promise.race([observerPromise, second.then(() => { throw Error("BYPASSED_LOCK"); })]);
        lockChecks.push({ firstPid, secondPid: otherPid, phase: firstPhase, exactBlockerObserved: true });
        release.resolve();
        await Promise.all(runs);
      } catch (error) {
        cancelled = true; // release обязан откатить ещё открытые tx при отказе proof.
        throw error;
      } finally {
        cancelled = true;
        release.resolve();
        // Наблюдатель не должен пережить pair и открыть запрос после disconnect.
        await Promise.allSettled([...runs, ...(observerPromise ? [observerPromise] : [])]);
      }
    }
    const [createFirstProject, contractFirstProject, numberingProject] = owned.keys.projectIds;
    phase = "create_first";
    await paired(createFirstProject, "create-first", "contract-after-create",
      async tx => { need((await create(tx, createFirstProject, "QA create-first " + owned.keys.runId)).status === "DRAFT", "create_first_draft"); },
      tx => contract(tx, createFirstProject));
    need((await db.project.findUniqueOrThrow({ where: { id: createFirstProject } })).stage === "CONTRACT", "create_first_project_contract");
    const firstProducts = await db.product.findMany({ where: { projectId: createFirstProject } });
    need(firstProducts.length === 1 && firstProducts[0].status === "PREPARATION", "create_first_promoted");
    const firstHistory = await db.productStatusHistory.findMany({ where: { productId: firstProducts[0].id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    equal(firstHistory.map(row => row.toStatus), ["DRAFT", "PREPARATION"], "create_first_exact_history");
    checks.push("create_first_real_project_lock_wait_then_promote");

    phase = "contract_first";
    await paired(contractFirstProject, "contract-first", "create-after-contract",
      tx => contract(tx, contractFirstProject),
      async tx => { need((await create(tx, contractFirstProject, "QA contract-first " + owned.keys.runId)).status === "PREPARATION", "contract_first_preparation"); });
    need((await db.project.findUniqueOrThrow({ where: { id: contractFirstProject } })).stage === "CONTRACT", "contract_first_project_contract");
    const secondProducts = await db.product.findMany({ where: { projectId: contractFirstProject } });
    need(secondProducts.length === 1 && secondProducts[0].status === "PREPARATION", "contract_first_exact_product");
    const secondHistory = await db.productStatusHistory.findMany({ where: { productId: secondProducts[0].id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    equal(secondHistory.map(row => row.toStatus), ["PREPARATION"], "contract_first_exact_history");
    checks.push("contract_first_real_project_lock_wait_then_preparation");

    phase = "concurrent_numbering";
    await paired(numberingProject, "number-first", "number-second",
      async tx => { need((await create(tx, numberingProject, "QA numbering-first " + owned.keys.runId)).suffixInt === 1, "number_first_suffix"); },
      async tx => { need((await create(tx, numberingProject, "QA numbering-second " + owned.keys.runId)).suffixInt === 2, "number_second_suffix"); });
    const siblings = await db.product.findMany({ where: { projectId: numberingProject }, orderBy: { suffixInt: "asc" } });
    equal(siblings.map(row => row.suffixInt), [1, 2], "two_concurrent_distinct_suffixes");
    need(siblings.every(row => row.status === "PREPARATION") && lockChecks.length === 3, "numbering_and_three_real_block_proofs");
    checks.push("two_real_creates_allocate_distinct_suffixes");

    phase = "cleanup";
    const restored = await owned.cleanup(db);
    await disconnect();
    console.log(JSON.stringify({
      kind: "product-draft-concurrency-native", target: "local", status: "PASS", checks, lockChecks,
      ...restored, cleanupVerified: true, originalBaselineAvailable: true, functionalAcceptance: true,
      privateManifest: owned.preFile, manifestSha256: owned.preSha256,
      previousLostBaselineRunFunctionalAcceptance: false,
    }));
  } catch (error) {
    console.log(JSON.stringify({
      kind: "product-draft-concurrency-native", target: "local", status: "STOP_PENDING_ROOT_REVIEW",
      ...failure(error, phase), privateManifest: run?.preFile, manifestSha256: run?.preSha256,
      originalBaselineAvailable: Boolean(run), cleanupVerified: false, functionalAcceptance: false,
    }));
    // Не запускать новый fixture/run и не удалять непроверенную uncertain scope.
    process.exitCode = 1;
  } finally { await disconnect(); }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/product-draft-concurrency-native.ts")) {
  void runProductDraftConcurrencyNative().catch(error => {
    console.log(JSON.stringify({ kind: "product-draft-concurrency-native", status: "STOP", ...failure(error, "entry"), functionalAcceptance: false }));
    process.exitCode = 1;
  });
}
