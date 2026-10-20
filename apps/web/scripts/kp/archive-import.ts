import { createRequire } from "node:module";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { archiveAssert, ArchiveImportError, assertArchiveReservationRecovery, byteHash, canonical, isObject, parseArchiveReservationWitness, parseBinding, parseSourceProfile, parseTargetProfile,
  type ArchiveDependencies, type ArchiveManifest, type ArchiveObject, type ArchiveReservationRecovery, type DocxBinding, type JsonObject, type TargetProfile } from "../../src/server/kp/archive/contract";
import { createRecoveryArchiveSource } from "../../src/server/kp/archive/recovery-source";
import { assertRecoverySourceBinding } from "../../src/server/kp/archive/recovery-contract";
import { archiveReport, prepareArchiveManifest, validateArchiveManifest } from "../../src/server/kp/archive/manifest";
import { applyArchiveManifest, type ArchiveTargetIO } from "../../src/server/kp/archive/apply";
import { archiveOwnedRows, createArchiveSqlStore } from "../../src/server/kp/archive/prisma-store";
import { createReadonlyArchiveSource, sourceConfigurationFromEnvironment } from "../../src/server/kp/archive/source";
import { nativeAcceptanceBinding, type NativeDeclaration } from "../../tests/helpers/native-acceptance-target";
import { nativeSnapshot } from "../../tests/helpers/native-acceptance-snapshot";
export { archiveOwnedRows, archiveRecoveryReceiptIds, captureArchiveReservationWitness } from "../../src/server/kp/archive/prisma-store";
export { assertArchiveReservationRecovery, parseArchiveReservationWitness, valueHash } from "../../src/server/kp/archive/contract";

const webRoot = resolve(__dirname, "../.."), workspace = resolve(webRoot, "../.."), legacyRoot = "D:/Projects/pero_kp";
const privateRoot = resolve(workspace, ".playwright-mcp/kp-189");
type FunctionValue = (...args: unknown[]) => unknown;
function method(object: unknown, name: string): FunctionValue {
  archiveAssert(object !== null && (typeof object === "object" || typeof object === "function"), "ARCHIVE_DEPENDENCIES_NOT_INTEGRATED");
  const fn: unknown = (object as Record<string, unknown>)[name]; archiveAssert(typeof fn === "function", "ARCHIVE_DEPENDENCIES_NOT_INTEGRATED");
  return (...args) => Reflect.apply(fn, object, args) as unknown;
}
function sharedModule(name: string): unknown {
  try { const require = createRequire(resolve(webRoot, "package.json")); const loaded: unknown = require(resolve(webRoot, "src/server/kp", name + ".ts")); return loaded; }
  catch { throw new ArchiveImportError("ARCHIVE_DEPENDENCIES_NOT_INTEGRATED"); }
}
function sharedDependencies(): ArchiveDependencies {
  const state = sharedModule("storage-contract"), media = sharedModule("media-contract");
  return { validateState(value) {
    const parsed = method(state, "parseProposalState")(value); archiveAssert(isObject(parsed) && Array.isArray(parsed.items) && parsed.items.every(isObject), "ARCHIVE_STATE_INVALID"); return parsed as JsonObject & { items: JsonObject[] };
  }, expiry(date) { const expiry = method(media, "proposalMediaExpiry")(date); archiveAssert(expiry instanceof Date && Number.isFinite(expiry.getTime()), "ARCHIVE_EXPIRY_INVALID"); return expiry; } };
}
export function sharedTargetIO(load: (name: string) => unknown = sharedModule): ArchiveTargetIO {
  const media = load("media-storage"), images = method(media, "createProposalMediaS3Storage")();
  const mediaBinding = method(load("media-contract"), "parseMediaBinding");
  const artifacts = method(load("artifact-storage"), "createProposalArtifactStorage")({ maxBytes: 128 * 1024 * 1024 });
  const artifactFor = (object: ArchiveObject) => ({ id: object.artifactId, proposalId: null, contractId: object.contractId, storageBinding: object.binding, key: object.key, sha256: object.sha256, size: object.size, mimeType: object.mimeType });
  return {
    binding: () => parseBinding(method(artifacts, "binding")()),
    async ensure(object, bytes, authorize) {
      await authorize();
      if (object.role === "docx") {
        const verified = await method(artifacts, "uploadAndVerify")(artifactFor(object), bytes, authorize);
        archiveAssert(isObject(verified) && verified.key === object.key && verified.sha256 === object.sha256 && verified.size === object.size, "ARCHIVE_READBACK_MISMATCH");
      } else {
        archiveAssert(canonical(mediaBinding(method(images, "currentBinding")())) === canonical(mediaBinding(object.binding)), "ARCHIVE_TARGET_STORAGE_CHANGED");
        await method(media, "putVerifiedProposalMedia")(images, object.binding, { key: object.key, sha256: object.sha256, size: object.size, mimeType: object.mimeType }, Buffer.from(bytes), authorize);
      }
      await authorize(); return { key: object.key, sha256: object.sha256, size: object.size };
    },
    async verify(object, authorize) {
      await authorize();
      const bytes = object.role === "docx" ? await method(artifacts, "read")(artifactFor(object), authorize) : await method(images, "read")(object.binding, { key: object.key, sha256: object.sha256, size: object.size, mimeType: object.mimeType });
      archiveAssert(bytes instanceof Uint8Array && bytes.length === object.size && byteHash(bytes) === object.sha256, "ARCHIVE_READBACK_MISMATCH");
      await authorize();
    },
  };
}
async function jsonFile(path: string): Promise<unknown> {
  const file = resolve(path), info = await stat(file); archiveAssert(info.isFile() && info.size > 0 && info.size <= 64 * 1024 * 1024, "ARCHIVE_INPUT_FILE_INVALID");
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}
async function writePrivateOutput(path: string, manifest: ArchiveManifest) {
  const destination = resolve(path), legacy = await realpath(legacyRoot);
  const inside = (child: string, parent: string) => { const value = relative(parent, child); return !value || !value.startsWith("..") && !value.includes(":"); };
  let probe = dirname(destination); const suffix = [destination.slice(probe.length + 1)];
  for (;;) {
    try { probe = await realpath(probe); break; }
    catch (error) { archiveAssert(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT", "ARCHIVE_OUTPUT_PATH_INVALID"); suffix.unshift(probe.slice(dirname(probe).length + 1)); probe = dirname(probe); }
  }
  const physical = resolve(probe, ...suffix);
  archiveAssert(!inside(physical, legacy), "ARCHIVE_SOURCE_IS_READ_ONLY");
  archiveAssert(!inside(physical, workspace) || inside(physical, privateRoot), "ARCHIVE_OUTPUT_MUST_BE_PRIVATE");
  await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
}
function bindingFor(declaration: NativeDeclaration): TargetProfile["database"] {
  const bound = nativeAcceptanceBinding(declaration);
  if (declaration.target === "local") return { kind: "local", containerId: String(bound.identity.containerId), name: "pero_crm", schema: "public", host: "127.0.0.1", port: 5433 };
  return { kind: "staging", containerId: String(bound.identity.database), name: "crm", schema: "public", host: "db", port: 5432, revision: declaration.revision, volume: "crm-staging_pgdata" };
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write("Dry-run: archive-import.ts --manifest=<private.json>\nPrepare (source GET/LIST only): --prepare --source-profile=<json> --target-profile=<json> --output=<private.json> [--links=<json>] [--originals=<json>]\nApply reviewed: --apply --manifest=<private.json> --reviewed=<SHA256> --actor-id=<ADMIN_ID> --revision=<SHA40> --run-id=<UUID>\nExplicit new ADMIN reservation recovery: --resume-reservation=<private-witness.json> --reviewed-reservation=<canonical-witness-SHA256> (both required with apply; witness pins operator/run/program)\nReviewed missing-object recovery for prepare/apply: --recovery-map=<json> --recovery-root=<hash-named-assets-dir> (both required; real source GET remains mandatory)\nOnly existing guarded local5433/staging; credentials via environment; no flags/source/storage deletion.\n"); return;
  }
  const flags = new Set<string>(), values = new Map<string, string>();
  for (const arg of args) {
    if (arg === "--prepare" || arg === "--apply") { archiveAssert(!flags.has(arg), "ARCHIVE_ARGUMENTS_INVALID"); flags.add(arg); continue; }
    const match = /^--(manifest|source-profile|target-profile|output|links|originals|reviewed|actor-id|revision|run-id|recovery-map|recovery-root|resume-reservation|reviewed-reservation)=(.+)$/.exec(arg);
    archiveAssert(match && !values.has(match[1]), "ARCHIVE_ARGUMENTS_INVALID"); values.set(match[1], match[2]);
  }
  archiveAssert(!(flags.has("--prepare") && flags.has("--apply")), "ARCHIVE_ARGUMENTS_INVALID");
  const prepare = flags.has("--prepare"), apply = flags.has("--apply");
  const allowed = new Set(prepare ? ["source-profile", "target-profile", "output", "links", "originals", "recovery-map", "recovery-root"] : apply ? ["manifest", "reviewed", "actor-id", "revision", "run-id", "recovery-map", "recovery-root", "resume-reservation", "reviewed-reservation"] : ["manifest"]);
  archiveAssert([...values.keys()].every(key => allowed.has(key)), "ARCHIVE_ARGUMENTS_INVALID");
  archiveAssert(values.has("recovery-map") === values.has("recovery-root"), "ARCHIVE_RECOVERY_ARGUMENTS_REQUIRED");
  archiveAssert(values.has("resume-reservation") === values.has("reviewed-reservation"), "ARCHIVE_RESERVATION_ARGUMENTS_REQUIRED");
  const recoveryMap = values.has("recovery-map") ? await jsonFile(values.get("recovery-map")!) : undefined;
  const sourceFor = (profile: ArchiveManifest["source"]) => {
    const cloud = createReadonlyArchiveSource(profile, () => sourceConfigurationFromEnvironment(process.env));
    return { ...(recoveryMap === undefined ? cloud : createRecoveryArchiveSource(cloud, recoveryMap, values.get("recovery-root")!)), close: () => cloud.close() };
  };
  if (apply) archiveAssert(/^[a-f0-9]{64}$/.test(values.get("reviewed") ?? "") && values.has("actor-id") && /^[a-f0-9]{40}$/.test(values.get("revision") ?? "") && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(values.get("run-id") ?? ""), "ARCHIVE_APPLY_ARGUMENTS_REQUIRED");
  if (prepare) {
    archiveAssert(values.has("source-profile") && values.has("target-profile") && values.has("output") && !values.has("manifest") && !values.has("reviewed"), "ARCHIVE_PREPARE_ARGUMENTS_REQUIRED");
    const sourceProfile = parseSourceProfile(await jsonFile(values.get("source-profile")!)), target = parseTargetProfile(await jsonFile(values.get("target-profile")!));
    const links = values.has("links") ? await jsonFile(values.get("links")!) : {}, originals = values.has("originals") ? await jsonFile(values.get("originals")!) : {};
    archiveAssert(isObject(links) && Object.values(links).every(value => isObject(value) && typeof value.primaryDocumentId === "string" && typeof value.reviewed === "boolean" && /^[a-f0-9]{64}$/.test(String(value.evidenceSha256))) && isObject(originals) && Object.values(originals).every(value => typeof value === "string"), "ARCHIVE_REVIEW_MAP_INVALID");
    const source = sourceFor(sourceProfile);
    try {
      const manifest = await prepareArchiveManifest(source, target, sharedDependencies(), links as unknown as Record<string, DocxBinding>, originals as Record<string, string>);
      await writePrivateOutput(values.get("output")!, manifest); process.stdout.write(JSON.stringify({ mode: "prepared", output: resolve(values.get("output")!), ...archiveReport(manifest) }) + "\n"); return;
    } finally { await source.close(); }
  }
  archiveAssert(values.has("manifest") && !values.has("source-profile") && !values.has("target-profile") && !values.has("output") && !values.has("links") && !values.has("originals"), "ARCHIVE_MANIFEST_ARGUMENT_REQUIRED");
  const deps = sharedDependencies(), manifest = validateArchiveManifest(await jsonFile(values.get("manifest")!), deps);
  if (!apply) { archiveAssert(!values.has("reviewed") && !values.has("actor-id"), "ARCHIVE_ARGUMENTS_INVALID"); process.stdout.write(JSON.stringify({ mode: "dry-run", ...archiveReport(manifest) }) + "\n"); return; }
  archiveAssert(values.get("reviewed") === manifest.sha256 && archiveReport(manifest).applicable, "ARCHIVE_REVIEW_REQUIRED");
  const recovery: ArchiveReservationRecovery | undefined = values.has("resume-reservation") ? { witness: parseArchiveReservationWitness(await jsonFile(values.get("resume-reservation")!)),
    reviewedHash: values.get("reviewed-reservation")!, operationId: values.get("run-id")!, programSha256: byteHash(await readFile(resolve(process.argv[1]))) } : undefined;
  if (recovery) assertArchiveReservationRecovery(recovery, manifest, values.get("actor-id")!);
  const source = sourceFor(manifest.source); assertRecoverySourceBinding(manifest, source.recoveryMap?.());
  const declaration: NativeDeclaration = { target: manifest.target.database.kind, scenarioId: "kp-archive-import", revision: values.get("revision")!, runId: values.get("run-id")! };
  const io = sharedTargetIO();
  const guardTarget = async (target: TargetProfile) => { archiveAssert(canonical(bindingFor(declaration)) === canonical(target.database) && canonical(io.binding()) === canonical(target.storage), "ARCHIVE_TARGET_GUARD_MISMATCH"); };
  await guardTarget(manifest.target);
  const binding = nativeAcceptanceBinding(declaration), pool = new Pool({ connectionString: binding.url, max: 1, application_name: "pero-kp-archive-import", connectionTimeoutMillis: 10000 });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    const store = createArchiveSqlStore(client, { actorId: values.get("actor-id")!, recovery, guardTarget: current => guardTarget(current.target), baseline: async (db, current) => {
      const adapter = { async $queryRawUnsafe<T = unknown>(sql: string, ...parameters: unknown[]): Promise<T> { return (await db.query(sql, parameters)).rows as T; } };
      return (await nativeSnapshot(adapter as Parameters<typeof nativeSnapshot>[0], archiveOwnedRows(current, recovery?.operationId))).digest;
    } });
    const result = await applyArchiveManifest(manifest, { apply: true, reviewedHash: values.get("reviewed"), deps, source, store, io, guardTarget });
    process.stdout.write(JSON.stringify(result) + "\n");
  } finally { try { client?.release(); await pool.end(); } finally { await source.close(); } }
}
if (require.main === module) void main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z][A-Z0-9_]{1,100}$/.test(error.code) ? error.code : "ARCHIVE_IMPORT_FAILED";
  process.stderr.write(JSON.stringify({ ok: false, code }) + "\n"); process.exitCode = 1;
});
