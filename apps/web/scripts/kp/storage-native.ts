import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { verifyKpStorageNative } from "../../tests/helpers/kp-storage-native";
import { nativeSnapshot, verifiedRollback, type OwnedRowKeys } from "../../tests/helpers/native-acceptance-snapshot";
import { nativeAcceptanceBinding, nativeDatabaseIdentity, type NativeDeclaration } from "../../tests/helpers/native-acceptance-target";

const migrationName = "20261018000100_kp_document_storage";
const approvedMigrationChecksum = "1dd319ff01ca341bac362a576f7ed298e2facff08c54791156a72bf7877560fe";
const proposalTables = [
  "CommercialProposal", "ProposalItem", "ProposalVersion", "ProposalMedia", "ProposalCurrentMedia",
  "ProposalVersionMedia", "ProposalArtifact", "ProposalContract", "ProposalContractSource", "ProposalContractVersion", "ProposalJob",
] as const;

/** Запрещает выход из rollback-транзакции и изменение существующих объектов через SQL миграции. */
function assertAdditiveMigration(sql: string) {
  const normalized = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|\$([A-Za-z_][A-Za-z0-9_]*|)\$[\s\S]*?\$\1\$|'(?:''|[^'])*'/g,
    token => token.startsWith("--") || token.startsWith("/*") ? " " : " __literal__ ");
  const statements = normalized.split(";").map(statement => statement.trim()).filter(Boolean);
  const tables = proposalTables.join("|");
  const permitted = [
    new RegExp(`^CREATE TABLE "(${tables})"\\s*\\(`, "i"),
    /^CREATE TYPE "Proposal[A-Za-z]+" AS ENUM\s*\(/i,
    new RegExp(`^CREATE (?:UNIQUE )?INDEX "[A-Za-z0-9_]+" ON "(${tables})"\\s*\\(`, "i"),
    new RegExp(`^ALTER TABLE "(${tables})"\\s+ADD CONSTRAINT\\s`, "i"),
    /^CREATE FUNCTION kp_[a-z_]+\s*\(/i,
    new RegExp(`^CREATE TRIGGER "[A-Za-z0-9_]+" BEFORE UPDATE ON "(${tables})"\\s`, "i"),
  ];
  assert.ok(statements.length > 0 && statements.every(statement => permitted.some(pattern => pattern.test(statement))), "KP_NATIVE_ADDITIVE_MIGRATION_REQUIRED");
}

const snapshotAdapter = (client: PoolClient) => ({
  async $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T> {
    return (await client.query(query, values)).rows as T;
  },
});

// Adapter выполняет тот же параметризованный SQL; PrismaPromise не требуется вызывающему nativeSnapshot.
const snapshot = (client: PoolClient, owned: OwnedRowKeys = {}) => nativeSnapshot(snapshotAdapter(client) as Parameters<typeof nativeSnapshot>[0], owned);

async function publicCatalog(client: PoolClient) {
  const result = await client.query<{ kind: string; key: string; hash: string }>(`
    SELECT kind, key, md5(definition) AS hash FROM (
      SELECT 'schema' AS kind, n.nspname::text AS key,
        jsonb_build_object('owner', n.nspowner, 'acl', n.nspacl)::text AS definition
      FROM pg_namespace n WHERE n.nspname='public'
      UNION ALL
      SELECT 'relation', c.relname::text,
        jsonb_build_object('kind', c.relkind, 'owner', c.relowner, 'acl', c.relacl,
          'persistence', c.relpersistence, 'replident', c.relreplident, 'rls', c.relrowsecurity,
          'forceRls', c.relforcerowsecurity, 'options', c.reloptions,
          'view', CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid, true) ELSE NULL END,
          'columns', (SELECT jsonb_agg(jsonb_build_object('name', a.attname, 'number', a.attnum,
            'type', format_type(a.atttypid, a.atttypmod), 'nullable', NOT a.attnotnull,
            'identity', a.attidentity, 'generated', a.attgenerated, 'collation', a.attcollation,
            'storage', a.attstorage, 'compression', a.attcompression, 'acl', a.attacl,
            'default', pg_get_expr(d.adbin, d.adrelid)) ORDER BY a.attnum)
            FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
            WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped))::text
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S')
      UNION ALL
      SELECT 'constraint', c.relname::text || '.' || q.conname::text,
        jsonb_build_object('valid', q.convalidated, 'definition', pg_get_constraintdef(q.oid))::text
      FROM pg_constraint q JOIN pg_class c ON c.oid=q.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public'
      UNION ALL
      SELECT 'index', i.relname::text,
        jsonb_build_object('valid', x.indisvalid, 'ready', x.indisready, 'definition', pg_get_indexdef(i.oid),
          'owner', i.relowner, 'options', i.reloptions)::text
      FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=i.relnamespace
      WHERE n.nspname='public'
      UNION ALL
      SELECT 'trigger', c.relname::text || '.' || t.tgname::text,
        jsonb_build_object('enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid))::text
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal
      UNION ALL
      SELECT 'function', p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')',
        jsonb_build_object('owner', p.proowner, 'acl', p.proacl, 'definition', pg_get_functiondef(p.oid))::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')
      UNION ALL
      SELECT 'type', t.typname::text,
        jsonb_build_object('kind', t.typtype, 'owner', t.typowner, 'acl', t.typacl,
          'base', t.typbasetype, 'notNull', t.typnotnull, 'default', t.typdefault,
          'enum', (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid))::text
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'
      UNION ALL
      SELECT 'policy', c.relname::text || '.' || p.polname::text,
        jsonb_build_object('command', p.polcmd, 'permissive', p.polpermissive, 'roles', p.polroles,
          'using', pg_get_expr(p.polqual,p.polrelid), 'check', pg_get_expr(p.polwithcheck,p.polrelid))::text
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      UNION ALL
      SELECT 'rule', c.relname::text || '.' || r.rulename::text, pg_get_ruledef(r.oid)
      FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      UNION ALL
      SELECT 'sequence', sequencename::text, row_to_json(s)::text
      FROM pg_sequences s WHERE schemaname='public'
    ) AS objects ORDER BY kind, key
  `);
  const records = Object.fromEntries(result.rows.map(row => [`${row.kind}:${row.key}`, row.hash]));
  assert.equal(Object.keys(records).length, result.rowCount, "KP_NATIVE_CATALOG_KEYS_UNIQUE");
  return records;
}

async function migrationMode(client: PoolClient, sha256: string) {
  const tables = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename", [[...proposalTables]],
  );
  assert.ok(tables.rowCount === 0 || tables.rowCount === proposalTables.length, "KP_NATIVE_PARTIAL_SCHEMA_HOLD");
  const history = await client.query<{ checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>(
    'SELECT "checksum", "finished_at", "rolled_back_at" FROM public."_prisma_migrations" WHERE "migration_name"=$1', [migrationName],
  );
  assert.ok(!history.rows.some(row => row.finished_at === null && row.rolled_back_at === null), "KP_NATIVE_UNFINISHED_MIGRATION_HOLD");
  const applied = history.rows.filter(row => row.finished_at !== null && row.rolled_back_at === null);
  if (tables.rowCount === 0) {
    assert.equal(applied.length, 0, "KP_NATIVE_MIGRATION_HISTORY_SCHEMA_MISMATCH");
    return "rollback-migration" as const;
  }
  assert.equal(applied.length, 1, "KP_NATIVE_APPLIED_MIGRATION_REQUIRED");
  assert.equal(applied[0].checksum, sha256, "KP_NATIVE_MIGRATION_CHECKSUM_MISMATCH");
  return "existing-migration" as const;
}

type HistoryMismatch = { name: string; databaseChecksum: string; checkoutChecksum: string };
type HistoryOptions = { containerId: string; acceptedDigest?: string; inspectOnly?: boolean };
type CapturedMigration = { checksum: string; compatible: Set<string>; bytes: Buffer };
type MigrationSource = { files: Map<string, CapturedMigration>; schema: Buffer; schemaChecksum: string; lock: Buffer; lockChecksum: string };
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function captureMigrationSource(migrationsRoot: string): Promise<MigrationSource> {
  const directories = (await readdir(migrationsRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.ok(directories.length > 0 && directories.includes(migrationName), "KP_NATIVE_MIGRATION_DIRECTORY_REQUIRED");
  assert.ok(directories.every(name => /^[A-Za-z0-9_-]+$/.test(name)), "KP_NATIVE_MIGRATION_DIRECTORY_NAME_INVALID");
  const files = new Map(await Promise.all(directories.map(async name => {
    const bytes = await readFile(resolve(migrationsRoot, name, "migration.sql"));
    const source = bytes.toString("utf8");
    const lf = source.replace(/\r\n/g, "\n");
    return [name, { checksum: sha256(bytes), compatible: new Set([sha256(bytes), sha256(lf), sha256(lf.replace(/\n/g, "\r\n"))]), bytes }] as const;
  })));
  const [schema, lock] = await Promise.all([
    readFile(resolve(migrationsRoot, "../schema.prisma")), readFile(resolve(migrationsRoot, "migration_lock.toml")),
  ]);
  const datasources = [...schema.toString("utf8").matchAll(/^\s*datasource\s+[A-Za-z_][A-Za-z0-9_]*\s*\{([\s\S]*?)^\s*\}/gm)];
  const withoutComments = (value: string) => value.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "").replace(/\s/g, "");
  assert.ok(datasources.length === 1 && withoutComments(datasources[0][1]) === 'provider="postgresql"url=env("DATABASE_URL")', "KP_NATIVE_PINNED_DATASOURCE_REQUIRED");
  assert.equal(lock.toString("utf8").replace(/#[^\n]*/g, "").replace(/\s/g, ""), 'provider="postgresql"', "KP_NATIVE_POSTGRESQL_LOCK_REQUIRED");
  return { files, schema, schemaChecksum: sha256(schema), lock, lockChecksum: sha256(lock) };
}

/** Bundle содержит только проверенные байты; поздние изменения checkout не участвуют в Prisma deploy. */
export async function pinMigrationBundle(source: MigrationSource, context: { containerId: string; currentMigrationChecksum: string; historyDigest: string }) {
  const workspace = resolve(__dirname, "../../../..");
  const segments = [".playwright-mcp", "kp-180", "migration-bundles"];
  let checked = workspace;
  for (const segment of segments) {
    checked = resolve(checked, segment);
    try { assert.ok(!(await lstat(checked)).isSymbolicLink(), "KP_NATIVE_BUNDLE_REPARSE_REFUSED"); }
    catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
      break;
    }
  }
  const bundleRoot = resolve(workspace, ...segments);
  await mkdir(bundleRoot, { recursive: true });
  const bundlePath = resolve(bundleRoot, randomUUID());
  await mkdir(bundlePath);
  await mkdir(resolve(bundlePath, "migrations"));
  const entries = [
    { path: "schema.prisma", bytes: source.schema, checksum: source.schemaChecksum },
    { path: "migrations/migration_lock.toml", bytes: source.lock, checksum: source.lockChecksum },
    ...[...source.files].map(([name, file]) => ({ path: `migrations/${name}/migration.sql`, bytes: file.bytes, checksum: file.checksum })),
  ].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  assert.equal(source.files.get(migrationName)?.checksum, context.currentMigrationChecksum, "KP_NATIVE_PINNED_CURRENT_CHECKSUM_REQUIRED");
  for (const entry of entries) {
    assert.equal(sha256(entry.bytes), entry.checksum, "KP_NATIVE_CAPTURED_BYTES_CHANGED");
    if (entry.path.endsWith("/migration.sql")) await mkdir(resolve(bundlePath, entry.path, ".."));
    await writeFile(resolve(bundlePath, entry.path), entry.bytes, { flag: "wx" });
    assert.equal(sha256(await readFile(resolve(bundlePath, entry.path))), entry.checksum, "KP_NATIVE_BUNDLE_CHECKSUM_REQUIRED");
  }
  const manifest = {
    target: "local", containerId: context.containerId, currentMigrationName: migrationName,
    currentMigrationChecksum: context.currentMigrationChecksum, historyDigest: context.historyDigest,
    files: entries.map(entry => ({ path: entry.path, sha256: entry.checksum })),
  };
  const executionManifestHash = sha256(JSON.stringify(manifest));
  await writeFile(resolve(bundlePath, "execution-manifest.json"), JSON.stringify({ ...manifest, executionManifestHash }, null, 2) + "\n", { flag: "wx" });
  return { bundlePath, schemaPath: resolve(bundlePath, "schema.prisma"), executionManifestHash };
}

async function completeHistory(client: PoolClient, source: MigrationSource, expectedPending: readonly string[], expectedCurrentChecksum: string, options: HistoryOptions) {
  const { files } = source;
  const directories = [...files.keys()].sort();
  assert.equal(files.get(migrationName)?.checksum, expectedCurrentChecksum, "KP_NATIVE_CURRENT_MIGRATION_CHANGED");
  const history = await client.query<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>(
    'SELECT "migration_name", "checksum", "finished_at", "rolled_back_at" FROM public."_prisma_migrations" ORDER BY "migration_name"',
  );
  assert.ok(history.rows.every(row => row.finished_at !== null && row.rolled_back_at === null), "KP_NATIVE_FAILED_OR_INCOMPLETE_HISTORY_HOLD");
  assert.equal(new Set(history.rows.map(row => row.migration_name)).size, history.rows.length, "KP_NATIVE_DUPLICATE_MIGRATION_HISTORY_HOLD");
  const mismatches: HistoryMismatch[] = [];
  for (const row of history.rows) {
    const file = files.get(row.migration_name);
    assert.ok(file, "KP_NATIVE_APPLIED_MIGRATION_OUTSIDE_CHECKOUT_HOLD");
    assert.match(row.checksum, /^[a-f0-9]{64}$/, "KP_NATIVE_MIGRATION_CHECKSUM_INVALID");
    if (row.migration_name === migrationName) {
      assert.equal(row.checksum, file.checksum, "KP_NATIVE_CURRENT_MIGRATION_CHECKSUM_HOLD");
    } else if (!file.compatible.has(row.checksum)) {
      mismatches.push({ name: row.migration_name, databaseChecksum: row.checksum, checkoutChecksum: file.checksum });
    }
  }
  const applied = new Set(history.rows.map(row => row.migration_name));
  assert.deepEqual(directories.filter(name => !applied.has(name)), [...expectedPending].sort(), "KP_NATIVE_UNAPPROVED_PENDING_MIGRATION_HOLD");
  mismatches.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const manifest = { target: "local", containerId: options.containerId, currentMigrationName: migrationName, currentMigrationChecksum: expectedCurrentChecksum, mismatches };
  const digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  if (options.acceptedDigest !== undefined) {
    assert.equal(options.acceptedDigest, digest, "KP_NATIVE_HISTORY_ACCEPTANCE_DIGEST_MISMATCH");
  } else if (!options.inspectOnly) {
    assert.equal(mismatches.length, 0, "KP_NATIVE_APPLIED_MIGRATION_CHECKSUM_HOLD");
  }
  return { migrationDirectories: directories.length, appliedMigrations: applied.size, historyDigest: digest, mismatches };
}

function historyEvidence(history: Awaited<ReturnType<typeof completeHistory>>, acceptedDigest?: string) {
  return {
    migrationDirectories: history.migrationDirectories, appliedMigrations: history.appliedMigrations,
    acceptedHistoryDigest: acceptedDigest, historyExceptionNames: history.mismatches.map(row => row.name), historyExceptionCount: history.mismatches.length,
  };
}

function assertExistingCatalogUnchanged(before: Record<string, string>, after: Record<string, string>) {
  for (const [key, hash] of Object.entries(before)) {
    assert.equal(after[key], hash, "KP_NATIVE_EXISTING_CATALOG_CHANGED");
  }
}

function assertExistingRowsUnchanged(before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>) {
  for (const [table, rows] of Object.entries(before.snapshot.rows)) {
    assert.deepEqual(after.snapshot.rows[table], rows, "KP_NATIVE_EXISTING_TABLE_ROWS_CHANGED");
  }
  assert.deepEqual(Object.keys(after.snapshot.rows).filter(table => !(table in before.snapshot.rows)).sort(), [...proposalTables].sort(), "KP_NATIVE_EXACT_ADDED_TABLES_REQUIRED");
}

/** Только явный --apply-local; Prisma получает guarded URL через окружение, его вывод остаётся в памяти. */
async function applyLocalMigration(client: PoolClient, declaration: NativeDeclaration, url: string, migrationsRoot: string, checksum: string, historyOptions: HistoryOptions) {
  let transactionOpen = false;
  try {
    assert.equal(checksum, approvedMigrationChecksum, "KP_NATIVE_UNAPPROVED_CURRENT_MIGRATION_CHECKSUM");
    const source = await captureMigrationSource(migrationsRoot);
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const mode = await migrationMode(client, checksum);
    const history = await completeHistory(client, source, mode === "rollback-migration" ? [migrationName] : [], checksum, historyOptions);
    if (mode === "existing-migration") {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return { applied: false, historyComplete: true, ...historyEvidence(history, historyOptions.acceptedDigest) };
    }
    const ownReceipt = { _prisma_migrations: { column: "migration_name", ids: [migrationName] } };
    const before = await snapshot(client, ownReceipt);
    const beforeCatalog = await publicCatalog(client);
    await client.query("ROLLBACK");
    transactionOpen = false;

    const bundle = await pinMigrationBundle(source, { containerId: historyOptions.containerId, currentMigrationChecksum: checksum, historyDigest: history.historyDigest });
    const freshBinding = nativeAcceptanceBinding(declaration);
    assert.ok(freshBinding.url === url, "KP_NATIVE_LOCAL_BINDING_CHANGED");
    const requireFromWeb = createRequire(resolve(__dirname, "../../package.json"));
    const prismaCli = requireFromWeb.resolve("prisma/build/index.js");
    try {
      execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", bundle.schemaPath], {
        cwd: resolve(__dirname, "../.."), env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024,
      });
    } catch {
      throw new Error("KP_NATIVE_LOCAL_MIGRATION_DEPLOY_FAILED");
    }

    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    assert.equal(await migrationMode(client, checksum), "existing-migration", "KP_NATIVE_LOCAL_MIGRATION_NOT_APPLIED");
    const afterHistory = await completeHistory(client, source, [], checksum, historyOptions);
    assert.equal(afterHistory.historyDigest, history.historyDigest, "KP_NATIVE_HISTORY_MANIFEST_CHANGED");
    const after = await snapshot(client, ownReceipt);
    const afterCatalog = await publicCatalog(client);
    assertExistingRowsUnchanged(before, after);
    assertExistingCatalogUnchanged(beforeCatalog, afterCatalog);
    await client.query("ROLLBACK");
    transactionOpen = false;
    return {
      applied: true, historyComplete: true, permanentMigrationPreservationVerified: true,
      executionManifestHash: bundle.executionManifestHash, executionBundlePath: bundle.bundlePath,
      preApplyBaselineDigest: before.digest, preApplyTableCount: Object.keys(before.snapshot.rows).length,
      preApplyCatalogObjectCount: Object.keys(beforeCatalog).length, ...historyEvidence(afterHistory, historyOptions.acceptedDigest),
    };
  } finally {
    if (transactionOpen) await client.query("ROLLBACK");
  }
}

async function main() {
  if (process.argv.slice(2).join(" ") === "--help") {
    process.stdout.write("pnpm --filter @pero/web exec tsx scripts/kp/storage-native.ts --revision=<40-char SHA> --run-id=<UUID> [--inspect-history | --apply-local [--accept-history=<SHA256>]]\nRequires CRM_LOCAL_CONTAINER_ID; only existing guarded local 127.0.0.1:5433/pero_crm. Default: migration and fixtures ROLLBACK.\n--inspect-history: read-only strict preflight and target-bound digest of exact historical checksum mismatches.\n--apply-local: permanently deploy only this approved pending migration through Prisma, verify preservation, then ROLLBACK native fixtures.\n--accept-history: requires explicit owner authorization of the exact inspected digest; old migrations and receipts remain unchanged.\n");
    return;
  }
  const argumentsMap = new Map<string, string>();
  let applyLocal = false;
  let inspectHistory = false;
  for (const argument of process.argv.slice(2)) {
    if (argument === "--apply-local") {
      assert.ok(!applyLocal, "KP_NATIVE_DUPLICATE_APPLY_FLAG");
      applyLocal = true;
      continue;
    }
    if (argument === "--inspect-history") {
      assert.ok(!inspectHistory, "KP_NATIVE_DUPLICATE_INSPECT_FLAG");
      inspectHistory = true;
      continue;
    }
    const match = /^--(revision|run-id|accept-history)=(.+)$/.exec(argument);
    assert.ok(match && !argumentsMap.has(match[1]), "KP_NATIVE_ARGUMENTS_REQUIRED");
    argumentsMap.set(match[1], match[2]);
  }
  const acceptedDigest = argumentsMap.get("accept-history");
  if (acceptedDigest !== undefined) assert.match(acceptedDigest, /^[a-f0-9]{64}$/, "KP_NATIVE_HISTORY_DIGEST_REQUIRED");
  assert.ok(!inspectHistory || (!applyLocal && acceptedDigest === undefined), "KP_NATIVE_INSPECT_IS_READ_ONLY");
  assert.ok(acceptedDigest === undefined || applyLocal, "KP_NATIVE_HISTORY_ACCEPTANCE_REQUIRES_APPLY");
  const declaration: NativeDeclaration = {
    target: "local", scenarioId: "kp-document-storage", revision: argumentsMap.get("revision") ?? "", runId: argumentsMap.get("run-id") ?? "",
  };
  const binding = nativeAcceptanceBinding(declaration);
  const containerId = process.env.CRM_LOCAL_CONTAINER_ID ?? "";
  assert.match(containerId, /^[a-f0-9]{64}$/, "KP_NATIVE_CONTAINER_ID_REQUIRED");
  const migrationsRoot = resolve(__dirname, "../../prisma/migrations");
  const migrationSql = await readFile(resolve(migrationsRoot, migrationName, "migration.sql"), "utf8");
  assertAdditiveMigration(migrationSql);
  const migrationSha256 = createHash("sha256").update(migrationSql).digest("hex");
  const pool = new Pool({ connectionString: binding.url, max: 1, connectionTimeoutMillis: 10000, application_name: "pero-kp-storage-native" });
  let client: PoolClient | undefined;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    const db = client;
    await nativeDatabaseIdentity(snapshotAdapter(db), declaration);
    const identity = await db.query<{ user: string; port: number }>("SELECT current_user AS user,inet_server_port() AS port");
    assert.deepEqual(identity.rows, [{ user: "pero", port: 5432 }], "KP_NATIVE_DATABASE_USER_PORT_MISMATCH");
    if (inspectHistory) {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      transactionOpen = true;
      const mode = await migrationMode(db, migrationSha256);
      const history = await completeHistory(db, await captureMigrationSource(migrationsRoot), mode === "rollback-migration" ? [migrationName] : [], migrationSha256, { containerId, inspectOnly: true });
      await db.query("ROLLBACK");
      transactionOpen = false;
      process.stdout.write(JSON.stringify({
        ok: true, mode: "inspect-history", target: "local", containerId, revision: declaration.revision, runId: declaration.runId,
        migration: migrationName, migrationSha256, writeOperationsPerformed: false,
        pendingMigrations: mode === "rollback-migration" ? [migrationName] : [], ...history,
      }) + "\n");
      return;
    }
    const localMigration = applyLocal ? await applyLocalMigration(db, declaration, binding.url, migrationsRoot, migrationSha256, { containerId, acceptedDigest }) : { applied: false };
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    transactionOpen = true;
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query("SET LOCAL statement_timeout='120s'");
    await db.query("SET LOCAL idle_in_transaction_session_timeout='180s'");
    const before = await snapshot(db);
    const beforeCatalog = await publicCatalog(db);
    const mode = await migrationMode(db, migrationSha256);
    const acceptance = await verifiedRollback(async () => {
      if (mode === "rollback-migration") {
        await db.query(migrationSql);
        const afterMigration = await snapshot(db);
        assertExistingRowsUnchanged(before, afterMigration);
        const afterCatalog = await publicCatalog(db);
        assertExistingCatalogUnchanged(beforeCatalog, afterCatalog);
      }
      return verifyKpStorageNative(db, declaration.runId);
    }, async () => {
      await db.query("ROLLBACK");
      transactionOpen = false;
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      transactionOpen = true;
      const after = await snapshot(db);
      const afterCatalog = await publicCatalog(db);
      await db.query("ROLLBACK");
      transactionOpen = false;
      assert.deepEqual(after, before, "KP_NATIVE_FULL_DATABASE_ROLLBACK_PRESERVATION_REQUIRED");
      assert.deepEqual(afterCatalog, beforeCatalog, "KP_NATIVE_FULL_CATALOG_ROLLBACK_PRESERVATION_REQUIRED");
    });
    process.stdout.write(JSON.stringify({
      ok: true, target: "local", scenarioId: declaration.scenarioId, revision: declaration.revision, runId: declaration.runId,
      mode, migration: migrationName, migrationSha256, baselineDigest: before.digest,
      existingTableCount: Object.keys(before.snapshot.rows).length, existingCatalogObjectCount: Object.keys(beforeCatalog).length,
      fullRollbackVerified: true, additiveMigrationVerified: mode === "rollback-migration", ...localMigration, ...acceptance,
    }) + "\n");
  } finally {
    if (client) {
      try { if (transactionOpen) await client.query("ROLLBACK"); }
      finally { client.release(); }
    }
    await pool.end();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    // PostgreSQL detail/SQL/параметры и URL подключения намеренно не выводятся.
    const message = error instanceof Error && /^[A-Z][A-Z0-9_]{1,150}$/.test(error.message) ? error.message : "KP_NATIVE_ACCEPTANCE_FAILED";
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{1,30}$/.test(error.code) ? error.code : undefined;
    process.stderr.write(JSON.stringify({ ok: false, reason: message, code }) + "\n");
    process.exitCode = 1;
  });
}
