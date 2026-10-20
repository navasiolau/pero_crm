import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import type { PoolClient } from "pg";
import { z } from "zod";
import { archiveAssert, byteHash, canonical, parseTargetProfile, valueHash, type ArchiveManifest, type Binding, type TargetProfile } from "./contract";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const proofSchema = z.object({
  schema: z.literal(1), kind: z.literal("KP_ARCHIVE_PRODUCTION_RELEASE"), releaseReceiptSha256: sha256,
  revision: z.string().regex(/^[a-f0-9]{40}$/), programSha256: sha256, manifestHash: sha256, targetHash: sha256,
  operatorId: z.string().min(1).max(160), operationId: z.uuid(), capturedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  runtime: z.object({ containerId: sha256, image: z.string().regex(/^sha256:[a-f0-9]{64}$/), buildIdSha256: sha256, serverSha256: sha256 }).strict(),
  database: z.object({ systemIdentifier: z.string().regex(/^[0-9]+$/), databaseOid: z.string().regex(/^[0-9]+$/),
    serverAddress: z.ipv4().or(z.ipv6()), serverPort: z.number().int().min(1).max(65535) }).strict(),
}).strict();
const databaseOptions = new Set(["schema", "connection_limit", "pool_timeout", "connect_timeout", "socket_timeout", "sslmode"]);

/** Только операторский release proof; QA helper и его TEST_TARGET_ONLY не расширяются. */
export function productionArchiveBinding(input: {
  proof: unknown; reviewedHash: string; authorization: string; manifest: ArchiveManifest;
  revision: string; actorId: string; operationId: string; programSha256: string;
}) {
  const parsed = proofSchema.safeParse(input.proof);
  archiveAssert(parsed.success, "ARCHIVE_PRODUCTION_PROOF_INVALID");
  const proof = parsed.data, target = parseTargetProfile(input.manifest.target);
  archiveAssert(target.database.kind === "production" && input.reviewedHash === valueHash(proof) && input.authorization === proof.operationId,
    "ARCHIVE_PRODUCTION_REVIEW_REQUIRED");
  const database = target.database;
  archiveAssert(proof.revision === input.revision && proof.revision === database.revision && proof.programSha256 === input.programSha256 &&
    proof.manifestHash === input.manifest.sha256 && proof.targetHash === valueHash(target) && proof.operatorId === input.actorId && proof.operationId === input.operationId &&
    proof.runtime.containerId !== database.containerId, "ARCHIVE_PRODUCTION_OPERATION_CHANGED");
  const url = new URL(process.env.DATABASE_URL ?? "");
  archiveAssert(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === database.host && Number(url.port || 5432) === database.port &&
    decodeURIComponent(url.pathname) === "/" + database.name && decodeURIComponent(url.username) === database.user && !url.hash &&
    [...url.searchParams.keys()].every(key => databaseOptions.has(key) && url.searchParams.getAll(key).length === 1) &&
    (!url.searchParams.has("schema") || url.searchParams.get("schema") === database.schema), "ARCHIVE_PRODUCTION_DATABASE_BINDING_REQUIRED");
  const connectionHash = byteHash(process.env.DATABASE_URL!);
  return {
    url: url.toString(),
    async guard(current: TargetProfile, storage: Binding, client?: PoolClient) {
      archiveAssert(valueHash(parseTargetProfile(current)) === proof.targetHash && canonical(storage) === canonical(target.storage) &&
        byteHash(process.env.DATABASE_URL ?? "") === connectionHash, "ARCHIVE_PRODUCTION_BINDING_CHANGED");
      const captured = Date.parse(proof.capturedAt), expires = Date.parse(proof.expiresAt), now = Date.now();
      archiveAssert(captured <= now && now < expires && expires > captured && expires - captured <= 60 * 60 * 1000, "ARCHIVE_PRODUCTION_PROOF_EXPIRED");
      const host = hostname();
      archiveAssert(process.platform === "linux" && process.env.NODE_ENV === "production" && existsSync("/.dockerenv") &&
        /^[a-f0-9]{12,64}$/.test(host) && proof.runtime.containerId.startsWith(host) && !process.env.CRM_MODERNIZATION_TARGET && !process.env.CRM_MODERNIZATION_STAGE_PROOF,
        "ARCHIVE_PRODUCTION_RUNTIME_MISMATCH");
      // Эти файлы принадлежат установленному standalone image, а не переданному CLI пакету.
      const [build, server] = await Promise.all([readFile("/app/apps/web/.next/BUILD_ID"), readFile("/app/apps/web/server.js")]);
      archiveAssert(byteHash(build) === proof.runtime.buildIdSha256 && byteHash(server) === proof.runtime.serverSha256, "ARCHIVE_PRODUCTION_RUNTIME_CHANGED");
      if (client) {
        const { rows } = await client.query('SELECT current_database() AS database,current_schema() AS schema,current_user AS "user",session_user AS "sessionUser",host(inet_server_addr()) AS "serverAddress",inet_server_port() AS "serverPort",(SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier",(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS "databaseOid",pg_is_in_recovery() AS recovery');
        archiveAssert(rows.length === 1 && canonical(rows[0]) === canonical({ ...proof.database, database: database.name, schema: database.schema,
          user: database.user, sessionUser: database.user, recovery: false }), "ARCHIVE_PRODUCTION_DATABASE_IDENTITY_MISMATCH");
      }
    },
  };
}
