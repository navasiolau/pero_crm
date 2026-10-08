import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient, type ProductStatus, type ProjectStage } from "@prisma/client";
import { createProductCore } from "../src/server/products/core";
import { changeProductStatusTransaction } from "../src/server/products/status-core";
import { patchProjectStageTransaction } from "../src/server/projects/stage-core";
import { productVisibilityWhere, taskExecutionWhere, fileVisibilityWhere } from "../src/server/access/visibility";
import { assertDraftTarget, assertDraftDatabase, draftFingerprint, draftSchemaFingerprint, reportDraftNativeError, type Fingerprints, type DraftSchemaFingerprint } from "./helpers/product-draft-native";

export async function runProductDraftNative() {
const target = assertDraftTarget(), db = new PrismaClient();
let phase = "baseline", checkId = "database-identity";
const checks: string[] = [];
let beforeRows: Fingerprints | undefined, beforeSchema: DraftSchemaFingerprint | undefined;
let operationPassed = false, rowsRollbackVerified = false, schemaRollbackVerified = false;
const failures: { phase: string; checkId: string; error: unknown }[] = [];
try {
  await assertDraftDatabase(db, target);
  checkId = "baseline-rows";
  beforeRows = await draftFingerprint(db);
  checkId = "baseline-schema-default";
  beforeSchema = await draftSchemaFingerprint(db);
  const rollback = Error("EXPECTED_DRAFT_NATIVE_ROLLBACK");
  checkId = "transaction-rollback-sentinel";
  await assert.rejects(db.$transaction(async tx => {
    checkId = "transaction-setup";
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(18435,55001)`;
    checkId = "transaction-database-identity";
    await assertDraftDatabase(tx, target);
    const newActor = async (role: "MANAGER" | "ENGINEER" | "WORKER" | "MOUNTER") => ({
      ...await tx.user.create({ data: {
        id: randomUUID(), email: "qa111-" + randomUUID() + "@invalid.test", name: "QA черновики 111",
        passwordHash: "QA_DISABLED_NOT_A_PASSWORD", roles: [role],
      }, select: { id: true, name: true, roles: true } }), source: "web" as const,
    });
    const manager = await newActor("MANAGER"), engineer = await newActor("ENGINEER"), worker = await newActor("WORKER"), mounter = await newActor("MOUNTER");
    const client = await tx.client.create({ data: { name: "QA черновики 111", phone: "111" } });
    let number = (await tx.project.aggregate({ _max: { numberInt: true } }))._max.numberInt ?? 0;
    const project = async (stage: ProjectStage) => {
      const n = ++number;
      return tx.project.create({ data: { id: randomUUID(), number: String(n), numberInt: n,
        title: "QA draft111", stage, currency: "BYN", clientId: client.id, managerId: manager.id } });
    };
    phase = "creation";
    for (const stage of ["LEAD", "ESTIMATE", "CONTRACT", "IN_WORK", "DONE", "RECLAMATION", "PAUSED", "REFUSED"] as ProjectStage[]) {
      const j = await project(stage);
      const r = await createProductCore(manager, { projectId: j.id, title: "QA создание", expectedPrice: 100, engineerId: engineer.id, quantity: 3 }, f => f(tx));
      checkId = "create-result"; assert.equal(r.ok, true);
      const expected = ["LEAD", "ESTIMATE", "PAUSED", "REFUSED"].includes(stage) ? "DRAFT" : "PREPARATION";
      checkId = "create-initial-status"; assert.equal(r.product.status, expected);
      const history = await tx.productStatusHistory.findMany({ where: { productId: r.product.id } });
      checkId = "create-history-count"; assert.equal(history.length, 1); checkId = "create-history-status"; assert.equal(history[0].toStatus, expected);
    }
    const paused = await project("PAUSED");
    await tx.projectStageHistory.create({ data: { projectId: paused.id, fromStage: "LEAD", toStage: "ESTIMATE", createdAt: new Date(Date.now()-60_000) } });
    await tx.projectStageHistory.create({ data: { projectId: paused.id, fromStage: "CONTRACT", toStage: "PAUSED" } });
    const resumed = await createProductCore(manager, { projectId: paused.id, title: "QA импорт" }, f => f(tx));
    checkId = "service-latest-confirmed-history"; assert.equal(resumed.ok && resumed.product.status, "PREPARATION");
    checks.push("core_initial_status_all_stages_and_confirmed_import_history");
    const j = await project("ESTIMATE");
    const r = await createProductCore(manager, { projectId: j.id, title: "QA до договора", quantity: 3, expectedPrice: 123.45, engineerId: engineer.id }, f => f(tx));
    checkId = "create-result"; assert.equal(r.ok, true);
    const p = await tx.product.update({ where: { id: r.product.id }, data: { assemblerId: worker.id, mounterId: mounter.id } });
    const other = await tx.product.create({ data: { projectId: j.id, number: j.number + ".2", suffixInt: 2, title: "QA уже проектируется", status: "DESIGN" } });
    const deleted = await tx.product.create({ data: { projectId: j.id, number: j.number + ".3", suffixInt: 3, title: "QA softdeleted", status: "DRAFT", deletedAt: new Date() } });
    checkId = "explicit-deleted-draft-fixture"; assert.equal(deleted.status, "DRAFT");
    for (const assignee of [engineer, worker, mounter]) await tx.task.create({ data: {
      projectId: j.id, productId: p.id, title: "QA назначенная задача черновика", assigneeId: assignee.id, estimateMinutes: 10,
    } });
    await tx.file.create({ data: {
      projectId: j.id, productId: p.id, fileName: "qa111-draft.txt", storedName: "qa111-no-storage-object",
      mimeType: "text/plain", size: 1, uploadedById: manager.id,
    } });
    checkId = "manager-product-visible"; assert.equal(await tx.product.count({ where: { AND: [{ id: p.id }, productVisibilityWhere(manager)] } }), 1);
    checkId = "manager-file-visible"; assert.equal(await tx.file.count({ where: { productId: p.id, AND: [fileVisibilityWhere(manager)] } }), 1);
    phase = "permissions";
    for (const user of [engineer, worker, mounter]) {
      checkId = "assigned-role-draft-product-denied"; assert.equal(await tx.product.findFirst({ where: { AND: [{ id: p.id }, productVisibilityWhere(user)] } }), null);
      checkId = "assigned-role-draft-task-denied"; assert.equal(await tx.task.count({ where: { productId: p.id, AND: [taskExecutionWhere(user)] } }), 0);
      checkId = "assigned-role-draft-file-denied"; assert.equal(await tx.file.count({ where: { productId: p.id, AND: [fileVisibilityWhere(user)] } }), 0);
    }
    checkId = "manual-early-draft-exit-denied"; assert.equal((await changeProductStatusTransaction(tx, manager, p.id, "PREPARATION")).ok, false);
    checks.push("real_SQL_draft_access_and_manual_escape_denied");
    phase = "contract";
    const patch = { projectId: j.id, expectedStage: "ESTIMATE", toStage: "CONTRACT", clientMutationId: randomUUID() };
    const result = await patchProjectStageTransaction(manager, patch, tx);
    checkId = "contract-result"; assert.equal(result.result.ok, true); checkId = "contract-event-count"; assert.equal(result.eventIds.length, 3);
    const promoted = await tx.product.findUniqueOrThrow({ where: { id: p.id } });
    checkId = "contract-draft-promoted"; assert.equal(promoted.status, "PREPARATION"); checkId = "contract-quantity-preserved"; assert.equal(promoted.quantity, p.quantity);
    checkId = "contract-price-preserved"; assert.equal(promoted.expectedPrice?.toString(), p.expectedPrice?.toString()); checkId = "contract-engineer-preserved"; assert.equal(promoted.engineerId, p.engineerId);
    checkId = "contract-other-status-preserved"; assert.equal((await tx.product.findUniqueOrThrow({ where: { id: other.id } })).status, "DESIGN");
    checkId = "contract-deleted-draft-promoted"; assert.equal((await tx.product.findUniqueOrThrow({ where: { id: deleted.id } })).status, "PREPARATION");
    const historyCount = await tx.productStatusHistory.count({ where: { productId: p.id } });
    checkId = "contract-receipt-replayed"; assert.equal((await patchProjectStageTransaction(manager, patch, tx)).result.replayed, true);
    checkId = "contract-no-duplicate-history"; assert.equal(await tx.productStatusHistory.count({ where: { productId: p.id } }), historyCount);
    checkId = "contract-stale-stage-conflict"; assert.equal((await patchProjectStageTransaction(manager, { ...patch, clientMutationId: randomUUID() }, tx)).result.kind, "conflict");
    checkId = "contract-no-payroll"; assert.equal(await tx.payrollEntry.count({ where: { projectId: j.id } }), 0);
    checkId = "contract-no-completion"; assert.equal(await tx.productPercentageCompletion.count({ where: { productId: { in: [p.id, other.id, deleted.id] } } }), 0);
    checks.push("actual_contract_all_drafts_history_outbox_CAS_replay_no_financial_entries");
    const skipped = await project("LEAD");
    const skippedProduct = await createProductCore(manager, { projectId: skipped.id, title: "QA обход договора" }, f => f(tx));
    checkId = "skip-contract-create-result"; assert.equal(skippedProduct.ok, true);
    await patchProjectStageTransaction(manager, { projectId: skipped.id, expectedStage: "LEAD", toStage: "IN_WORK", clientMutationId: randomUUID() }, tx);
    checkId = "skip-contract-does-not-promote"; assert.equal((await tx.product.findUniqueOrThrow({ where: { id: skippedProduct.product.id } })).status, "DRAFT");
    await patchProjectStageTransaction(manager, { projectId: j.id, expectedStage: "CONTRACT", toStage: "LEAD", clientMutationId: randomUUID() }, tx);
    checkId = "return-to-lead-preserves-status"; assert.equal((await tx.product.findUniqueOrThrow({ where: { id: p.id } })).status, "PREPARATION");
    checks.push("return_and_skipping_contract_do_not_rewrite_products");
    phase = "backfill";
    const softDeletedOriginals: {id:string;status:ProductStatus}[]=[];
    const statuses: ProductStatus[] = ["PREPARATION", "DESIGN", "PRODUCTION", "STORAGE", "INSTALLATION", "DONE", "RECLAMATION"];
    for (const stage of ["LEAD", "ESTIMATE"] as ProjectStage[]) {
      const early = await project(stage);
      if (stage === "ESTIMATE") await tx.project.update({ where: { id: early.id }, data: { deletedAt: new Date() } });
      for (const [index, status] of statuses.entries()) { const created = await tx.product.create({ data: {
        projectId: early.id, number: early.number + "." + (index + 1), suffixInt: index + 1, title: "QA перенос " + status,
        status, quantity: index + 2, expectedPrice: (index + 1) * 10, engineerId: engineer.id,
        ...(index % 2 ? { deletedAt: new Date() } : {}),
      } });
        if(stage==="ESTIMATE" && (status==="PREPARATION" || status==="PRODUCTION")) {
          checkId = "backfill-meaningful-before-status"; assert.equal(created.status,status);
          softDeletedOriginals.push({id:created.id,status});
        }
      }
    }
    checkId = "backfill-meaningful-fixture-count"; assert.equal(softDeletedOriginals.length,2);
    for(const original of softDeletedOriginals) {
      const scoped = await tx.product.findUniqueOrThrow({where:{id:original.id},include:{project:{select:{deletedAt:true,stage:true}}}});
      checkId = "backfill-meaningful-before-scoped-status"; assert.equal(scoped.status,original.status); checkId = "backfill-meaningful-early-project"; assert.equal(scoped.project.stage,"ESTIMATE");
      checkId = "backfill-meaningful-project-deleted"; assert.ok(scoped.project.deletedAt, "meaningful backfill fixture requires soft-deleted early project");
    }
    const productBefore = await tx.product.findMany({ select: { id: true, status: true, project: { select: { stage: true } } } });
    const hashesBefore = await draftFingerprint(tx, true);
    const sql = readFileSync(new URL("../prisma/migrations/20261008111100_product_draft_backfill/migration.sql", import.meta.url), "utf8");
    // Комментарии удаляются ДО split: комментарий migration.sql содержит ';'.
    const statements = sql.replace(/--[^\n]*/g, "").split(";").map(part => part.trim()).filter(Boolean);
    checkId = "backfill-sql-begin";
    assert.equal(statements[0], "BEGIN");
    checkId = "backfill-sql-commit";
    assert.equal(statements.at(-1), "COMMIT");
    const body = statements.slice(1, -1), prefixes = ["ALTER TABLE", "CREATE TEMP TABLE", "INSERT INTO", "INSERT INTO", "UPDATE"];
    checkId = "backfill-sql-statement-count";
    assert.equal(body.length, prefixes.length);
    for (const [index, statement] of body.entries()) {
      checkId = "backfill-sql-prefix-" + (index + 1);
      assert.ok(statement.startsWith(prefixes[index]));
      checkId = "backfill-sql-execute-" + (index + 1);
      await tx.$executeRawUnsafe(statement);
    }
    const hashesAfter = await draftFingerprint(tx, true);
    for(const original of softDeletedOriginals) {
      const scoped = await tx.product.findUniqueOrThrow({where:{id:original.id},include:{project:{select:{deletedAt:true}}}});
      checkId = "backfill-deleted-project-promoted"; assert.equal(scoped.status,"DRAFT"); checkId = "backfill-project-deletion-preserved"; assert.ok(scoped.project.deletedAt);
    }
    for (const name of Object.keys(hashesBefore)) if (!["ProductStatusHistory", "ChangeLog"].includes(name)) {
      checkId = "backfill-business-" + name;
      assert.deepEqual(hashesAfter[name], hashesBefore[name]);
    }
    for (const original of productBefore) {
      const current = await tx.product.findUniqueOrThrow({ where: { id: original.id } });
      const early = ["LEAD", "ESTIMATE"].includes(original.project.stage);
      checkId = "backfill-all-original-statuses"; assert.equal(current.status, early ? "DRAFT" : original.status);
      if (early && original.status !== "DRAFT") {
        const h = await tx.productStatusHistory.findUniqueOrThrow({ where: { id: "migration111-history-" + original.id } });
        checkId = "backfill-history-original-status"; assert.equal(h.fromStatus, original.status); checkId = "backfill-history-draft-status"; assert.equal(h.toStatus, "DRAFT"); checkId = "backfill-history-system-actor"; assert.equal(h.changedById, null);
      }
    }
    const [defaultRow] = await tx.$queryRaw<{ value: string }[]>`SELECT column_default AS value FROM information_schema.columns WHERE table_schema='public' AND table_name='Product' AND column_name='status'`;
    checkId = "backfill-real-database-default"; assert.equal(defaultRow.value, "'DRAFT'::\"ProductStatus\"");
    checks.push("actual_migration_all_statuses_softdeleted_technical_history_business_financial_rows_preserved");
    throw rollback;
  }, { maxWait: 10_000, timeout: 120_000 }), error => {
    // Не превращаем настоящую driver/fixture ошибку в generic ERR_ASSERTION.
    if (error !== rollback) throw error;
    return true;
  });
  operationPassed = true;
} catch (error) {
  failures.push({ phase, checkId, error });
} finally {
  // Проверка выполняется и после неожиданной ошибки до sentinel, до disconnect.
  // Обе группы проверяются независимо: mismatch rows не пропускает schema/default.
  try {
    if (beforeRows) {
      try {
        checkId = "rollback-rows-equal"; assert.deepEqual(await draftFingerprint(db), beforeRows);
        rowsRollbackVerified = true;
      } catch (error) { failures.push({ phase: "rollback-rows", checkId: "rollback-rows-equal", error }); }
    }
    if (beforeSchema) {
      try {
        checkId = "rollback-schema-default-equal"; assert.deepEqual(await draftSchemaFingerprint(db), beforeSchema);
        schemaRollbackVerified = true;
      } catch (error) { failures.push({ phase: "rollback-schema-default", checkId: "rollback-schema-default-equal", error }); }
    }
  } finally {
    try { await db.$disconnect(); }
    catch (error) { failures.push({ phase: "disconnect", checkId: "disconnect", error }); }
  }
}
if (operationPassed && !failures.length && rowsRollbackVerified && schemaRollbackVerified) {
  console.log(JSON.stringify({ kind: "product-draft-native", target, status: "PASS", checks,
    rollbackVerified: true, rowsRollbackVerified, schemaRollbackVerified, tables: Object.keys(beforeRows!).length }));
} else {
  console.log(JSON.stringify({ kind: "product-draft-native", target, status: "FAIL",
    phase: failures[0]?.phase ?? phase, checkId: failures[0]?.checkId ?? checkId, rowsRollbackVerified, schemaRollbackVerified }));
  for (const failure of failures) reportDraftNativeError(failure.error);
  process.exitCode = 1;
}
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/product-draft-native.ts")) {
  void runProductDraftNative().catch(error => { reportDraftNativeError(error); process.exitCode = 1; });
}