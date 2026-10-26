import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { storageConfiguration } from "../../src/lib/s3";
import { archiveAssert, byteHash, canonical, valueHash, type TargetProfile } from "../../src/server/kp/archive/contract";
import { validateArchiveManifest } from "../../src/server/kp/archive/manifest";
import { normalizeImportedProposals, parseImportedProposalNormalization } from "../../src/server/kp/archive/normalize";
import { productionArchiveBinding } from "../../src/server/kp/archive/production-target";
import { proposalMediaExpiry } from "../../src/server/kp/media-contract";
import { parseProposalState } from "../../src/server/kp/storage-contract";
import { nativeAcceptanceBinding, type NativeDeclaration } from "../../tests/helpers/native-acceptance-target";
import { nativeSnapshot } from "../../tests/helpers/native-acceptance-snapshot";
export { captureImportedProposalNormalization, normalizationOwnedRows } from "../../src/server/kp/archive/normalize";
export { valueHash } from "../../src/server/kp/archive/contract";

async function jsonFile(path: string): Promise<unknown> {
  const file = resolve(path), info = await stat(file);
  archiveAssert(info.isFile() && info.size > 0 && info.size <= 64 * 1024 * 1024, "KP_NORMALIZATION_INPUT_INVALID");
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}
async function main() {
  const values = new Map<string, string>(); let apply = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--help") {
      process.stdout.write("Offline review: normalize-imported.ts --manifest=<original-import.json> --plan=<root-reviewed-plan.json>\nApply metadata only: add --apply --reviewed=<canonical-plan-SHA256> --revision=<SHA40>\nProduction additionally requires --production-proof=<private.json> --reviewed-production-proof=<canonical-proof-SHA256> --authorize-production=<plan-operation-UUID>. Proof manifestHash is the normalization plan digest, not the original import digest.\nPlan capture is Root-only guarded REPEATABLE READ READ ONLY via captureImportedProposalNormalization; no source/S3 I/O, save/pricing/generation or schema changes.\n"); return;
    }
    if (arg === "--apply") { archiveAssert(!apply, "KP_NORMALIZATION_ARGUMENTS_INVALID"); apply = true; continue; }
    const match = /^--(manifest|plan|reviewed|revision|production-proof|reviewed-production-proof|authorize-production)=(.+)$/.exec(arg);
    archiveAssert(match && !values.has(match[1]), "KP_NORMALIZATION_ARGUMENTS_INVALID"); values.set(match[1], match[2]);
  }
  archiveAssert(values.has("manifest") && values.has("plan") && (apply || [...values.keys()].every(key => key === "manifest" || key === "plan")), "KP_NORMALIZATION_ARGUMENTS_INVALID");
  const manifest = validateArchiveManifest(await jsonFile(values.get("manifest")!), { validateState: parseProposalState, expiry: proposalMediaExpiry });
  const plan = parseImportedProposalNormalization(await jsonFile(values.get("plan")!), manifest), digest = valueHash(plan);
  const summary = { planHash: digest, proposals: plan.proposals.length, linkedItems: plan.proposals.reduce((n, row) => n + row.links.length, 0) };
  if (!apply) { process.stdout.write(JSON.stringify({ mode: "dry-run", ...summary }) + "\n"); return; }
  archiveAssert(values.get("reviewed") === digest && /^[a-f0-9]{40}$/.test(values.get("revision") ?? ""), "KP_NORMALIZATION_REVIEW_REQUIRED");
  const production = plan.target.database.kind === "production", productionArgs = ["production-proof", "reviewed-production-proof", "authorize-production"];
  archiveAssert(production ? productionArgs.every(key => values.has(key)) : productionArgs.every(key => !values.has(key)), "ARCHIVE_PRODUCTION_ARGUMENTS_REQUIRED");
  const productionBinding = production ? productionArchiveBinding({ manifest: { target: plan.target, sha256: digest },
    proof: await jsonFile(values.get("production-proof")!), reviewedHash: values.get("reviewed-production-proof")!, authorization: values.get("authorize-production")!,
    revision: values.get("revision")!, actorId: plan.operatorId, operationId: plan.operationId, programSha256: byteHash(await readFile(resolve(process.argv[1]))) }) : undefined;
  const declaration: NativeDeclaration | undefined = production ? undefined : { target: plan.target.database.kind as "local" | "staging", revision: values.get("revision")!, runId: plan.operationId, scenarioId: "kp-archive-import" };
  const observedStorage = () => {
    const config = storageConfiguration(); archiveAssert(config.mode === "s3", "ARCHIVE_TARGET_STORAGE_CHANGED");
    return { endpoint: config.endpoint.replace(/\/$/, ""), bucket: config.bucket, region: config.region };
  };
  const guardTarget = async (target: TargetProfile, client?: PoolClient) => {
    if (productionBinding) return productionBinding.guard(target, observedStorage(), client);
    const bound = nativeAcceptanceBinding(declaration!);
    const database = declaration!.target === "local" ? { kind: "local", containerId: bound.identity.containerId, name: "pero_crm", schema: "public", host: "127.0.0.1", port: 5433 }
      : { kind: "staging", containerId: bound.identity.database, name: "crm", schema: "public", host: "db", port: 5432, revision: declaration!.revision, volume: "crm-staging_pgdata" };
    archiveAssert(canonical(database) === canonical(target.database) && canonical(observedStorage()) === canonical(target.storage), "ARCHIVE_TARGET_GUARD_MISMATCH");
  };
  await guardTarget(plan.target);
  const binding = productionBinding ?? nativeAcceptanceBinding(declaration!), pool = new Pool({ connectionString: binding.url, max: 1, application_name: "pero-kp-import-normalization", connectionTimeoutMillis: 10000 });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    const result = await normalizeImportedProposals(client, manifest, plan, { reviewedHash: digest, guardTarget, baseline: async (db, owned) => {
      const adapter = { async $queryRawUnsafe<T = unknown>(sql: string, ...parameters: unknown[]): Promise<T> { return (await db.query(sql, parameters)).rows as T; } };
      return (await nativeSnapshot(adapter as Parameters<typeof nativeSnapshot>[0], owned)).digest;
    } });
    process.stdout.write(JSON.stringify({ mode: "applied", ...result }) + "\n");
  } finally { client?.release(); await pool.end(); }
}
if (require.main === module) void main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z][A-Z0-9_]{1,100}$/.test(error.code) ? error.code : "KP_NORMALIZATION_FAILED";
  process.stderr.write(JSON.stringify({ ok: false, code }) + "\n"); process.exitCode = 1;
});
