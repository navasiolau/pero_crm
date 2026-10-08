import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { Client } from "pg";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";

/**
 * Узкий recovery только потерянных fixtures одного уже завершённого run №111.
 * prepare: только SELECT в READ ONLY; cleanup: только root после независимого ревью.
 * Старый baseline утрачен: доказательство относится к текущим чужим строкам,
 * а успешная очистка НЕ означает функциональную приёмку или восстановление baseline.
 * Никаких дампов, restic, seeds, DDL, бизнес-actions или повторных QA run.
 * Cwd: apps/web; CRM_MODERNIZATION_TARGET=local; CRM_LOCAL_CONTAINER_ID=CONTAINER.
 * prepare --discovery-sha256 <DISCOVERY_SHA>
 * cleanup --discovery-sha256 <DISCOVERY_SHA> --manifest <private-file>
 *   --manifest-sha256 <prepared-file-SHA> --root-ack task111-reviewed-owned-cleanup
 */
const APP = "C:/Users/admin/.codex/worktrees/crm-task-111/pero_crm_v2/apps/web";
const SOURCE = resolve(APP, "tests/product-draft-owned-recovery.ts");
const DISCOVERY = resolve(APP, "test-results/task111-recovery-discovery-1791485596519.json");
const DISCOVERY_SHA = "9b7fe47045929585dff8c1e2f77ef39dba31b31ac243703a453d0f98c52f171d";
const CONTAINER = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const ACTOR = "57a258d1-cabe-465b-9bd6-adf2b284a0a6";
const CLIENT = "843fbfb5-f288-46d4-85eb-873b172904b9";
const PROJECTS = ["4b2daa16-fd12-401e-a28f-27baf4cb483f", "d7817d90-2d37-4bef-81af-8bcbb76816d3", "f74a25f5-8595-4333-8355-38357d8e0bd6"];
const RUN = {
  startedAt: "2026-10-08T18:43:40.859Z", endedAt: "2026-10-08T18:43:51.532Z",
  callId: "call_4aedc185af5b44ad979a8f836a87fb62", resultId: "a5ab85",
};
const EXPECTED = {
  User: 1, Client: 1, Project: 3, Product: 4, ProductPercentageConfig: 12,
  ProductStatusHistory: 5, ProjectStageHistory: 2, ChangeLog: 7, DomainEvent: 3,
} as const;
type OwnedTable = keyof typeof EXPECTED;
type Fields = Record<string, unknown>;
type Discovery = {
  kind: string; target: string; readOnly: boolean;
  candidates: {
    actor: Fields; projects: Fields[]; products: Fields[]; configs: Fields[];
    linked: Fields; history: Fields[]; audit: Fields[]; events: Fields[];
  }[];
};
type RowProof = { id: string; createdAt: string; updatedAt: string | null; revision: number | null; sha256: string };
type Scope = Record<OwnedTable, RowProof[]>;
type Fingerprint = { count: string; sha256: string };
type Snapshot = Record<string, Fingerprint>;
type Manifest = {
  kind: "crm111-owned-recovery-manifest"; version: 1; target: "local"; preparedAt: string;
  guards: { containerId: string; discoverySha256: string; sourceSha256: string; run: typeof RUN; preRunBaselineAvailable: false };
  tables: string[]; scope: Scope; protectedCurrentRows: Snapshot; schemaAndDefaults: Snapshot;
};
type ForeignKey = {
  constraint_name: string; source_schema: string; source_table: string; source_columns: string[];
  target_schema: string; target_table: string; target_columns: string[];
};

let checkId = "arguments";
let diagnosticTable: string | undefined;
let diagnosticConstraint: string | undefined;
let transactionOpen = false;
let commitAcknowledged = false;

function guard(ok: unknown, id: string, table?: string, constraint?: string): asserts ok {
  checkId = id;
  diagnosticTable = table && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(table) ? table : undefined;
  diagnosticConstraint = constraint && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(constraint) ? constraint : undefined;
  if (!ok) throw new Error("RECOVERY_GUARD_STOP");
}
function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const record = value as Fields;
    return "{" + Object.keys(record).sort().map(key => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}
function same(left: unknown, right: unknown, id: string, table?: string) {
  guard(canonical(left) === canonical(right), id, table);
}
function timestamp(value: unknown): string {
  guard(typeof value === "string", "timestamp-type");
  const iso = value.replace(" ", "T");
  // Prisma timestamp without time zone: JSON PostgreSQL содержит T, но не Z.
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + "Z");
  guard(Number.isFinite(date.getTime()), "timestamp-invalid");
  return date.toISOString();
}
function inRun(value: unknown) {
  const time = timestamp(value);
  guard(time >= RUN.startedAt && time <= RUN.endedAt, "outside-correlated-run");
  return time;
}
function ids(scope: Scope, table: OwnedTable): string[] { return scope[table].map(row => row.id); }
function ident(value: string): string {
  guard(/^[A-Za-z_][A-Za-z0-9_]*$/.test(value), "sql-identifier");
  return '"' + value + '"';
}
function relation(table: string, schema = "public") { return ident(schema) + "." + ident(table); }
const rowHash = (alias: string) => "encode(sha256(convert_to(to_jsonb(" + alias + ")::text,'UTF8')),'hex')";
function privatePath(file: string, pattern: RegExp): string {
  const absolute = resolve(file);
  guard(dirname(absolute).toLowerCase() === resolve(APP, "test-results").toLowerCase() && pattern.test(basename(absolute)), "private-artifact-path");
  let current = absolute;
  while (current.toLowerCase() !== resolve(APP).toLowerCase()) {
    if (existsSync(current)) guard(!lstatSync(current).isSymbolicLink(), "private-artifact-reparse");
    const parent = dirname(current);
    guard(parent !== current, "private-artifact-ancestor");
    current = parent;
  }
  guard(realpathSync(dirname(absolute)).toLowerCase() === resolve(APP, "test-results").toLowerCase(), "private-artifact-realpath");
  execFileSync("git", ["check-ignore", "--quiet", "--", absolute], { cwd: APP, windowsHide: true, stdio: "pipe" });
  return absolute;
}
function writePrivate(file: string, value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
  const fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  return sha256(bytes);
}
function flags() {
  const mode = process.argv[2];
  guard(mode === "prepare" || mode === "cleanup", "mode-required");
  const args = new Map<string, string>();
  for (let index = 3; index < process.argv.length; index += 2) {
    const key = process.argv[index], value = process.argv[index + 1];
    guard(["--discovery-sha256", "--manifest", "--manifest-sha256", "--root-ack"].includes(key) && !args.has(key) && typeof value === "string", "unknown-or-duplicate-argument");
    args.set(key, value);
  }
  guard(args.get("--discovery-sha256") === DISCOVERY_SHA, "discovery-digest-argument");
  if (mode === "prepare") guard(args.size === 1, "prepare-arguments");
  else {
    guard(args.size === 4 && /^[a-f0-9]{64}$/.test(args.get("--manifest-sha256") ?? ""), "cleanup-arguments");
    guard(args.get("--root-ack") === "task111-reviewed-owned-cleanup", "root-review-ack-required");
  }
  return { mode, args };
}
function readDiscovery(): Discovery["candidates"][number] {
  privatePath(DISCOVERY, /^task111-recovery-discovery-1791485596519\.json$/);
  const bytes = readFileSync(DISCOVERY);
  guard(sha256(bytes) === DISCOVERY_SHA, "discovery-digest");
  const discovery = JSON.parse(bytes.toString("utf8")) as Discovery;
  guard(discovery.kind === "crm111-owned-readonly-discovery" && discovery.target === "local" && discovery.readOnly === true && discovery.candidates.length === 1, "discovery-kind");
  const candidate = discovery.candidates[0];
  guard(candidate.actor.id === ACTOR && candidate.actor.disabled === true && candidate.actor.roles === "{MANAGER}", "discovery-actor");
  guard(timestamp(candidate.actor.created) === "2026-10-08T18:43:47.195Z", "actor-run-correlation");
  same(candidate.projects.map(row => row.id), PROJECTS, "discovery-project-ids");
  guard(candidate.projects.every(row => row.client === CLIENT && row.manager === ACTOR && row.stage === "CONTRACT" && row.expected_title === true), "discovery-project-ownership");
  guard(candidate.products.length === 4 && candidate.configs.length === 12 && candidate.history.length === 5 && candidate.audit.length === 7 && candidate.events.length === 3, "discovery-counts");
  same(candidate.linked, { participants: 0, completions: 0, payroll: 0 }, "discovery-financial-links");
  for (const row of [candidate.actor, ...candidate.projects, ...candidate.products, ...candidate.configs, ...candidate.history, ...candidate.audit, ...candidate.events]) {
    guard(typeof row.id === "string" && /^[A-Za-z0-9_:-]{1,128}$/.test(row.id), "owned-id-format");
    inRun(row.created);
    if (row.updated !== undefined) inRun(row.updated);
  }
  return candidate;
}
function initialScope(candidate: Discovery["candidates"][number]): Scope {
  const placeholder = (id: string): RowProof => ({ id, createdAt: "", updatedAt: null, revision: null, sha256: "" });
  return {
    User: [placeholder(ACTOR)], Client: [placeholder(CLIENT)], Project: PROJECTS.map(placeholder),
    Product: candidate.products.map(row => placeholder(String(row.id))),
    ProductPercentageConfig: candidate.configs.map(row => placeholder(String(row.id))),
    ProductStatusHistory: candidate.history.map(row => placeholder(String(row.id))),
    ProjectStageHistory: [], ChangeLog: candidate.audit.map(row => placeholder(String(row.id))),
    DomainEvent: candidate.events.map(row => placeholder(String(row.id))),
  };
}
async function tableNames(db: Client): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>("SELECT tablename name FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const names = rows.map(row => row.name);
  guard(names.length === 53 && names.every(name => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)), "all-53-public-tables");
  guard(Object.keys(EXPECTED).every(name => names.includes(name)), "owned-tables-present");
  return names;
}
async function identity(db: Client, readOnly: boolean) {
  const { rows } = await db.query("SELECT current_database() db,current_schema() schema,current_user role,current_setting('transaction_read_only') ro,pg_is_in_recovery() standby,current_setting('data_directory') data_directory");
  same(rows, [{ db: "pero_crm", schema: "public", role: "pero", ro: readOnly ? "on" : "off", standby: false, data_directory: "/var/lib/postgresql/data" }], "database-identity-primary-data-directory");
}
async function fingerprint(db: Client, query: string, values: unknown[] = []): Promise<Fingerprint> {
  const sql = "SELECT count(*)::text count,encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') sha256 FROM (SELECT " + rowHash("r") + " h FROM (" + query + ") r) hashes";
  const { rows } = await db.query<Fingerprint>(sql, values);
  guard(rows.length === 1 && /^\d+$/.test(rows[0].count) && /^[a-f0-9]{64}$/.test(rows[0].sha256), "fingerprint-shape");
  return rows[0];
}
async function snapshot(db: Client, tables: string[], scope?: Scope): Promise<Snapshot> {
  const result: Snapshot = {};
  for (const table of tables) {
    guard(true, "protected-row-fingerprint", table);
    const owned = scope && table in EXPECTED ? ids(scope, table as OwnedTable) : [];
    result[table] = await fingerprint(db, "SELECT t.* FROM " + relation(table) + " t" + (owned.length ? ' WHERE NOT (t.id=ANY($1::text[]))' : ""), owned.length ? [owned] : []);
  }
  return result;
}
async function schemaSnapshot(db: Client): Promise<Snapshot> {
  const queries: Record<string, string> = {
    columns: "SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_schema,udt_name,character_maximum_length,numeric_precision,numeric_scale,datetime_precision,collation_name,is_identity,identity_generation,is_generated,generation_expression FROM information_schema.columns WHERE table_schema='public'",
    constraints: "SELECT t.relname table_name,c.conname,c.contype,c.condeferrable,c.condeferred,c.convalidated,pg_get_constraintdef(c.oid,true) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'",
    indexes: "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'",
    enums: "SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'",
    relations: "SELECT c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,c.relacl,pg_get_userbyid(c.relowner) owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
    triggers: "SELECT c.relname,t.tgname,t.tgenabled,t.tgisinternal,pg_get_triggerdef(t.oid,true) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
    routines: "SELECT p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')",
    policies: "SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public'",
    sequences: "SELECT * FROM pg_sequences WHERE schemaname='public'",
    views: "SELECT viewname,definition FROM pg_views WHERE schemaname='public'",
    schema: "SELECT nspname,nspacl,pg_get_userbyid(nspowner) owner FROM pg_namespace WHERE nspname='public'",
    productStatusDefault: "SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='Product' AND column_name='status'",
  };
  const result: Snapshot = {};
  for (const [name, query] of Object.entries(queries)) {
    guard(true, "schema-default-fingerprint");
    result[name] = await fingerprint(db, query);
  }
  guard(result.productStatusDefault.count === "1", "product-status-default-present");
  return result;
}
function compareSnapshots(actual: Snapshot, expected: Snapshot, id: string) {
  same(Object.keys(actual).sort(), Object.keys(expected).sort(), id + "-keys");
  for (const table of Object.keys(expected)) same(actual[table], expected[table], id, table);
}
async function exactDiscoveryRows(db: Client, candidate: Discovery["candidates"][number], scope: Scope) {
  const checks: [OwnedTable, string, unknown[], Fields | Fields[]][] = [
    ["User", 'SELECT id,"createdAt"::text created,"updatedAt"::text updated,roles::text roles,("passwordHash"=$2) disabled FROM "User" WHERE id=$1', [ACTOR, "QA_DISABLED_NOT_A_PASSWORD"], candidate.actor],
    ["Project", 'SELECT id,"clientId" client,"managerId" manager,number,"numberInt" n,stage::text stage,"createdAt"::text created,"updatedAt"::text updated,(title=$2) expected_title FROM "Project" WHERE id=ANY($1::text[])', [PROJECTS, "QA111 concurrency"], candidate.projects],
    ["Product", 'SELECT id,"projectId" project,"createdById" creator,number,"suffixInt" suffix,status::text status,"createdAt"::text created,"updatedAt"::text updated,quantity,("expectedPrice" IS NULL) no_price FROM "Product" WHERE id=ANY($1::text[])', [ids(scope, "Product")], candidate.products],
    ["ProductPercentageConfig", 'SELECT id,"productId" product,kind::text kind,revision,"createdAt"::text created FROM "ProductPercentageConfig" WHERE id=ANY($1::text[])', [ids(scope, "ProductPercentageConfig")], candidate.configs],
    ["ProductStatusHistory", 'SELECT id,"productId" product,"fromStatus"::text from_status,"toStatus"::text to_status,"changedById" actor,"createdAt"::text created FROM "ProductStatusHistory" WHERE id=ANY($1::text[])', [ids(scope, "ProductStatusHistory")], candidate.history],
    ["ChangeLog", 'SELECT id,entity,"entityId" target,action,"createdAt"::text created FROM "ChangeLog" WHERE id=ANY($1::text[]) AND "actorType"=$2 AND "actorId"=$3', [ids(scope, "ChangeLog"), "user", ACTOR], candidate.audit],
    ["DomainEvent", 'SELECT id,type,"processedAt" IS NOT NULL processed,"createdAt"::text created FROM "DomainEvent" WHERE id=ANY($1::text[]) AND actor=$2', [ids(scope, "DomainEvent"), ACTOR], candidate.events],
  ];
  for (const [table, sql, values, expected] of checks) {
    guard(true, "discovery-current-cas", table);
    const { rows } = await db.query<Fields>(sql, values);
    const order = (values: Fields[]) => [...values].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    same(order(rows), order(Array.isArray(expected) ? expected : [expected]), "discovery-current-cas", table);
  }
}
async function semanticGuards(db: Client, candidate: Discovery["candidates"][number], scope: Scope) {
  const checks: [OwnedTable, string, unknown[]][] = [
    ["User", 'name=$2 AND email ~ $3 AND active AND roles=ARRAY[\'MANAGER\']::"Role"[] AND "payScheme"=\'NONE\' AND "payPercent" IS NULL AND "sessionVersion"=0 AND "legacyId" IS NULL AND "legacyTable" IS NULL', [ACTOR, "QA111 concurrency", "^qa111-concurrency-[a-f0-9-]{36}@invalid[.]test$"]],
    ["Client", 'name=$2 AND phone=$3 AND "lastName" IS NULL AND "middleName" IS NULL AND email IS NULL AND address IS NULL AND comment IS NULL AND "legacyId" IS NULL AND "legacyTable" IS NULL', [CLIENT, "QA111 concurrency client", "111"]],
    ["Project", '"clientId"=$2 AND "managerId"=$3 AND title=$4 AND stage=\'CONTRACT\' AND currency=\'BYN\' AND "createdById" IS NULL AND "deletedAt" IS NULL AND "deletedById" IS NULL AND "coverFileId" IS NULL AND "initialPrice" IS NULL AND delivery IS NULL AND unloading IS NULL AND installation IS NULL AND "legacyId" IS NULL AND "legacyTable" IS NULL', [PROJECTS, CLIENT, ACTOR, "QA111 concurrency"]],
    ["Product", '"projectId"=ANY($2::text[]) AND "createdById"=$3 AND status=\'PREPARATION\' AND quantity=1 AND "expectedPrice" IS NULL AND "initialPrice" IS NULL AND "initialPriceCaptureEligible" AND "engineerId" IS NULL AND "assemblerId" IS NULL AND "mounterId" IS NULL AND "surveyorId" IS NULL AND "sketchFileId" IS NULL AND "deletedAt" IS NULL AND "deletedById" IS NULL AND "legacyId" IS NULL AND "legacyTable" IS NULL', [ids(scope, "Product"), PROJECTS, ACTOR]],
    ["ProductPercentageConfig", '"productId"=ANY($2::text[]) AND revision=1 AND cardinality("reviewedLegacyWorkIds")=0 AND "workReview" IS NULL', [ids(scope, "ProductPercentageConfig"), ids(scope, "Product")]],
    ["ProductStatusHistory", '"productId"=ANY($2::text[]) AND "changedById"=$3', [ids(scope, "ProductStatusHistory"), ids(scope, "Product"), ACTOR]],
    ["ProjectStageHistory", '"projectId"=ANY($2::text[]) AND "changedById"=$3 AND "fromStage"=\'LEAD\' AND "toStage"=\'CONTRACT\' AND comment IS NULL', [ids(scope, "ProjectStageHistory"), PROJECTS.slice(0, 2), ACTOR]],
    ["ChangeLog", '"actorType"=\'user\' AND "actorId"=$2 AND "actorName"=$3 AND source=\'web\' AND ((entity=\'product\' AND "entityId"=ANY($4::text[])) OR (entity=\'project\' AND "entityId"=ANY($5::text[])))', [ids(scope, "ChangeLog"), ACTOR, "QA111 concurrency", ids(scope, "Product"), PROJECTS.slice(0, 2)]],
    ["DomainEvent", 'actor=$2 AND "processedAt" IS NOT NULL AND attempts=0 AND "lastError" IS NULL', [ids(scope, "DomainEvent"), ACTOR]],
  ];
  for (const [table, predicate, values] of checks) {
    guard(true, "owned-semantic-proof", table);
    const target = table === "User" || table === "Client" ? "id=$1" : "id=ANY($1::text[])";
    const { rows } = await db.query<{ count: string }>("SELECT count(*)::text count FROM " + relation(table) + " WHERE " + target + " AND (" + predicate + ")", values);
    guard(rows[0]?.count === String(EXPECTED[table]), "owned-semantic-proof", table);
  }
  guard(true, "financial-links-must-remain-zero");
  const { rows: financial } = await db.query(`
    SELECT (SELECT count(*)::integer FROM "ProductPercentageParticipant" WHERE "configId"=ANY($1::text[])) participants,
      (SELECT count(*)::integer FROM "ProductPercentageCompletion" WHERE "productId"=ANY($2::text[])) completions,
      (SELECT count(*)::integer FROM "PayrollEntry" WHERE "userId"=$3 OR "projectId"=ANY($4::text[]) OR "productId"=ANY($2::text[])) payroll`,
    [ids(scope, "ProductPercentageConfig"), ids(scope, "Product"), ACTOR, PROJECTS]);
  same(financial, [{ participants: 0, completions: 0, payroll: 0 }], "financial-links-must-remain-zero");
  // По одному полному набору неизменённых configs каждого вида у каждого изделия.
  const { rows: groups } = await db.query('SELECT "productId" product,array_agg(kind::text ORDER BY kind::text) kinds FROM "ProductPercentageConfig" WHERE id=ANY($1::text[]) GROUP BY "productId" ORDER BY "productId"', [ids(scope, "ProductPercentageConfig")]);
  const expectedGroups = candidate.products.map(product => ({ product: product.id, kinds: ["ASSEMBLY", "ENGINEERING", "INSTALLATION"] })).sort((a, b) => String(a.product).localeCompare(String(b.product)));
  same(groups, expectedGroups, "three-config-kinds-per-product");
  const { rows: events } = await db.query<Fields>('SELECT id,payload FROM "DomainEvent" WHERE id=ANY($1::text[])', [ids(scope, "DomainEvent")]);
  for (const row of events) {
    const original = candidate.events.find(event => event.id === row.id);
    guard(original, "event-exact-id");
    const expected = original.type === "product.statusChanged"
      ? { productId: candidate.products[0].id, number: "206.1", from: "DRAFT", to: "PREPARATION", projectId: PROJECTS[0], reason: "project.contract" }
      : { projectId: original.id === candidate.events[1].id ? PROJECTS[0] : PROJECTS[1], number: original.id === candidate.events[1].id ? "206" : "207", from: "LEAD", to: "CONTRACT" };
    same(row.payload, expected, "event-owned-payload", "DomainEvent");
  }
}
async function captureScope(db: Client, scope: Scope): Promise<Scope> {
  const result = {} as Scope;
  for (const table of Object.keys(EXPECTED) as OwnedTable[]) {
    guard(true, "owned-row-cas-capture", table);
    const { rows } = await db.query<{ id: string; created: string; updated: string | null; revision: number | null; sha256: string }>(
      'SELECT t.id,t."createdAt"::text created,to_jsonb(t)->>\'updatedAt\' updated,(to_jsonb(t)->>\'revision\')::integer revision,' + rowHash("t") + " sha256 FROM " + relation(table) + " t WHERE t.id=ANY($1::text[]) ORDER BY t.id", [ids(scope, table)],
    );
    guard(rows.length === EXPECTED[table], "owned-row-count", table);
    result[table] = rows.map(row => {
      guard(/^[a-f0-9]{64}$/.test(row.sha256), "owned-row-sha256", table);
      return { id: row.id, createdAt: inRun(row.created), updatedAt: row.updated === null ? null : inRun(row.updated), revision: row.revision, sha256: row.sha256 };
    });
  }
  return result;
}
async function captureProjectHistoryIds(db: Client, scope: Scope) {
  guard(true, "project-history-readonly-capture", "ProjectStageHistory");
  const { rows } = await db.query<{ id: string; project: string }>('SELECT id,"projectId" project FROM "ProjectStageHistory" WHERE "projectId"=ANY($1::text[]) ORDER BY "projectId",id', [PROJECTS]);
  guard(rows.length === 2 && PROJECTS.slice(0, 2).every(project => rows.filter(row => row.project === project).length === 1), "project-history-exact-two", "ProjectStageHistory");
  scope.ProjectStageHistory = rows.map(row => ({ id: row.id, createdAt: "", updatedAt: null, revision: null, sha256: "" }));
}
async function noUnknownLinks(db: Client, tables: string[], scope: Scope) {
  const targetTables = Object.keys(EXPECTED);
  const { rows: foreignKeys } = await db.query<ForeignKey>(`
    SELECT c.conname constraint_name,sn.nspname source_schema,s.relname source_table,
      rn.nspname target_schema,r.relname target_table,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,ord)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.ord) source_columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,ord)
        JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.ord) target_columns
    FROM pg_constraint c JOIN pg_class s ON s.oid=c.conrelid JOIN pg_namespace sn ON sn.oid=s.relnamespace
    JOIN pg_class r ON r.oid=c.confrelid JOIN pg_namespace rn ON rn.oid=r.relnamespace
    WHERE c.contype='f' AND rn.nspname='public' AND r.relname=ANY($1::text[])
    ORDER BY sn.nspname,s.relname,c.conname`, [targetTables]);
  for (const fk of foreignKeys) {
    guard(fk.source_schema === "public" && tables.includes(fk.source_table)
      && Array.isArray(fk.source_columns) && Array.isArray(fk.target_columns)
      && fk.source_columns.length > 0 && fk.source_columns.length === fk.target_columns.length
      && [...fk.source_columns, ...fk.target_columns].every(column => typeof column === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(column)),
    "inbound-fk-shape", fk.source_table, fk.constraint_name);
    const join = fk.source_columns.map((column, index) => "s." + ident(column) + "=t." + ident(fk.target_columns[index])).join(" AND ");
    const allowed = fk.source_table in EXPECTED ? ids(scope, fk.source_table as OwnedTable) : [];
    const sql = "SELECT count(*)::text count FROM " + relation(fk.source_table) + " s JOIN " + relation(fk.target_table) + " t ON " + join + " WHERE t.id=ANY($1::text[])" + (allowed.length ? " AND NOT(s.id=ANY($2::text[]))" : "");
    const { rows } = await db.query<{ count: string }>(sql, allowed.length ? [ids(scope, fk.target_table as OwnedTable), allowed] : [ids(scope, fk.target_table as OwnedTable)]);
    guard(rows[0]?.count === "0", "unknown-inbound-fk-stop", fk.source_table, fk.constraint_name);
  }
  // Включает UserPreference/NotificationPreference, actor snapshots, ledger projectId,
  // entityId и вложенные JSON. Неизвестные строки не расширяют список удаления.
  const allIds = (Object.keys(EXPECTED) as OwnedTable[]).flatMap(table => ids(scope, table));
  guard(new Set(allIds).size === allIds.length && allIds.every(id => /^[A-Za-z0-9_:-]{1,128}$/.test(id)), "all-owned-ids-unique");
  for (const table of tables) {
    guard(true, "unknown-text-backlinks", table);
    const allowed = table in EXPECTED ? ids(scope, table as OwnedTable) : [];
    const sql = "SELECT count(*)::text count FROM " + relation(table) + " t WHERE " + (allowed.length ? "NOT(t.id=ANY($2::text[])) AND " : "") + "EXISTS(SELECT 1 FROM unnest($1::text[]) owned(id) WHERE strpos(to_jsonb(t)::text,owned.id)>0)";
    const { rows } = await db.query<{ count: string }>(sql, allowed.length ? [allIds, allowed] : [allIds]);
    guard(rows[0]?.count === "0", "unknown-text-backlink-stop", table);
  }
}
function validateManifest(manifest: Manifest, candidate: Discovery["candidates"][number]) {
  guard(manifest.kind === "crm111-owned-recovery-manifest" && manifest.version === 1 && manifest.target === "local", "manifest-kind");
  guard(manifest.guards.containerId === CONTAINER && manifest.guards.discoverySha256 === DISCOVERY_SHA && manifest.guards.preRunBaselineAvailable === false, "manifest-target-guards");
  same(manifest.guards.run, RUN, "manifest-run-correlation");
  guard(manifest.guards.sourceSha256 === sha256(readFileSync(SOURCE)), "manifest-source-digest");
  same(Object.keys(manifest.scope).sort(), Object.keys(EXPECTED).sort(), "manifest-scope-tables");
  const initial = initialScope(candidate);
  for (const table of Object.keys(EXPECTED) as OwnedTable[]) {
    const rows = manifest.scope[table];
    guard(Array.isArray(rows) && rows.length === EXPECTED[table], "manifest-exact-counts", table);
    for (const row of rows) {
      guard(/^[A-Za-z0-9_:-]{1,128}$/.test(row.id) && /^[a-f0-9]{64}$/.test(row.sha256), "manifest-proof-shape", table);
      inRun(row.createdAt);
      if (row.updatedAt !== null) inRun(row.updatedAt);
      guard(row.revision === (table === "ProductPercentageConfig" ? 1 : null), "manifest-config-revision", table);
    }
    if (table !== "ProjectStageHistory") same(ids(manifest.scope, table).sort(), ids(initial, table).sort(), "manifest-pinned-id-set", table);
  }
  guard(new Set((Object.keys(EXPECTED) as OwnedTable[]).flatMap(table => ids(manifest.scope, table))).size === 38, "manifest-id-uniqueness");
}
async function remainingCount(db: Client, scope: Scope) {
  let total = 0;
  for (const table of Object.keys(EXPECTED) as OwnedTable[]) {
    guard(true, "exact-owned-presence", table);
    const { rows } = await db.query<{ count: string }>("SELECT count(*)::text count FROM " + relation(table) + " WHERE id=ANY($1::text[])", [ids(scope, table)]);
    total += Number(rows[0].count);
  }
  return total;
}
async function deleteExactRows(db: Client, scope: Scope) {
  const counts: Record<string, number> = {};
  const order: OwnedTable[] = ["ProductPercentageConfig", "ProductStatusHistory", "Product", "ProjectStageHistory", "DomainEvent", "ChangeLog", "Project", "Client", "User"];
  for (const table of order) {
    counts[table] = 0;
    for (const row of scope[table]) {
      guard(true, "delete-exact-cas", table);
      const values: unknown[] = [row.id, row.sha256, row.createdAt];
      let where = 't.id=$1 AND ' + rowHash("t") + '=$2 AND t."createdAt"=$3::timestamp';
      if (row.updatedAt !== null) { values.push(row.updatedAt); where += ' AND t."updatedAt"=$' + values.length + "::timestamp"; }
      if (row.revision !== null) { values.push(row.revision); where += ' AND t.revision=$' + values.length + "::integer"; }
      const deleted = await db.query("DELETE FROM " + relation(table) + " t WHERE " + where, values);
      guard(deleted.rowCount === 1, "delete-exact-cas-count", table);
      counts[table]++;
    }
    guard(counts[table] === EXPECTED[table], "delete-exact-table-count", table);
  }
  return counts;
}
async function main() {
  const { mode, args } = flags();
  guard(process.platform === "win32" && process.env.CRM_MODERNIZATION_TARGET === "local" && process.env.CRM_LOCAL_CONTAINER_ID === CONTAINER, "explicit-local-target");
  guard(realpathSync(process.cwd()).toLowerCase() === resolve(APP).toLowerCase(), "assigned-worktree-cwd");
  guard(realpathSync(process.argv[1]).toLowerCase() === realpathSync(SOURCE).toLowerCase(), "assigned-source-path");
  const candidate = readDiscovery();
  const sourceSha256 = sha256(readFileSync(SOURCE));
  const scope = initialScope(candidate);
  let manifest: Manifest | undefined;
  let manifestFile: string | undefined;
  if (mode === "cleanup") {
    manifestFile = privatePath(args.get("--manifest")!, /^task111-owned-recovery-manifest-\d+\.json$/);
    const bytes = readFileSync(manifestFile);
    guard(sha256(bytes) === args.get("--manifest-sha256"), "manifest-digest");
    manifest = JSON.parse(bytes.toString("utf8")) as Manifest;
    validateManifest(manifest, candidate);
  }
  guard(true, "local-container-identity");
  const url = existingLocalCrmDatabaseUrl();
  const connection = new URL(url);
  guard(connection.protocol === "postgresql:" && connection.hostname === "127.0.0.1" && connection.port === "5433" && connection.pathname === "/pero_crm" && connection.username === "pero" && connection.search === "", "explicit-connection-local-only");
  const [container] = JSON.parse(execFileSync("docker", ["--context", "desktop-linux", "inspect", "pero_crm_pg"], { encoding: "utf8", windowsHide: true }));
  guard(container.Id === CONTAINER && container.Name === "/pero_crm_pg" && container.State.Running === true, "container-context-identity");
  guard(container.Mounts.some((mount: { Type: string; Name: string; Destination: string }) => mount.Type === "volume" && mount.Name === "pero_crm_v2_pgdata" && mount.Destination === "/var/lib/postgresql/data"), "container-volume-identity");
  const db = new Client({
    connectionString: url, ssl: false, application_name: "crm111-owned-recovery-" + mode,
    options: "-c default_transaction_read_only=" + (mode === "prepare" ? "on" : "off") + " -c timezone=UTC -c datestyle=ISO,YMD -c statement_timeout=30000 -c lock_timeout=10000",
  });
  guard(true, "local-connect");
  await db.connect();
  try {
    const listedTables = await tableNames(db);
    await db.query(mode === "prepare" ? "BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ" : "BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    if (mode === "cleanup") {
      guard(true, "reviewed-cleanup-table-locks");
      await db.query("LOCK TABLE " + listedTables.map(table => relation(table)).join(",") + " IN SHARE ROW EXCLUSIVE MODE");
    }
    await identity(db, mode === "prepare");
    const tables = await tableNames(db);
    same(tables, listedTables, "catalog-stable-under-lock");
    if (mode === "prepare") {
      await captureProjectHistoryIds(db, scope);
      await exactDiscoveryRows(db, candidate, scope);
      await semanticGuards(db, candidate, scope);
      const proven = await captureScope(db, scope);
      await noUnknownLinks(db, tables, proven);
      const currentRows = await snapshot(db, tables, proven);
      const schema = await schemaSnapshot(db);
      const prepared: Manifest = {
        kind: "crm111-owned-recovery-manifest", version: 1, target: "local", preparedAt: new Date().toISOString(),
        guards: { containerId: CONTAINER, discoverySha256: DISCOVERY_SHA, sourceSha256, run: RUN, preRunBaselineAvailable: false },
        tables, scope: proven, protectedCurrentRows: currentRows, schemaAndDefaults: schema,
      };
      validateManifest(prepared, candidate);
      const file = privatePath(resolve(APP, "test-results/task111-owned-recovery-manifest-" + Date.now() + ".json"), /^task111-owned-recovery-manifest-\d+\.json$/);
      const digest = writePrivate(file, prepared);
      await db.query("COMMIT"); transactionOpen = false;
      console.log(JSON.stringify({ kind: prepared.kind, status: "PREPARED_READ_ONLY", privateArtifact: file, sha256: digest, sourceSha256, tables: tables.length, ownedRows: 38, preRunBaselineAvailable: false, functionalAcceptance: false }));
      return;
    }
    guard(manifest && manifestFile, "cleanup-prepared-manifest-required");
    same(tables, manifest.tables, "manifest-table-set");
    compareSnapshots(await schemaSnapshot(db), manifest.schemaAndDefaults, "schema-defaults-before");
    const count = await remainingCount(db, manifest.scope);
    if (count === 0) {
      await noUnknownLinks(db, tables, manifest.scope);
      compareSnapshots(await snapshot(db, tables), manifest.protectedCurrentRows, "already-clean-protected-current-rows");
      await db.query("COMMIT"); transactionOpen = false;
      console.log(JSON.stringify({ kind: "crm111-owned-recovery", status: "ALREADY_CLEAN_VERIFIED", target: "local", cleanupVerified: true, currentForeignRowsPreserved: true, tables: 53, preRunBaselineAvailable: false, functionalAcceptance: false, manifestSha256: args.get("--manifest-sha256") }));
      return;
    }
    guard(count === 38, "partial-owned-scope-stop");
    await captureProjectHistoryIds(db, scope);
    same(ids(scope, "ProjectStageHistory").sort(), ids(manifest.scope, "ProjectStageHistory").sort(), "manifest-project-history-cas");
    await exactDiscoveryRows(db, candidate, manifest.scope);
    await semanticGuards(db, candidate, manifest.scope);
    same(await captureScope(db, manifest.scope), manifest.scope, "all-owned-row-cas");
    await noUnknownLinks(db, tables, manifest.scope);
    compareSnapshots(await snapshot(db, tables, manifest.scope), manifest.protectedCurrentRows, "protected-current-rows-before");
    guard(sha256(readFileSync(SOURCE)) === sourceSha256 && sha256(readFileSync(manifestFile)) === args.get("--manifest-sha256"), "source-and-manifest-still-pinned");
    const deleted = await deleteExactRows(db, manifest.scope);
    guard(await remainingCount(db, manifest.scope) === 0, "all-owned-rows-absent");
    await noUnknownLinks(db, tables, manifest.scope);
    compareSnapshots(await snapshot(db, tables), manifest.protectedCurrentRows, "protected-current-rows-after");
    compareSnapshots(await schemaSnapshot(db), manifest.schemaAndDefaults, "schema-defaults-after");
    guard(sha256(readFileSync(SOURCE)) === sourceSha256 && sha256(readFileSync(manifestFile)) === args.get("--manifest-sha256"), "commit-source-and-manifest-pinned");
    // Durable intent до COMMIT. При неопределённом результате тот же manifest
    // позволяет повторить проверку: частичное наличие всегда означает STOP.
    const receiptFile = privatePath(resolve(APP, "test-results/task111-owned-recovery-receipt-" + Date.now() + ".json"), /^task111-owned-recovery-receipt-\d+\.json$/);
    const receiptSha256 = writePrivate(receiptFile, {
      kind: "crm111-owned-recovery-verified-intent", verifiedAt: new Date().toISOString(),
      manifestSha256: args.get("--manifest-sha256"), sourceSha256, discoverySha256: DISCOVERY_SHA,
      currentForeignRowsPreserved: true, tables: 53, deleted, scopeSha256: sha256(canonical(manifest.scope)),
      protectedRowsSha256: sha256(canonical(manifest.protectedCurrentRows)), schemaDefaultsSha256: sha256(canonical(manifest.schemaAndDefaults)),
      commitAcknowledged: false, preRunBaselineAvailable: false, functionalAcceptance: false,
    });
    await db.query("COMMIT"); transactionOpen = false; commitAcknowledged = true;
    console.log(JSON.stringify({
      kind: "crm111-owned-recovery", status: "CLEANUP_VERIFIED", target: "local",
      cleanupVerified: true, currentForeignRowsPreserved: true, tables: 53, deleted,
      commitAcknowledged: true, preRunBaselineAvailable: false, functionalAcceptance: false,
      manifestSha256: args.get("--manifest-sha256"), privateReceipt: receiptFile, receiptSha256,
    }));
  } catch (error) {
    if (transactionOpen) {
      try { await db.query("ROLLBACK"); transactionOpen = false; } catch { /* Результат транзакции проверит root по исходному manifest. */ }
    }
    throw error;
  } finally { await db.end(); }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/product-draft-owned-recovery.ts")) {
  void main().catch(() => {
    // Не выводить error/message/stack/detail: pg и child_process могут нести PII/credentials.
    console.log(JSON.stringify({ kind: "crm111-owned-recovery", status: "STOP", checkId, table: diagnosticTable, constraint: diagnosticConstraint, commitAcknowledged, preRunBaselineAvailable: false, functionalAcceptance: false }));
    process.exitCode = 1;
  });
}
