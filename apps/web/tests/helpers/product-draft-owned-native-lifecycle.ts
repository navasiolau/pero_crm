import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { draftSchemaFingerprint } from "./product-draft-native";

const APP = "C:/Users/admin/.codex/worktrees/crm-task-111/pero_crm_v2/apps/web";
const RESULTS = resolve(APP, "test-results");
const LEASE = resolve(RESULTS, "task111-native-owned-lease.json");
export const NATIVE_CONTAINER = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const SOURCE_PATHS = [
  resolve(APP, "tests/product-draft-concurrency-native.ts"),
  resolve(APP, "tests/helpers/product-draft-owned-native-lifecycle.ts"),
];
export const OWNED_TABLES = ["User", "Client", "Project", "Product", "ProductPercentageConfig", "ProductStatusHistory", "ProjectStageHistory", "ChangeLog", "DomainEvent"] as const;
export type OwnedTable = typeof OWNED_TABLES[number];
type Sql = Prisma.TransactionClient;
export type Fingerprint = { count: string; sha256: string };
export type Snapshot = Record<string, Fingerprint>;
type LegacyFingerprint = { count: string; hash: string };
type NativeSchema = { columns: LegacyFingerprint; constraints: LegacyFingerprint; indexes: LegacyFingerprint; enums: LegacyFingerprint; catalog: Snapshot; productStatusDefaultSha256: string };
const CATALOG_KEYS = ["relations", "triggers", "routines", "sequences", "views", "policies", "schema"];
export type RowProof = { id: string; createdAt: string; updatedAt: string | null; revision: number | null; sha256: string };
export type Scope = Record<OwnedTable, RowProof[]>;
export type Keys = { runId: string; actorId: string; clientId: string; projectIds: string[] };
export type Phase = "setup" | "create-first" | "contract-after-create" | "contract-first" | "create-after-contract" | "number-first" | "number-second";
export const PLANS: Record<Phase, Partial<Record<OwnedTable, number>>> = {
  setup: { User: 1, Client: 1, Project: 3 },
  "create-first": { Product: 1, ProductPercentageConfig: 3, ProductStatusHistory: 1, ChangeLog: 1 },
  "contract-after-create": { Project: 1, Product: 1, ProductStatusHistory: 1, ProjectStageHistory: 1, ChangeLog: 2, DomainEvent: 2 },
  "contract-first": { Project: 1, ProjectStageHistory: 1, ChangeLog: 1, DomainEvent: 1 },
  "create-after-contract": { Product: 1, ProductPercentageConfig: 3, ProductStatusHistory: 1, ChangeLog: 1 },
  "number-first": { Product: 1, ProductPercentageConfig: 3, ProductStatusHistory: 1, ChangeLog: 1 },
  "number-second": { Product: 1, ProductPercentageConfig: 3, ProductStatusHistory: 1, ChangeLog: 1 },
};
export type Pre = {
  kind: "crm111-native-owned-pre"; version: 1; keys: Keys; startedAt: string; pid: number;
  target: "local"; containerId: string; sources: string[]; tables: string[];
  originalRows: Snapshot; originalSchema: NativeSchema; originalBaselineAvailable: true;
};
export type Part = {
  kind: "intent" | "proof" | "outcome" | "cleanup-intent" | "closed";
  runId: string; preSha256: string; txId: string; at: string;
  phase?: Phase; projectId?: string | null; xid32?: string; scope?: Scope;
  status?: "COMMIT_ACK" | "ROLLBACK_OR_UNCERTAIN" | "CLEANUP_COMMIT_ACK";
  originalRowsSha256?: string; schemaSha256?: string;
  checkId?: string; table?: string; constraint?: string;
};
type Journal = { parts: Part[]; partsSha256: string; unpublishedTemps: number };

export class NativeOwnedStop extends Error {
  constructor(readonly checkId: string, readonly table?: string, readonly constraint?: string) { super("NATIVE_OWNED_STOP"); }
}
function bounded(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value) ? value : undefined;
}
export function need(ok: unknown, checkId: string, table?: string, constraint?: string): asserts ok {
  if (!ok) throw new NativeOwnedStop(checkId, bounded(table), bounded(constraint));
}
export function failure(error: unknown, fallback: string) {
  return error instanceof NativeOwnedStop
    ? { checkId: error.checkId, table: error.table, constraint: error.constraint }
    : { checkId: fallback };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return "{" + Object.keys(row).sort().map(key => JSON.stringify(key) + ":" + canonical(row[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}
export function digest(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function equal(actual: unknown, expected: unknown, checkId: string, table?: string) {
  need(canonical(actual) === canonical(expected), checkId, table);
}
export function utc(value: string): string {
  need(typeof value === "string", "proof_timestamp_type");
  const iso = value.replace(" ", "T");
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + "Z");
  need(Number.isFinite(date.getTime()), "proof_timestamp");
  return date.toISOString();
}
function id(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_:-]{1,128}$/.test(value); }
function uuid(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value); }
function quote(value: string) { need(/^[A-Za-z_][A-Za-z0-9_]*$/.test(value), "sql_identifier"); return '"' + value + '"'; }
function tableName(table: string) { return '"public".' + quote(table); }
const rowHash = (alias: string) => "encode(sha256(convert_to(to_jsonb(" + alias + ")::text,'UTF8')),'hex')";
export function emptyScope(): Scope {
  return { User: [], Client: [], Project: [], Product: [], ProductPercentageConfig: [], ProductStatusHistory: [], ProjectStageHistory: [], ChangeLog: [], DomainEvent: [] };
}
function scopeIds(scope: Scope, table: OwnedTable) { return scope[table].map(row => row.id); }
function sourceHashes() { return SOURCE_PATHS.map(path => digest(readFileSync(path))); }
function actorName(keys: Keys) { return "QA111 concurrency " + keys.runId; }
function clientName(keys: Keys) { return "QA111 concurrency client " + keys.runId; }
function blank(id: string): RowProof { return { id, createdAt: "", updatedAt: null, revision: null, sha256: "" }; }
function plannedScope(keys: Keys): Scope {
  const scope = emptyScope(); scope.User = [blank(keys.actorId)]; scope.Client = [blank(keys.clientId)];
  scope.Project = keys.projectIds.map(blank); return scope;
}
function mergeIds(...scopes: Scope[]): Scope {
  const merged = emptyScope();
  for (const table of OWNED_TABLES) {
    const map = new Map<string, RowProof>();
    for (const scope of scopes) for (const row of scope[table]) map.set(row.id, row);
    merged[table] = [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  return merged;
}
function privateFile(path: string) {
  const absolute = resolve(path), relative = absolute.slice(RESULTS.length + 1);
  need(absolute.startsWith(RESULTS + "\\") && relative.length > 0 && !relative.includes(".."), "private_journal_path");
  let ancestor = absolute;
  while (ancestor.toLowerCase() !== RESULTS.toLowerCase()) {
    if (existsSync(ancestor)) need(!lstatSync(ancestor).isSymbolicLink(), "private_journal_reparse");
    const parent = dirname(ancestor); need(parent !== ancestor, "private_journal_ancestor"); ancestor = parent;
  }
  need(realpathSync(RESULTS).toLowerCase() === RESULTS.toLowerCase(), "private_journal_root");
  execFileSync("git", ["check-ignore", "--quiet", "--", absolute], { cwd: APP, stdio: "pipe", windowsHide: true });
  return absolute;
}
/** Публикация receipt только после полного write/fsync; отдельный файл на tx. */
export function publishSteps(ops: { writeExclusive(): void; flush(): void; publish(): void }) {
  ops.writeExclusive(); ops.flush(); ops.publish();
}
function publishJson(path: string, value: unknown): string {
  privateFile(path);
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
  const temporary = privateFile(resolve(dirname(path), ".writing-" + randomUUID()));
  let fd: number | undefined;
  try {
    publishSteps({
      writeExclusive() { fd = openSync(temporary, "wx", 0o600); writeFileSync(fd, bytes); },
      flush() { need(fd !== undefined, "receipt_fd"); fsyncSync(fd); closeSync(fd); fd = undefined; },
      publish() { need(!existsSync(path), "immutable_receipt_exists"); renameSync(temporary, path); },
    });
  } finally { if (fd !== undefined) closeSync(fd); }
  return digest(bytes);
}
export function partFilename(part: Part) {
  const sha256 = digest(Buffer.from(JSON.stringify(part, null, 2) + "\n", "utf8"));
  return part.kind + "-" + part.txId + "-" + sha256 + ".json";
}
function writePart(folder: string, part: Part) { publishJson(resolve(folder, partFilename(part)), part); }
export function parsePre(value: unknown): Pre {
  const pre = value as Pre;
  need(pre?.kind === "crm111-native-owned-pre" && pre.version === 1 && pre.target === "local" && pre.containerId === NATIVE_CONTAINER && pre.originalBaselineAvailable === true, "pre_kind");
  equal(Object.keys(pre).sort(), ["kind", "version", "keys", "startedAt", "pid", "target", "containerId", "sources", "tables", "originalRows", "originalSchema", "originalBaselineAvailable"].sort(), "pre_hash_only_fields");
  equal(Object.keys(pre.keys).sort(), ["runId", "actorId", "clientId", "projectIds"].sort(), "pre_key_fields");
  need(uuid(pre.keys?.runId) && uuid(pre.keys.actorId) && uuid(pre.keys.clientId) && Array.isArray(pre.keys.projectIds) && pre.keys.projectIds.length === 3 && pre.keys.projectIds.every(uuid), "pre_known_ids");
  need(new Set([pre.keys.runId, pre.keys.actorId, pre.keys.clientId, ...pre.keys.projectIds]).size === 6, "pre_unique_ids");
  need(utc(pre.startedAt) === pre.startedAt && Number.isSafeInteger(pre.pid) && pre.pid > 0, "pre_run_identity");
  need(Array.isArray(pre.sources) && pre.sources.length === 2 && pre.sources.every(hash => /^[a-f0-9]{64}$/.test(hash)), "pre_source_hashes");
  need(Array.isArray(pre.tables) && pre.tables.length === 53 && new Set(pre.tables).size === 53 && pre.tables.every(table => /^[A-Za-z_][A-Za-z0-9_]*$/.test(table)), "pre_53_tables");
  equal(Object.keys(pre.originalRows).sort(), [...pre.tables].sort(), "pre_baseline_tables");
  for (const [table, row] of Object.entries(pre.originalRows)) {
    need(typeof row.count === "string" && /^\d+$/.test(row.count) && typeof row.sha256 === "string" && /^[a-f0-9]{64}$/.test(row.sha256), "pre_baseline_hash", table);
    equal(Object.keys(row).sort(), ["count", "sha256"], "pre_fingerprint_fields", table);
  }
  need(pre.originalSchema !== null && typeof pre.originalSchema === "object", "pre_schema_hashes");
  equal(Object.keys(pre.originalSchema).sort(), ["columns", "constraints", "indexes", "enums", "catalog", "productStatusDefaultSha256"].sort(), "pre_schema_keys");
  for (const name of ["columns", "constraints", "indexes", "enums"] as const) {
    const row = pre.originalSchema[name];
    need(row && typeof row.count === "string" && /^\d+$/.test(row.count) && typeof row.hash === "string" && /^[a-f0-9]{32}$/.test(row.hash), "pre_schema_legacy_hash");
    equal(Object.keys(row).sort(), ["count", "hash"], "pre_schema_fingerprint_keys");
  }
  need(pre.originalSchema.catalog && typeof pre.originalSchema.catalog === "object" && /^[a-f0-9]{64}$/.test(pre.originalSchema.productStatusDefaultSha256), "pre_schema_catalog_hash");
  equal(Object.keys(pre.originalSchema.catalog).sort(), [...CATALOG_KEYS].sort(), "pre_catalog_keys");
  for (const row of Object.values(pre.originalSchema.catalog)) {
    need(typeof row.count === "string" && /^\d+$/.test(row.count) && typeof row.sha256 === "string" && /^[a-f0-9]{64}$/.test(row.sha256), "pre_catalog_hash");
    equal(Object.keys(row).sort(), ["count", "sha256"], "pre_catalog_fingerprint_keys");
  }
  return pre;
}
export function parsePart(value: unknown, pre: Pre, preSha256: string): Part {
  const part = value as Part;
  need(part && ["intent", "proof", "outcome", "cleanup-intent", "closed"].includes(part.kind) && part.runId === pre.keys.runId && part.preSha256 === preSha256 && uuid(part.txId), "part_identity");
  need(Object.keys(part).every(key => ["kind", "runId", "preSha256", "txId", "at", "phase", "projectId", "xid32", "scope", "status", "originalRowsSha256", "schemaSha256", "checkId", "table", "constraint"].includes(key)), "part_hash_only_fields");
  for (const key of ["checkId", "table", "constraint"] as const) if (part[key] !== undefined) need(bounded(part[key]) === part[key], "part_bounded_diagnostics");
  need(utc(part.at) === part.at && part.at >= pre.startedAt, "part_timestamp");
  if (part.kind === "intent" || part.kind === "proof" || part.kind === "outcome") {
    need(part.phase !== undefined && Object.hasOwn(PLANS, part.phase) && (part.projectId === null || pre.keys.projectIds.includes(part.projectId ?? "")), "part_phase");
    need(part.phase === "setup" ? part.projectId === null : part.projectId !== null, "part_project");
  }
  if (part.kind === "proof") {
    need(typeof part.xid32 === "string" && /^\d+$/.test(part.xid32) && Number(part.xid32) < 4294967296, "proof_xid");
    need(part.scope && typeof part.scope === "object", "proof_scope");
    equal(Object.keys(part.scope).sort(), [...OWNED_TABLES].sort(), "proof_scope_tables");
    for (const table of OWNED_TABLES) {
      const rows = part.scope[table];
      need(Array.isArray(rows) && rows.length === (PLANS[part.phase!][table] ?? 0), "proof_plan_count", table);
      need(new Set(rows.map(row => row.id)).size === rows.length, "proof_unique_ids", table);
      for (const row of rows) {
        equal(Object.keys(row).sort(), ["id", "createdAt", "updatedAt", "revision", "sha256"].sort(), "proof_hash_only_fields", table);
        need(id(row.id) && /^[a-f0-9]{64}$/.test(row.sha256) && utc(row.createdAt) === row.createdAt && row.createdAt >= pre.startedAt && row.createdAt <= part.at, "proof_owned_time_hash", table);
        need(row.updatedAt === null || (utc(row.updatedAt) === row.updatedAt && row.updatedAt >= pre.startedAt && row.updatedAt <= part.at), "proof_owned_updated", table);
        need(row.revision === (table === "ProductPercentageConfig" ? 1 : null), "proof_config_revision", table);
      }
    }
    if (part.phase === "setup") {
      equal(scopeIds(part.scope, "User"), [pre.keys.actorId], "proof_setup_actor_id");
      equal(scopeIds(part.scope, "Client"), [pre.keys.clientId], "proof_setup_client_id");
      equal(scopeIds(part.scope, "Project").sort(), [...pre.keys.projectIds].sort(), "proof_setup_project_ids");
    } else if (part.scope.Project.length) equal(scopeIds(part.scope, "Project"), [part.projectId], "proof_changed_project_id");
    need(part.originalRowsSha256 === digest(canonical(pre.originalRows)) && part.schemaSha256 === digest(canonical(pre.originalSchema)), "proof_baseline_guards");
  }
  if (part.kind === "outcome") need(part.status === "COMMIT_ACK" || part.status === "ROLLBACK_OR_UNCERTAIN", "outcome_status");
  if (part.kind === "closed") need(part.status === "CLEANUP_COMMIT_ACK" && part.originalRowsSha256 === digest(canonical(pre.originalRows)) && part.schemaSha256 === digest(canonical(pre.originalSchema)), "closed_original_baseline");
  return part;
}
function readJournal(folder: string, pre: Pre, preSha256: string): Journal {
  privateFile(resolve(folder, "pre.json"));
  const records: { file: string; sha256: string; part: Part }[] = [];
  let unpublishedTemps = 0;
  for (const name of readdirSync(folder).sort()) {
    if (name === "pre.json") continue;
    if (/^\.writing-[a-f0-9-]{36}$/.test(name)) { unpublishedTemps++; continue; }
    const matched = /^(intent|proof|outcome|cleanup-intent|closed)-([a-f0-9-]{36})-([a-f0-9]{64})\.json$/.exec(name);
    need(matched, "journal_unknown_file");
    const file = privateFile(resolve(folder, name)), bytes = readFileSync(file);
    need(digest(bytes) === matched[3], "part_content_digest");
    const part = parsePart(JSON.parse(bytes.toString("utf8")), pre, preSha256);
    need(part.kind === matched[1] && part.txId === matched[2], "part_filename_identity");
    records.push({ file: name, sha256: matched[3], part });
  }
  const transactions = new Map<string, Part[]>();
  for (const { part } of records) {
    const parts = transactions.get(part.txId) ?? []; parts.push(part); transactions.set(part.txId, parts);
  }
  for (const parts of transactions.values()) {
    const intents = parts.filter(part => part.kind === "intent");
    const proofs = parts.filter(part => part.kind === "proof");
    const outcomes = parts.filter(part => part.kind === "outcome");
    if (intents.length || proofs.length || outcomes.length) {
      need(intents.length === 1 && proofs.length <= 1 && outcomes.length <= 1, "transaction_receipt_cardinality");
      for (const part of [...proofs, ...outcomes]) need(part.phase === intents[0].phase && part.projectId === intents[0].projectId, "transaction_receipt_plan");
      if (outcomes[0]?.status === "COMMIT_ACK") need(proofs.length === 1, "commit_requires_durable_proof");
    }
  }
  return { parts: records.map(row => row.part), partsSha256: digest(canonical(records.map(({ file, sha256 }) => ({ file, sha256 })))), unpublishedTemps };
}
export function resolveProofs(pre: Pre, parts: Part[], current: Scope): Scope {
  const proofs = parts.filter(part => part.kind === "proof");
  const present = Object.values(current).flat().length;
  if (present === 0) return current;
  for (const table of OWNED_TABLES) {
    const versions = proofs.flatMap(part => part.scope![table]);
    for (const row of current[table]) need(versions.some(proof => canonical(proof) === canonical(row)), "current_exact_receipted_cas", table);
    const acknowledgments = parts.filter(part => part.kind === "outcome" && part.status === "COMMIT_ACK");
    for (const ack of acknowledgments) {
      const proof = proofs.find(part => part.txId === ack.txId);
      need(proof, "ack_proof_missing");
      for (const row of proof.scope![table]) need(current[table].some(actual => actual.id === row.id), "acknowledged_owned_row_missing", table);
    }
  }
  need(current.User.length === 1 && current.User[0].id === pre.keys.actorId && current.Client.length === 1 && current.Client[0].id === pre.keys.clientId
    && current.Project.length === 3 && pre.keys.projectIds.every(id => current.Project.some(row => row.id === id)), "atomic_setup_owned_presence");
  return current;
}
async function fingerprint(db: Sql, sql: string, values: unknown[] = []): Promise<Fingerprint> {
  const rows = await db.$queryRawUnsafe<Fingerprint[]>("SELECT count(*)::text count,encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') sha256 FROM (SELECT " + rowHash("r") + " h FROM (" + sql + ") r) hashes", ...values);
  need(rows.length === 1 && /^\d+$/.test(rows[0].count) && /^[a-f0-9]{64}$/.test(rows[0].sha256), "fingerprint_shape");
  return rows[0];
}
async function names(db: Sql) {
  const rows = await db.$queryRawUnsafe<{ name: string }[]>("SELECT tablename name FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const tables = rows.map(row => row.name);
  need(tables.length === 53 && tables.every(table => /^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) && OWNED_TABLES.every(table => tables.includes(table)), "all_53_tables");
  return tables;
}
async function identity(db: Sql) {
  await db.$executeRawUnsafe("SET LOCAL TIMEZONE='UTC'");
  const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>("SELECT current_database() db,current_schema() schema,current_user role,pg_is_in_recovery() standby,current_setting('data_directory') directory");
  equal(rows, [{ db: "pero_crm", schema: "public", role: "pero", standby: false, directory: "/var/lib/postgresql/data" }], "local_primary_identity");
}
async function schema(db: Sql) {
  const value = await draftSchemaFingerprint(db);
  const queries: Record<string, string> = {
    relations: "SELECT c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,c.relacl,pg_get_userbyid(c.relowner) owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
    triggers: "SELECT c.relname,t.tgname,t.tgenabled,t.tgisinternal,pg_get_triggerdef(t.oid,true) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
    routines: "SELECT p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')",
    sequences: "SELECT * FROM pg_sequences WHERE schemaname='public'",
    views: "SELECT viewname,definition FROM pg_views WHERE schemaname='public'",
    policies: "SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public'",
    schema: "SELECT nspname,nspacl,pg_get_userbyid(nspowner) owner FROM pg_namespace WHERE nspname='public'",
  };
  const catalog: Snapshot = {};
  for (const [name, query] of Object.entries(queries)) catalog[name] = await fingerprint(db, query);
  // Только counts/hashes; определения, дефолт и реальные данные не сохраняются.
  return { columns: value.columns, constraints: value.constraints, indexes: value.indexes, enums: value.enums, catalog, productStatusDefaultSha256: digest(canonical(value.productStatusDefault)) };
}
async function snapshot(db: Sql, tables: string[], scope?: Scope): Promise<Snapshot> {
  const result: Snapshot = {};
  for (const table of tables) {
    const owned = scope && OWNED_TABLES.includes(table as OwnedTable) ? scopeIds(scope, table as OwnedTable) : [];
    result[table] = await fingerprint(db, "SELECT t.* FROM " + tableName(table) + " t" + (owned.length ? " WHERE NOT(t.id=ANY($1::text[]))" : ""), owned.length ? [owned] : []);
  }
  return result;
}
function compareRows(actual: Snapshot, expected: Snapshot) {
  equal(Object.keys(actual).sort(), Object.keys(expected).sort(), "original_baseline_table_keys");
  for (const table of Object.keys(expected)) equal(actual[table], expected[table], "original_full_rows_mismatch", table);
}
async function captureRows(db: Sql, scope: Scope, xid32?: string): Promise<Scope> {
  const result = emptyScope();
  for (const table of OWNED_TABLES) {
    const where = xid32 ? "t.xmin::text=$1" : "t.id=ANY($1::text[])";
    const rows = await db.$queryRawUnsafe<{ id: string; created: string; updated: string | null; revision: number | null; sha256: string }[]>(
      'SELECT t.id,t."createdAt"::text created,to_jsonb(t)->>\'updatedAt\' updated,(to_jsonb(t)->>\'revision\')::integer revision,' + rowHash("t") + " sha256 FROM " + tableName(table) + " t WHERE " + where + " ORDER BY t.id", xid32 ?? scopeIds(scope, table));
    result[table] = rows.map(row => ({ id: row.id, createdAt: utc(row.created), updatedAt: row.updated === null ? null : utc(row.updated), revision: row.revision, sha256: row.sha256 }));
  }
  return result;
}
async function lineage(db: Sql, pre: Pre, scope: Scope, phase?: Phase, projectId?: string | null) {
  const k = pre.keys;
  const productSql = 'SELECT id FROM "Product" WHERE "projectId"=ANY($2::text[]) AND "createdById"=$3';
  const rules: Record<OwnedTable, { where: string; values: unknown[] }> = {
    User: { where: 'id=$2 AND name=$3 AND email=$4 AND "passwordHash"=$5 AND roles=ARRAY[\'MANAGER\']::"Role"[] AND "payScheme"=\'NONE\' AND "payPercent" IS NULL AND "legacyId" IS NULL', values: [k.actorId, actorName(k), "qa111-concurrency-" + k.runId + "@invalid.test", "QA_DISABLED_NOT_A_PASSWORD"] },
    Client: { where: 'id=$2 AND name=$3 AND phone=$4 AND email IS NULL AND "legacyId" IS NULL', values: [k.clientId, clientName(k), "111"] },
    Project: { where: 'id=ANY($2::text[]) AND "clientId"=$3 AND "managerId"=$4 AND title=$5 AND currency=\'BYN\' AND "deletedAt" IS NULL AND "legacyId" IS NULL', values: [k.projectIds, k.clientId, k.actorId, actorName(k)] },
    Product: { where: '"projectId"=ANY($2::text[]) AND "createdById"=$3 AND quantity=1 AND "expectedPrice" IS NULL AND "initialPrice" IS NULL AND "engineerId" IS NULL AND "mounterId" IS NULL AND "assemblerId" IS NULL AND "surveyorId" IS NULL AND "deletedAt" IS NULL AND "legacyId" IS NULL', values: [projectId ? [projectId] : k.projectIds, k.actorId] },
    ProductPercentageConfig: { where: '"productId" IN (' + productSql + ') AND revision=1 AND cardinality("reviewedLegacyWorkIds")=0 AND "workReview" IS NULL', values: [projectId ? [projectId] : k.projectIds, k.actorId] },
    ProductStatusHistory: { where: '"productId" IN (' + productSql + ') AND "changedById"=$3', values: [projectId ? [projectId] : k.projectIds, k.actorId] },
    ProjectStageHistory: { where: '"projectId"=ANY($2::text[]) AND "changedById"=$3 AND "fromStage"=\'LEAD\' AND "toStage"=\'CONTRACT\'', values: [projectId ? [projectId] : k.projectIds, k.actorId] },
    ChangeLog: { where: '"actorType"=\'user\' AND "actorId"=$3 AND source=\'web\' AND ((entity=\'product\' AND "entityId" IN (' + productSql + ')) OR (entity=\'project\' AND "entityId"=ANY($2::text[])))', values: [projectId ? [projectId] : k.projectIds, k.actorId] },
    DomainEvent: { where: 'actor=$3 AND "processedAt" IS NOT NULL AND attempts=0 AND "lastError" IS NULL AND payload->>\'projectId\'=ANY($2::text[]) AND type IN (\'product.statusChanged\',\'project.stageChanged\')', values: [projectId ? [projectId] : k.projectIds, k.actorId] },
  };
  for (const table of OWNED_TABLES) {
    const rows = scope[table];
    if (phase) need(rows.length === (PLANS[phase][table] ?? 0), "transaction_exact_plan_count", table);
    if (!rows.length) continue;
    const rule = rules[table];
    const count = await db.$queryRawUnsafe<{ count: string }[]>("SELECT count(*)::text count FROM " + tableName(table) + " WHERE id=ANY($1::text[]) AND (" + rule.where + ")", scopeIds(scope, table), ...rule.values);
    need(count[0]?.count === String(rows.length), "exact_owned_lineage", table);
    if (phase === "setup" && table === "Project") equal(scopeIds(scope, table).sort(), [...k.projectIds].sort(), "setup_exact_project_ids");
  }
}
async function noLinks(db: Sql, tables: string[], scope: Scope) {
  const fks = await db.$queryRawUnsafe<{ name: string; source_schema: string; source: string; target: OwnedTable; source_columns: string[]; target_columns: string[] }[]>(`
    SELECT c.conname name,sn.nspname source_schema,s.relname source,r.relname target,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.ord) source_columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.ord) target_columns
    FROM pg_constraint c JOIN pg_class s ON s.oid=c.conrelid JOIN pg_namespace sn ON sn.oid=s.relnamespace
    JOIN pg_class r ON r.oid=c.confrelid JOIN pg_namespace rn ON rn.oid=r.relnamespace
    WHERE c.contype='f' AND rn.nspname='public' AND r.relname=ANY($1::text[]) ORDER BY s.relname,c.conname`, [...OWNED_TABLES]);
  for (const fk of fks) {
    need(fk.source_schema === "public" && tables.includes(fk.source) && Array.isArray(fk.source_columns) && Array.isArray(fk.target_columns)
      && fk.source_columns.length > 0 && fk.source_columns.length === fk.target_columns.length
      && [...fk.source_columns, ...fk.target_columns].every(column => typeof column === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(column)), "inbound_fk_shape", fk.source, fk.name);
    const join = fk.source_columns.map((column, index) => "s." + quote(column) + "=t." + quote(fk.target_columns[index])).join(" AND ");
    const allowed = OWNED_TABLES.includes(fk.source as OwnedTable) ? scopeIds(scope, fk.source as OwnedTable) : [];
    const count = await db.$queryRawUnsafe<{ count: string }[]>("SELECT count(*)::text count FROM " + tableName(fk.source) + " s JOIN " + tableName(fk.target) + " t ON " + join + " WHERE t.id=ANY($1::text[])" + (allowed.length ? " AND NOT(s.id=ANY($2::text[]))" : ""), scopeIds(scope, fk.target), ...(allowed.length ? [allowed] : []));
    need(count[0]?.count === "0", "unknown_inbound_fk", fk.source, fk.name);
  }
  const all = OWNED_TABLES.flatMap(table => scopeIds(scope, table));
  need(new Set(all).size === all.length, "owned_ids_cross_table_unique");
  for (const table of tables) {
    const allowed = OWNED_TABLES.includes(table as OwnedTable) ? scopeIds(scope, table as OwnedTable) : [];
    const count = await db.$queryRawUnsafe<{ count: string }[]>("SELECT count(*)::text count FROM " + tableName(table) + " t WHERE " + (allowed.length ? "NOT(t.id=ANY($2::text[])) AND " : "") + "EXISTS(SELECT 1 FROM unnest($1::text[]) owned(id) WHERE strpos(to_jsonb(t)::text,owned.id)>0)", all, ...(allowed.length ? [allowed] : []));
    need(count[0]?.count === "0", "unknown_text_json_reference", table);
  }
}
async function financialZero(db: Sql, scope: Scope, keys: Keys) {
  const rows = await db.$queryRawUnsafe<Record<string, number>[]>(`
    SELECT (SELECT count(*)::int FROM "ProductPercentageParticipant" WHERE "configId"=ANY($1::text[]) OR "userId"=$3) participants,
      (SELECT count(*)::int FROM "ProductPercentageCompletion" WHERE "productId"=ANY($2::text[]) OR "recipientId"=$3) completions,
      (SELECT count(*)::int FROM "PayrollEntry" WHERE "userId"=$3 OR "projectId"=ANY($4::text[]) OR "productId"=ANY($2::text[])) payroll`,
    scopeIds(scope, "ProductPercentageConfig"), scopeIds(scope, "Product"), keys.actorId, keys.projectIds);
  equal(rows, [{ participants: 0, completions: 0, payroll: 0 }], "no_participants_completions_payroll");
}
function checkPreSource(pre: Pre) { equal(sourceHashes(), pre.sources, "sealed_source_hashes"); }
function readPre(file: string, expectedSha256: string) {
  const path = privateFile(file);
  need(basename(path) === "pre.json" && /^task111-native-owned-[a-f0-9-]{36}$/.test(basename(dirname(path))), "pre_exact_path");
  const bytes = readFileSync(path);
  need(/^[a-f0-9]{64}$/.test(expectedSha256) && digest(bytes) === expectedSha256, "pre_content_digest");
  const pre = parsePre(JSON.parse(bytes.toString("utf8")));
  need(basename(dirname(path)) === "task111-native-owned-" + pre.keys.runId, "pre_path_run");
  return { path, pre };
}
function leaseContents() {
  const bytes = readFileSync(privateFile(LEASE));
  const lease = JSON.parse(bytes.toString("utf8")) as { runId: string; pid: number; preFile: string };
  need(uuid(lease.runId) && Number.isSafeInteger(lease.pid) && lease.pid > 0 && lease.preFile === resolve(RESULTS, "task111-native-owned-" + lease.runId, "pre.json"), "lease_identity");
  return lease;
}
function requireNoUnfinishedJournals() {
  for (const name of readdirSync(RESULTS)) {
    if (!/^task111-native-owned-[a-f0-9-]{36}$/.test(name)) continue;
    const folder = privateFile(resolve(RESULTS, name)), file = privateFile(resolve(folder, "pre.json"));
    need(existsSync(file), "incomplete_pre_missing");
    const bytes = readFileSync(file), sha256 = digest(bytes), pre = parsePre(JSON.parse(bytes.toString("utf8")));
    const journal = readJournal(folder, pre, sha256);
    need(journal.parts.some(part => part.kind === "closed" && part.status === "CLEANUP_COMMIT_ACK"), "incomplete_old_scope_no_rerun");
  }
  need(!existsSync(LEASE), "native_run_lease_exists");
}
async function noOldScope(db: Sql, keys: Keys) {
  const rows = await db.$queryRawUnsafe<Record<string, number>[]>('SELECT (SELECT count(*)::int FROM "User" WHERE name LIKE $1 OR email LIKE $2) actors,(SELECT count(*)::int FROM "Project" WHERE title LIKE $1) projects', "QA111 concurrency%", "qa111-concurrency-%@invalid.test");
  equal(rows, [{ actors: 0, projects: 0 }], "incomplete_legacy_scope_no_rerun");
  const all = [keys.actorId, keys.clientId, ...keys.projectIds];
  const tables = await names(db);
  for (const table of tables) {
    const count = await db.$queryRawUnsafe<{ count: string }[]>("SELECT count(*)::text count FROM " + tableName(table) + " t WHERE EXISTS(SELECT 1 FROM unnest($1::text[]) planned(id) WHERE strpos(to_jsonb(t)::text,planned.id)>0)", all);
    need(count[0]?.count === "0", "planned_ids_not_preexisting", table);
  }
}
function processAlive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (error) {
    need((error as NodeJS.ErrnoException).code === "ESRCH", "old_process_liveness_unknown"); return false;
  }
}

export class OwnedNativeRun {
  private reviewedPartsSha256: string | undefined;
  private constructor(readonly preFile: string, readonly preSha256: string, readonly pre: Pre) {}
  get keys() { return this.pre.keys; }
  get folder() { return dirname(this.preFile); }
  get name() { return actorName(this.keys); }
  get clientName() { return clientName(this.keys); }
  private part(kind: Part["kind"], txId: string, fields: Partial<Part> = {}): Part {
    return { kind, runId: this.keys.runId, preSha256: this.preSha256, txId, at: new Date().toISOString(), ...fields };
  }
  journal() {
    checkPreSource(this.pre);
    need(digest(readFileSync(privateFile(this.preFile))) === this.preSha256, "durable_pre_still_pinned");
    return readJournal(this.folder, this.pre, this.preSha256);
  }
  static async begin(db: PrismaClient): Promise<OwnedNativeRun> {
    need(process.platform === "win32" && realpathSync(process.cwd()).toLowerCase() === resolve(APP).toLowerCase()
      && process.env.CRM_LOCAL_CONTAINER_ID === NATIVE_CONTAINER && process.env.CRM_MODERNIZATION_TARGET === "local", "explicit_local_run");
    requireNoUnfinishedJournals();
    const keys: Keys = { runId: randomUUID(), actorId: randomUUID(), clientId: randomUUID(), projectIds: [randomUUID(), randomUUID(), randomUUID()] };
    const folder = privateFile(resolve(RESULTS, "task111-native-owned-" + keys.runId)), file = resolve(folder, "pre.json");
    // Exclusive create — атомарный lease между процессами, без rename-overwrite.
    const leaseBytes = Buffer.from(JSON.stringify({ runId: keys.runId, pid: process.pid, preFile: file }) + "\n", "utf8");
    const leaseFd = openSync(privateFile(LEASE), "wx", 0o600);
    try { writeFileSync(leaseFd, leaseBytes); fsyncSync(leaseFd); } finally { closeSync(leaseFd); }
    mkdirSync(folder);
    const startedAt = new Date().toISOString();
    let preSha256 = "";
    const pre = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await identity(tx); await noOldScope(tx, keys);
      const labels = await tx.$queryRawUnsafe<{ value: string }[]>("SELECT e.enumlabel value FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='ProductStatus'");
      need(labels.some(row => row.value === "DRAFT") && labels.some(row => row.value === "PREPARATION"), "committed_draft_enum_before_fixture");
      const tables = await names(tx);
      const baseline: Pre = {
        kind: "crm111-native-owned-pre", version: 1, keys, startedAt, pid: process.pid,
        target: "local", containerId: NATIVE_CONTAINER, sources: sourceHashes(), tables,
        originalRows: await snapshot(tx, tables), originalSchema: await schema(tx), originalBaselineAvailable: true,
      };
      parsePre(baseline);
      preSha256 = publishJson(file, baseline);
      // Никакая committed fixture не создаётся до возврата durable PRE.
      return baseline;
    }, { maxWait: 15_000, timeout: 120_000, isolationLevel: "RepeatableRead" });
    return new OwnedNativeRun(file, preSha256, pre);
  }
  static inspect(file: string, sha256: string) {
    const loaded = readPre(file, sha256);
    checkPreSource(loaded.pre);
    const run = new OwnedNativeRun(loaded.path, sha256, loaded.pre);
    return { run, journal: run.journal() };
  }
  static resume(file: string, sha256: string, partsSha256: string, acknowledgment: string) {
    need(acknowledgment === "task111-reviewed-native-cleanup", "root_cleanup_review_ack");
    const loaded = OwnedNativeRun.inspect(file, sha256);
    equal(loaded.journal.partsSha256, partsSha256, "reviewed_parts_digest");
    const lease = leaseContents();
    need(lease.runId === loaded.run.keys.runId && lease.pid === loaded.run.pre.pid && lease.preFile === loaded.run.preFile && !processAlive(lease.pid), "old_run_process_must_be_closed");
    loaded.run.reviewedPartsSha256 = partsSha256;
    return loaded.run;
  }
  async transaction<T>(db: PrismaClient, phase: Phase, projectId: string | null, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    this.journal(); // sealed PRE обязателен до первого fixture SQL.
    const txId = randomUUID(), intent = this.part("intent", txId, { phase, projectId });
    writePart(this.folder, intent);
    try {
      const result = await db.$transaction(async tx => {
        await identity(tx);
        const result = await work(tx);
        const [{ xid32 }] = await tx.$queryRawUnsafe<{ xid32: string }[]>("SELECT (txid_current()%4294967296)::text xid32");
        const current = await captureRows(tx, emptyScope(), xid32);
        await lineage(tx, this.pre, current, phase, projectId);
        const prior = this.journal();
        const cumulative = mergeIds(plannedScope(this.keys), ...prior.parts.filter(part => part.kind === "proof").map(part => part.scope!), current);
        await financialZero(tx, cumulative, this.keys);
        await noLinks(tx, this.pre.tables, cumulative);
        compareRows(await snapshot(tx, this.pre.tables, cumulative), this.pre.originalRows);
        equal(await schema(tx), this.pre.originalSchema, "original_schema_before_each_commit");
        const proof = this.part("proof", txId, {
          phase, projectId, xid32, scope: current,
          originalRowsSha256: digest(canonical(this.pre.originalRows)), schemaSha256: digest(canonical(this.pre.originalSchema)),
        });
        parsePart(proof, this.pre, this.preSha256);
        writePart(this.folder, proof); // fsync + atomic publish BEFORE Prisma queues COMMIT.
        this.journal(); // PRE и published proof прочитаны обратно до COMMIT.
        return result;
      }, { maxWait: 15_000, timeout: 120_000 });
      writePart(this.folder, this.part("outcome", txId, { phase, projectId, status: "COMMIT_ACK" }));
      return result;
    } catch (error) {
      // Ошибка COMMIT/driver не доказывает rollback; intent/proof сохраняются.
      try { writePart(this.folder, this.part("outcome", txId, { phase, projectId, status: "ROLLBACK_OR_UNCERTAIN", ...failure(error, "transaction_error") })); } catch { /* Уже durable intent; не заменять исходную ошибку. */ }
      throw error;
    }
  }
  async cleanup(db: PrismaClient) {
    checkPreSource(this.pre);
    const before = this.journal();
    if (this.reviewedPartsSha256 !== undefined) equal(before.partsSha256, this.reviewedPartsSha256, "cleanup_reviewed_parts_still_pinned");
    const lease = leaseContents();
    need(lease.runId === this.keys.runId && lease.pid === this.pre.pid && lease.preFile === this.preFile, "cleanup_exact_lease");
    const all = mergeIds(plannedScope(this.keys), ...before.parts.filter(part => part.kind === "proof").map(part => part.scope!));
    const cleanupId = randomUUID();
    writePart(this.folder, this.part("cleanup-intent", cleanupId));
    const sealedCleanupJournal = this.journal();
    const deleted = await db.$transaction(async tx => {
      await identity(tx);
      const tables = await names(tx); equal(tables, this.pre.tables, "cleanup_53_table_set");
      await tx.$executeRawUnsafe("LOCK TABLE " + tables.map(tableName).join(",") + " IN SHARE ROW EXCLUSIVE MODE");
      equal(this.journal().partsSha256, sealedCleanupJournal.partsSha256, "cleanup_stable_parts");
      equal(await schema(tx), this.pre.originalSchema, "original_schema_before_cleanup");
      const present = await captureRows(tx, all);
      resolveProofs(this.pre, before.parts, present);
      if (this.reviewedPartsSha256 === undefined) {
        const acknowledged = before.parts.filter(part => part.kind === "outcome" && part.status === "COMMIT_ACK");
        need(acknowledged.length === 7 && new Set(acknowledged.map(part => part.phase)).size === 7, "normal_all_seven_receipted_commits");
        const expected: Record<OwnedTable, number> = { User: 1, Client: 1, Project: 3, Product: 4, ProductPercentageConfig: 12, ProductStatusHistory: 5, ProjectStageHistory: 2, ChangeLog: 7, DomainEvent: 3 };
        for (const table of OWNED_TABLES) need(present[table].length === expected[table], "normal_exact_38_current_rows", table);
      }
      await lineage(tx, this.pre, present);
      await financialZero(tx, all, this.keys); await noLinks(tx, tables, all);
      compareRows(await snapshot(tx, tables, all), this.pre.originalRows);
      const counts: Record<string, number> = {};
      for (const table of ["ProductPercentageConfig", "ProductStatusHistory", "Product", "ProjectStageHistory", "DomainEvent", "ChangeLog", "Project", "Client", "User"] as OwnedTable[]) {
        counts[table] = 0;
        for (const row of present[table]) {
          const values: unknown[] = [row.id, row.sha256, row.createdAt];
          let where = 't.id=$1 AND ' + rowHash("t") + '=$2 AND t."createdAt"=$3::timestamp';
          if (row.updatedAt !== null) { values.push(row.updatedAt); where += ' AND t."updatedAt"=$' + values.length + "::timestamp"; }
          if (row.revision !== null) { values.push(row.revision); where += " AND t.revision=$" + values.length + "::integer"; }
          const count = await tx.$executeRawUnsafe("DELETE FROM " + tableName(table) + " t WHERE " + where, ...values);
          need(count === 1, "delete_exact_owned_cas", table); counts[table]++;
        }
      }
      equal(await captureRows(tx, all), emptyScope(), "all_exact_owned_absent");
      await noLinks(tx, tables, all);
      compareRows(await snapshot(tx, tables), this.pre.originalRows);
      equal(await schema(tx), this.pre.originalSchema, "original_schema_after_cleanup");
      checkPreSource(this.pre);
      equal(this.journal().partsSha256, sealedCleanupJournal.partsSha256, "cleanup_parts_still_pinned");
      // Durable confirmation перед COMMIT, без заявления о полученном ACK.
      writePart(this.folder, this.part("cleanup-intent", randomUUID(), {
        originalRowsSha256: digest(canonical(this.pre.originalRows)), schemaSha256: digest(canonical(this.pre.originalSchema)),
      }));
      return counts;
    }, { maxWait: 15_000, timeout: 120_000, isolationLevel: "Serializable" });
    // Если запись closed не удалась после COMMIT, cleanup-only повторяет baseline
    // по immutable PRE; отсутствие всех QA строк допускается только при OLD MATCH.
    writePart(this.folder, this.part("closed", randomUUID(), {
      status: "CLEANUP_COMMIT_ACK", originalRowsSha256: digest(canonical(this.pre.originalRows)), schemaSha256: digest(canonical(this.pre.originalSchema)),
    }));
    const still = leaseContents(); need(still.runId === this.keys.runId && still.pid === this.pre.pid && still.preFile === this.preFile, "release_exact_lease");
    unlinkSync(privateFile(LEASE));
    return { deleted, originalFullBaselineMatched: true, schemaDefaultsMatched: true, commitAcknowledged: true, tables: 53 };
  }
}
