import { Prisma } from "@prisma/client";
import { hasAnyRole, MANAGER_ROLES } from "../../lib/roles";
import { withTaskTransaction, type TaskTransaction } from "../tasks/transaction";
import { contractFailure, type ContractActor, type ContractClient, type ContractObject, type ContractRecord, type ContractSource } from "./contract-types";
import type { ContractArtifact, ContractClaim, ContractHistoryEntry, ContractJob, ContractReceipt, ContractScope, ContractStore, ContractTransaction } from "./contract-ports";

const json = (value: unknown) => JSON.stringify(value);
const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : value;
const distinct = (ids: readonly string[]) => [...new Set(ids)].sort();

export function createPostgresContractTransaction(tx: Prisma.TransactionClient): ContractTransaction {
  return {
    native: tx,
    async now() { const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`; return rows[0].now; },
    async globalLock() { await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`; },
    async authorize(binding: ContractActor, scope: ContractScope) {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${binding.id} FOR SHARE`;
      const user = await tx.user.findUnique({ where: { id: binding.id }, select: { id: true, name: true, active: true, roles: true, sessionVersion: true } });
      if (!user?.active || !hasAnyRole(user.roles, MANAGER_ROLES)) contractFailure("CONTRACT_FORBIDDEN", "Недостаточно прав для договора", 403);
      if (binding.source === "api") {
        if (!binding.tokenId) contractFailure("CONTRACT_FORBIDDEN", "Не указан ключ API договора", 403);
        await tx.$queryRaw`SELECT id FROM "ApiToken" WHERE id = ${binding.tokenId} FOR SHARE`;
        const token = await tx.apiToken.findUnique({ where: { id: binding.tokenId }, select: { createdById: true, revokedAt: true, scopes: true, pluginId: true, plugin: { select: { enabled: true } } } });
        if (!token || token.createdById !== user.id || token.revokedAt || !token.scopes.includes(scope) || token.pluginId && !token.plugin?.enabled) contractFailure("CONTRACT_FORBIDDEN", "Ключ API договора недоступен", 403);
      } else if (binding.sessionVersion === undefined || binding.sessionVersion !== user.sessionVersion) {
        contractFailure("CONTRACT_FORBIDDEN", "Сессия изменилась — войдите заново", 403);
      }
      return { id: user.id, name: user.name, roles: user.roles, source: binding.source };
    },
    async sources(ids) {
      if (!ids.length) return [];
      const rows = await tx.$queryRaw<(Omit<ContractSource, "updatedAt" | "deletedAt"> & { updatedAt: Date; deletedAt: Date | null })[]>(Prisma.sql`
        SELECT cp.id AS "proposalId", cp.revision, cp.state, cp."clientId", cp.currency::text AS currency,
          cp."deletedAt", cp."updatedAt", cp."acceptedVersionId", accepted."pdfArtifactId" AS "acceptedPdfArtifactId",
          CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'stage',p.stage::text,'clientId',p."clientId",'address',p.address,'deletedAt',p."deletedAt") END AS project
        FROM "CommercialProposal" cp LEFT JOIN "Project" p ON p.id=cp."projectId"
        LEFT JOIN "ProposalVersion" accepted ON accepted.id=cp."acceptedVersionId" AND accepted."proposalId"=cp.id
        WHERE cp.id IN (${Prisma.join(distinct(ids))}) ORDER BY cp.id`);
      return rows.map(row => ({ ...row, updatedAt: iso(row.updatedAt), deletedAt: row.deletedAt ? iso(row.deletedAt) : null }));
    },
    async lockProjects(ids) {
      if (ids.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "Project" WHERE id IN (${Prisma.join(distinct(ids))}) ORDER BY id FOR UPDATE`);
    },
    async lockContract(primaryId) { await tx.$queryRaw`SELECT id FROM "ProposalContract" WHERE "primaryProposalId"=${primaryId} FOR UPDATE`; },
    async clients(ids) {
      if (!ids.length) return [];
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Client" WHERE id IN (${Prisma.join(distinct(ids))}) ORDER BY id FOR SHARE`);
      const rows = await tx.client.findMany({ where: { id: { in: distinct(ids) } }, select: { id: true, name: true, lastName: true, middleName: true, phone: true,
        email: true, address: true, passportNumber: true, passportIssuedBy: true, updatedAt: true } });
      return rows.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })) satisfies ContractClient[];
    },
    async contract(primaryId) {
      const rows = await tx.$queryRaw<ContractRecord[]>`SELECT id,"primaryProposalId",revision,settings FROM "ProposalContract" WHERE "primaryProposalId"=${primaryId}`;
      return rows[0] ?? null;
    },
    async history(contractId) {
      const rows = await tx.$queryRaw<(Omit<ContractHistoryEntry, "createdAt"> & { createdAt: Date })[]>`SELECT v.id,v."createdAt",v."docxArtifactId",a."fileName"
        FROM "ProposalContractVersion" v JOIN "ProposalArtifact" a ON a.id=v."docxArtifactId" AND a."contractId"=v."contractId"
        WHERE v."contractId"=${contractId} ORDER BY v."createdAt" DESC,v.id DESC`;
      return rows.map(row => ({ ...row, createdAt: iso(row.createdAt) }));
    },
    async receipt(operationId) {
      const row = await tx.changeLog.findUnique({ where: { id: "kp-contract-operation:" + operationId }, select: { newValue: true } });
      return row?.newValue ? row.newValue as unknown as ContractReceipt : null;
    },
    async writeReceipt(operationId, primaryId, action, actor, receipt) {
      await tx.changeLog.create({ data: { id: "kp-contract-operation:" + operationId, actorType: "user", actorId: actor.id, source: actor.source,
        entity: "proposalContract", entityId: primaryId, action, newValue: receipt as unknown as Prisma.InputJsonValue } });
    },
    async saveDraft(input) {
      let rows: ContractRecord[];
      if (input.create) {
        rows = await tx.$queryRaw<ContractRecord[]>`INSERT INTO "ProposalContract" (id,"primaryProposalId",settings,revision,"createdById","createdAt","updatedAt")
          VALUES (${input.id},${input.primaryId},${json(input.settings)}::jsonb,1,${input.actorId},NOW(),NOW())
          ON CONFLICT ("primaryProposalId") DO NOTHING RETURNING id,"primaryProposalId",settings,revision`;
      } else {
        rows = await tx.$queryRaw<ContractRecord[]>`UPDATE "ProposalContract" SET settings=${json(input.settings)}::jsonb,revision=revision+1,"updatedAt"=NOW()
          WHERE "primaryProposalId"=${input.primaryId} AND revision=${input.expectedRevision} RETURNING id,"primaryProposalId",settings,revision`;
      }
      if (rows.length !== 1) contractFailure("CONTRACT_REVISION_CHANGED", "Договор изменён — обновите форму");
      await tx.$executeRaw`DELETE FROM "ProposalContractSource" WHERE "contractId"=${rows[0].id}`;
      for (const [index, proposalId] of input.sourceIds.entries()) await tx.$executeRaw`INSERT INTO "ProposalContractSource" ("contractId","proposalId",position) VALUES (${rows[0].id},${proposalId},${index + 1})`;
      return rows[0];
    },
    async createJob(input) {
      await tx.$executeRaw`INSERT INTO "ProposalJob" (id,"contractId",kind,state,"dedupeKey",payload,"createdById","createdAt","updatedAt")
        VALUES (${input.id},${input.contractId},'CONTRACT','PENDING',${input.dedupeKey},${json(input.payload)}::jsonb,${input.actorId},NOW(),NOW())`;
    },
    async job(id) {
      const rows = await tx.$queryRaw<(Omit<ContractJob, "leaseUntil"> & { leaseUntil: Date | null })[]>`SELECT id,"contractId",kind::text,state::text,"dedupeKey",payload,result,attempts,"maxAttempts","leaseOwner","leaseUntil" FROM "ProposalJob" WHERE id=${id} FOR UPDATE`;
      return rows[0] ? { ...rows[0], leaseUntil: rows[0].leaseUntil?.toISOString() ?? null } : null;
    },
    async artifact(id) {
      const rows = await tx.$queryRaw<ContractArtifact[]>`SELECT id,"proposalId","contractId",kind::text,state::text,"storageBinding",key,sha256,size,"fileName","mimeType" FROM "ProposalArtifact" WHERE id=${id} FOR UPDATE`;
      return rows[0] ?? null;
    },
    async createPendingArtifact(artifact) {
      if (artifact.state !== "PENDING") contractFailure("CONTRACT_ARTIFACT_INVALID", "Артефакт должен ожидать проверки", 400);
      await tx.$executeRaw`INSERT INTO "ProposalArtifact" (id,"proposalId","contractId",kind,state,"storageBinding",key,sha256,size,"fileName","mimeType","createdAt")
        VALUES (${artifact.id},${artifact.proposalId},${artifact.contractId},${artifact.kind}::"ProposalArtifactKind",'PENDING',${json(artifact.storageBinding)}::jsonb,${artifact.key},${artifact.sha256},${artifact.size},${artifact.fileName},${artifact.mimeType},NOW())`;
    },
    async makeArtifactReady(id) {
      const count = await tx.$executeRaw`UPDATE "ProposalArtifact" SET state='READY' WHERE id=${id} AND state='PENDING' AND "deletedAt" IS NULL`;
      if (count !== 1) contractFailure("CONTRACT_ARTIFACT_INVALID", "Подготовленный файл договора недоступен");
    },
    async createContractVersion(input) {
      await tx.$executeRaw`INSERT INTO "ProposalContractVersion" (id,"contractId","settingsSnapshot","clientSnapshot","sourcesSnapshot","renderSnapshot","templateVersion","docxArtifactId","createdById","createdAt")
        VALUES (${input.id},${input.contractId},${json(input.settingsSnapshot)}::jsonb,${json(input.clientSnapshot)}::jsonb,${json(input.sourcesSnapshot)}::jsonb,${json(input.renderSnapshot)}::jsonb,${input.templateVersion},${input.docxArtifactId},${input.actorId},NOW())`;
    },
    async completeJob(claim: ContractClaim, result: ContractObject) {
      const count = await tx.$executeRaw`UPDATE "ProposalJob" SET state='SUCCEEDED',result=${json(result)}::jsonb,"leaseOwner"=NULL,"leaseUntil"=NULL,"lastErrorCode"=NULL,"updatedAt"=NOW()
        WHERE id=${claim.id} AND kind='CONTRACT' AND state='PROCESSING' AND "leaseOwner"=${claim.owner} AND attempts=${claim.attempt} AND "leaseUntil">clock_timestamp()`;
      if (count !== 1) contractFailure("CONTRACT_LEASE_LOST", "Аренда задания договора истекла");
    },
    async failJob(claim, code, terminal) {
      await tx.$executeRaw`UPDATE "ProposalJob" SET state=CASE WHEN ${terminal} OR attempts>="maxAttempts" THEN 'FAILED'::"ProposalJobState" ELSE 'PENDING'::"ProposalJobState" END,
        "availableAt"=NOW()+make_interval(secs=>LEAST(900,30*power(2,LEAST(attempts-1,5)))::double precision),
        "leaseOwner"=NULL,"leaseUntil"=NULL,"lastErrorCode"=${code},"updatedAt"=NOW()
        WHERE id=${claim.id} AND state='PROCESSING' AND "leaseOwner"=${claim.owner} AND attempts=${claim.attempt} AND "leaseUntil">clock_timestamp()`;
    },
    async event(actorId, type, payload) {
      return (await tx.domainEvent.create({ data: { actor: actorId, type, payload: payload as Prisma.InputJsonValue } })).id;
    },
  };
}

export function createPostgresContractStore(transaction: TaskTransaction = withTaskTransaction): ContractStore {
  return { transaction: run => transaction(tx => run(createPostgresContractTransaction(tx))) };
}
