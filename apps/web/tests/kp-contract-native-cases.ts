import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { createContractWorkflow } from "../src/server/kp/contract-workflow";
import { createPostgresContractTransaction } from "../src/server/kp/contract-store";
import type { ContractPreparedOutput } from "../src/server/kp/contract-workflow";
import type { ContractClaim, ContractArtifact, ContractStore, ContractWorkflowPorts } from "../src/server/kp/contract-ports";
import type { ContractActor, ContractObject } from "../src/server/kp/contract-types";
import { nativeAcceptanceBinding, type NativeDeclaration } from "./helpers/native-acceptance-target";

export type NativeProof = { databaseUrl: string; expectedDatabase: string; rollbackOnly: true; declaration: NativeDeclaration };
type NativeDatabaseIdentity = { database: string; schema: string; user: string; tableReady: boolean; serverPort: number | null };

/** Чистая проверка: контейнер/БД не читает; actual runner всегда добавляет nativeAcceptanceBinding. */
export function assertContractNativeTarget(proof: NativeProof, guardedDatabaseUrl?: string): void {
  const declaration = proof?.declaration;
  let url: URL;
  try { url = new URL(proof?.databaseUrl); } catch { throw Error("Нативная приёмка требует явную local5433, declaration и rollback"); }
  const allowedOptions = new Set(["schema", "connection_limit", "pool_timeout", "connect_timeout", "socket_timeout", "sslmode"]);
  if (proof.rollbackOnly !== true || !["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.port !== "5433" || url.username !== "pero" || proof.expectedDatabase !== "pero_crm" || url.pathname !== "/pero_crm" || url.hash ||
    [...url.searchParams.keys()].some(key => !allowedOptions.has(key) || url.searchParams.getAll(key).length !== 1) ||
    url.searchParams.has("schema") && url.searchParams.get("schema") !== "public" ||
    declaration?.target !== "local" || !/^[a-f0-9]{40}$/.test(declaration.revision ?? "") ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(declaration.runId ?? "") ||
    !/^[a-z0-9][a-z0-9.-]{0,100}$/.test(declaration.scenarioId ?? "")) throw Error("Нативная приёмка требует явную local5433, declaration и rollback");
  if (guardedDatabaseUrl !== undefined) {
    let guarded: URL;
    try { guarded = new URL(guardedDatabaseUrl); } catch { throw Error("Нативная local5433 не совпала с проверенной привязкой контейнера"); }
    // Не использовать assert.equal: его diagnostic раскроет пароль из обоих URL.
    if (url.toString() !== guarded.toString()) throw Error("Нативная local5433 не совпала с проверенной привязкой контейнера");
  }
}

/** SQL listener внутри Docker не является host URL: порт контейнера остаётся 5432. */
export function assertContractNativeDatabaseIdentity(proof: NativeProof, rows: readonly NativeDatabaseIdentity[]): void {
  assertContractNativeTarget(proof);
  const identity = rows[0];
  if (rows.length !== 1 || identity?.database !== "pero_crm" || identity.schema !== "public" || identity.user !== "pero" || identity.tableReady !== true || identity.serverPort !== 5432) throw Error("Нативная цель или зависимости договора не совпали");
}

/** Только оркестратор внутри уже guarded local-транзакции; импорт модуля ничего не запускает.
 * Проверяет настоящую БД. PDF/DOCX представлены метаданными фикстур: это НЕ доказательство S3/рендера.
 * Все собственные изменения дополнительно откатываются к savepoint, даже если внешний caller делает commit.
 */
export async function runContractDatabaseNativeCases(tx: Prisma.TransactionClient, proof: NativeProof,
  configuration: Omit<ContractWorkflowPorts, "store">): Promise<{ databaseCases: number; physicalDocumentAcceptance: false }> {
  assertContractNativeTarget(proof);
  const binding = nativeAcceptanceBinding(proof.declaration);
  assertContractNativeTarget(proof, binding.url);
  const identity = await tx.$queryRaw<NativeDatabaseIdentity[]>`SELECT current_database() AS database,current_schema() AS schema,current_user AS "user",to_regclass('public."ProposalContractVersion"') IS NOT NULL AS "tableReady",inet_server_port() AS "serverPort"`;
  assertContractNativeDatabaseIdentity(proof, identity);
  await tx.$executeRawUnsafe("SAVEPOINT qa186_contract_workflow");
  try {
    const token = randomUUID().replace(/-/g, ""), userId = "qa186_user_" + token, clientId = "qa186_client_" + token;
    const actor: ContractActor = { id: userId, source: "web", sessionVersion: 0 };
    await tx.$queryRaw<{ locked: number }[]>`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
    await tx.$executeRaw`INSERT INTO "User" (id,email,name,"passwordHash",roles,"updatedAt") VALUES (${userId},${token + "@example.invalid"},'Тестовый менеджер 186','INVALID-QA-LOGIN',ARRAY['MANAGER']::"Role"[],NOW())`;
    await tx.$executeRaw`INSERT INTO "Client" (id,name,"lastName",phone,address,"updatedAt") VALUES (${clientId},'Тестовый','Клиент','+70000000000','Тестовый адрес',NOW())`;
    const maximum = await tx.project.aggregate({ _max: { numberInt: true } });
    const ids: string[] = [], projects: string[] = [], products: string[] = [];
    for (let index = 0; index < 2; index++) {
      const number = (maximum._max.numberInt ?? 0) + index + 1, projectId = `qa186_project_${token}_${index}`, proposalId = `qa186_cp_${token}_${index}`, productId = `qa186_product_${token}_${index}`;
      ids.push(proposalId); projects.push(projectId); products.push(productId);
      const state = { currency: "BYN", items: [{ id: "item_" + index, price: 100.75, qty: 1 }], discount: 10, delivery: { visible: false },
        client: { name: "Тестовый клиент 186" }, order: { number: String(number), date: "18.10.2026", project: "Нативная приёмка" } };
      await tx.$executeRaw`INSERT INTO "Project" (id,number,"numberInt",title,"clientId",address,"initialPrice","updatedAt") VALUES (${projectId},${String(number)},${number},'QA 186',${clientId},'Объект 186',100.75,NOW())`;
      await tx.$executeRaw`INSERT INTO "Product" (id,"projectId",number,title,"expectedPrice","initialPrice","updatedAt") VALUES (${productId},${projectId},${number + ".1"},'QA изделие 186',90.68,100.75,NOW())`;
      await tx.$executeRaw`INSERT INTO "CommercialProposal" (id,"projectId","clientId","sourceId",state,revision,currency,rate,"rateDate","rateSource","updatedAt")
        VALUES (${proposalId},${projectId},${clientId},${"qa186:" + token + ":" + index},${JSON.stringify(state)}::jsonb,1,'BYN',1,'2026-10-18','NBRB',NOW())`;
    }
    const store: ContractStore = { transaction: async run => {
      await tx.$executeRawUnsafe("SAVEPOINT qa186_contract_command");
      try { const result = await run(createPostgresContractTransaction(tx)); await tx.$executeRawUnsafe("RELEASE SAVEPOINT qa186_contract_command"); return result; }
      catch (error) { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT qa186_contract_command"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT qa186_contract_command"); throw error; }
    } };
    // Внешняя транзакция ещё не завершена; тестовые outbox-события никуда не отправляются.
    const ports: ContractWorkflowPorts = { ...configuration, store, dispatchAfterCommit: async () => undefined }, workflow = createContractWorkflow(ports);
    const form = await workflow.form(actor, ids[0]); form.settings.proposalIds = ids;
    const refs = ids.map(proposalId => ({ proposalId, expectedRevision: 1 }));
    const request = { documentId: ids[0], expectedRevision: 0, operationId: randomUUID(), clientBaseline: form.clientBaseline, sourceRefs: refs, settings: form.settings };
    let saved = await workflow.saveDraft(actor, request);
    assert.deepEqual(await workflow.saveDraft(actor, request), saved);
    const positions = () => tx.$queryRaw<{ proposalId: string; position: number }[]>`SELECT "proposalId",position FROM "ProposalContractSource" WHERE "contractId"=${String(saved.contractId)} ORDER BY position`;
    assert.deepEqual(await positions(), ids.map((proposalId, index) => ({ proposalId, position: index + 1 })));
    const singleSettings = structuredClone(form.settings); singleSettings.proposalIds = [ids[0]];
    saved = await workflow.saveDraft(actor, { documentId: ids[0], expectedRevision: saved.revision, operationId: randomUUID(),
      clientBaseline: saved.clientBaseline, sourceRefs: [refs[0]], settings: singleSettings });
    assert.deepEqual(await positions(), [{ proposalId: ids[0], position: 1 }]);
    saved = await workflow.saveDraft(actor, { documentId: ids[0], expectedRevision: saved.revision, operationId: randomUUID(),
      clientBaseline: saved.clientBaseline, sourceRefs: refs, settings: form.settings });
    assert.deepEqual(await positions(), ids.map((proposalId, index) => ({ proposalId, position: index + 1 })));
    assert.equal((await tx.project.findMany({ where: { id: { in: projects } } })).every(row => row.stage === "LEAD"), true);
    const queued = await workflow.requestExport(actor, { documentId: ids[0], expectedRevision: saved.revision, operationId: randomUUID(), clientBaseline: saved.clientBaseline, sourceRefs: refs });
    const jobId = String(queued.id), contractId = String(saved.contractId);
    async function prepared(attempt: number): Promise<{ claim: ContractClaim; output: ContractPreparedOutput }> {
      const claim: ContractClaim = { id: jobId, attempt, owner: "qa186_worker_" + attempt, kind: "CONTRACT" };
      await tx.$executeRaw`UPDATE "ProposalJob" SET state='PROCESSING',attempts=${attempt},"leaseOwner"=${claim.owner},"leaseUntil"=clock_timestamp()+interval '5 minutes' WHERE id=${jobId}`;
      const current = createPostgresContractTransaction(tx), job = await current.job(jobId);
      const payload = ports.lifecycle.parsePayload(job!.payload);
      const pdfs: ContractPreparedOutput["pdfs"] = [];
      for (const source of payload.frozenSources) {
        const artifact = await ports.lifecycle.registerPendingPdf(current, claim, source, { storageBinding: ports.storageBinding, sha256: "a".repeat(64), size: 1 });
        pdfs.push({ proposalId: source.proposalId, artifact });
      }
      const id = randomUUID(), artifact: ContractArtifact = { id, proposalId: null, contractId, kind: "DOCX", state: "PENDING", storageBinding: ports.storageBinding,
        key: `kp/contracts/${contractId}/exports/${jobId}-${attempt}-${id}.docx`, sha256: "b".repeat(64), size: 1, fileName: "qa186.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
      await current.createPendingArtifact(artifact);
      await ports.lifecycle.registerPendingDocxCleanup(current, claim, artifact.id, ids[0]);
      return { claim, output: { pdfs, docx: artifact, pageCounts: ids.map(proposalId => ({ proposalId, pages: 1 })) } };
    }
    const first = await prepared(1);
    let advanced = 0;
    const failing = createContractWorkflow({ ...ports, lifecycle: { ...ports.lifecycle, advanceToContract: async (...args) => {
      if (++advanced === 2) throw Error("QA186_SECOND_STAGE_FAILURE"); return ports.lifecycle.advanceToContract(...args);
    } } });
    await assert.rejects(failing.finalize(first.claim, first.output), /QA186_SECOND_STAGE_FAILURE/);
    const rolled = await tx.$queryRaw<{ versions: bigint; quoteVersions: bigint; ready: bigint }[]>`SELECT
      (SELECT count(*) FROM "ProposalContractVersion" WHERE "contractId"=${contractId}) AS versions,
      (SELECT count(*) FROM "ProposalVersion" WHERE "proposalId" IN (${ids[0]},${ids[1]})) AS "quoteVersions",
      (SELECT count(*) FROM "ProposalArtifact" WHERE ("contractId"=${contractId} OR "proposalId" IN (${ids[0]},${ids[1]})) AND state='READY') AS ready`;
    assert.equal(rolled[0].versions, BigInt(0)); assert.equal(rolled[0].quoteVersions, BigInt(0)); assert.equal(rolled[0].ready, BigInt(0));
    assert.equal((await tx.project.findMany({ where: { id: { in: projects } } })).every(row => row.stage === "LEAD"), true);
    assert.equal((await tx.product.findMany({ where: { id: { in: products } } })).every(row => row.status === "DRAFT"), true);
    const second = await prepared(2), result = await workflow.finalize(second.claim, second.output);
    assert.equal((await tx.project.findMany({ where: { id: { in: projects } } })).every(row => row.stage === "CONTRACT"), true);
    assert.equal((await tx.product.findMany({ where: { id: { in: products } } })).every(row => row.status === "PREPARATION"), true);
    const accepted = await tx.$queryRaw<{ acceptedVersionId: string | null }[]>`SELECT "acceptedVersionId" FROM "CommercialProposal" WHERE id IN (${ids[0]},${ids[1]})`;
    assert.equal(accepted.every(row => row.acceptedVersionId !== null), true);
    const versions = await tx.$queryRaw<{ clientSnapshot: ContractObject }[]>`SELECT "clientSnapshot" FROM "ProposalContractVersion" WHERE id=${String(result.versionId)}`;
    await tx.$executeRaw`UPDATE "Client" SET name='Изменение после выпуска',"updatedAt"=NOW() WHERE id=${clientId}`;
    const after = await tx.$queryRaw<{ clientSnapshot: ContractObject }[]>`SELECT "clientSnapshot" FROM "ProposalContractVersion" WHERE id=${String(result.versionId)}`;
    assert.deepEqual(after, versions);
    assert.deepEqual(await workflow.finalize(second.claim, second.output), result);
    return { databaseCases: 8, physicalDocumentAcceptance: false };
  } finally {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT qa186_contract_workflow");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT qa186_contract_workflow");
  }
}
