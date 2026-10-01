/** Existing local DB only: coherent backup, two forward migrations, read-only proof, owned Next runtime. Import is inert. */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { connect } from "node:net";
import { closeSync, createReadStream, existsSync, fsyncSync, lstatSync, mkdtempSync, openSync,
  readFileSync, readdirSync, readSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertContainerIdentity } from "./work-shares-local-migrate.mjs";
import { assertCompatibilityMarkers, assertExactlyPending, assertFileMetadata,
  assertStorageInventory, captureReadonly, check, digest, MIGRATIONS, originalFingerprints,
  tables, TARGET_LOCAL } from "./percentage-readonly-acceptance.mjs";

const SELF = fileURLToPath(import.meta.url), WEB = resolve(dirname(SELF), ".."), ROOT = resolve(WEB, "../..");
const PREFIX = "pero-percentage-readonly-", REQUIRE = createRequire(import.meta.url);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => digest(a) === digest(b);
const quietEnv = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  new Set(["path", "systemroot", "windir", "comspec", "pathext", "userprofile", "homedrive", "homepath",
    "appdata", "localappdata", "temp", "tmp", "processor_architecture", "number_of_processors"]).has(key.toLowerCase()))),
  TZ: "UTC", NO_COLOR: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1", ...extra });
const cmd = (exe, args) => execFileSync(exe, args, { cwd: WEB, encoding: "utf8", windowsHide: true,
  env: quietEnv(), timeout: 20000, stdio: ["ignore", "pipe", "pipe"] }).trim();

function privateDir() {
  const dir = mkdtempSync(join(tmpdir(), PREFIX));
  const sid = cmd("whoami", ["/user", "/fo", "csv", "/nh"]).match(/S-1-\d+(?:-\d+)+/g);
  check(sid?.length === 1, "PRIVATE_OWNER_REQUIRED");
  cmd("icacls", [dir, "/inheritance:r", "/grant:r", `*${sid[0]}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  return dir;
}
function privateState(path) {
  check(typeof path === "string" && isAbsolute(path), "PRIVATE_PATH_REQUIRED");
  const dir = realpathSync(path);
  check(dirname(dir).toLowerCase() === realpathSync(tmpdir()).toLowerCase() &&
    dir.split(/[\\/]/).at(-1).startsWith(PREFIX) && !lstatSync(dir).isSymbolicLink(), "PRIVATE_PATH_FORBIDDEN");
  return dir;
}
function privateFile(path) {
  check(isAbsolute(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() &&
    dirname(dirname(realpathSync(path))).toLowerCase() === realpathSync(tmpdir()).toLowerCase(), "PRIVATE_FILE_FORBIDDEN");
  return JSON.parse(readFileSync(path, "utf8"));
}
function save(dir, name, value) {
  const file = join(dir, name), bytes = Buffer.from(JSON.stringify(value) + "\n"), fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  check(sha(readFileSync(file)) === sha(bytes), "PRIVATE_READBACK_FAILED");
  return file;
}
const load = (dir, name) => privateFile(join(dir, name));
function treeHash(dir) {
  const entries = [];
  function walk(path, prefix) {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      check(!item.isSymbolicLink(), "SOURCE_SYMLINK_FORBIDDEN");
      const child = join(path, item.name), name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) walk(child, name);
      else { check(item.isFile(), "SOURCE_FILE_INVALID"); entries.push([name, sha(readFileSync(child))]); }
    }
  }
  walk(dir, "");
  return digest(entries.sort(([a], [b]) => a.localeCompare(b, "en")));
}
function migrationNames() {
  return readdirSync(join(WEB, "prisma", "migrations"), { withFileTypes: true })
    .filter((item) => item.isDirectory() && /^\d{14}_[a-z0-9_]+$/.test(item.name)).map((item) => item.name).sort();
}
function inspectUploadJunction() {
  const link = resolve(WEB, "uploads"), source = realpathSync(link);
  const entry = lstatSync(link), original = "D:\\Projects\\pero_crm_v2\\apps\\web\\uploads";
  check((entry.isDirectory() || entry.isSymbolicLink()) &&
    source.toLowerCase() === realpathSync(original).toLowerCase() &&
    source.toLowerCase() !== link.toLowerCase() &&
    lstatSync(original).isDirectory() && !lstatSync(original).isSymbolicLink(),
  "READONLY_UPLOAD_JUNCTION_FORBIDDEN");
  return { path: link, realPath: source, linkType: entry.isSymbolicLink() ? "junction" : "reparse-directory" };
}
async function portUnbound(port) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("error", (error) => error.code === "ECONNREFUSED" ? resolve(true) : reject(error));
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error("PORT_PROBE_TIMEOUT")); });
  });
}
function inspectOwnedProcess(runtime) {
  const query = `Get-CimInstance Win32_Process -Filter 'ProcessId = ${runtime.pid}' | Select-Object ProcessId,ExecutablePath,CommandLine,@{Name='CreationEpoch';Expression={([DateTimeOffset]$_.CreationDate).ToUnixTimeSeconds()}} | ConvertTo-Json -Compress`;
  const raw = execFileSync("powershell", ["-NoProfile", "-Command", query], { encoding: "utf8", windowsHide: true,
    timeout: 20000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const found = JSON.parse(raw);
  check(found.ProcessId === runtime.pid && String(found.ExecutablePath).toLowerCase() === process.execPath.toLowerCase() &&
    Math.abs(Number(found.CreationEpoch) - runtime.startEpoch) <= 5 &&
    String(found.CommandLine).toLowerCase().includes(runtime.nextBin.toLowerCase()) &&
    String(found.CommandLine).includes(`-p ${new URL(runtime.origin).port}`), "OWNED_PID_DRIFT");
  return found;
}
export function inspectReadonlySource(approvedHead) {
  check(process.platform === "win32" && realpathSync(ROOT).toLowerCase() ===
    "c:\\users\\admin\\.codex\\worktrees\\product-percentage-pay\\pero_crm_v2" &&
    realpathSync(process.cwd()).toLowerCase() === WEB.toLowerCase() &&
    /^[a-f0-9]{40}$/i.test(approvedHead ?? "") && cmd("git", ["rev-parse", "HEAD"]) === approvedHead,
  "SOURCE_WORKTREE_OR_REVISION_DRIFT");
  for (const key of ["DATABASE_URL", "DIRECT_URL", "SHADOW_DATABASE_URL", "DOCKER_HOST", "NODE_OPTIONS", "NODE_PATH",
    "PGHOST", "PGPORT", "PGPASSWORD", "PGOPTIONS", "PGSERVICE", "DOTENV_CONFIG_PATH", "PRISMA_CONFIG"])
    check(!process.env[key], "AMBIENT_OVERRIDE_FORBIDDEN");
  for (const dir of [ROOT, WEB, join(WEB, "prisma")])
    check(!readdirSync(dir).some((name) => name === ".env" || name.startsWith(".env.") && name !== ".env.example"),
    "AMBIENT_DOTENV_FORBIDDEN");
  check(REQUIRE("prisma/package.json").version === "6.19.3", "PRISMA_VERSION_DRIFT");
  const sql = MIGRATIONS.map((row) => ({ name: row.name,
    sha256: sha(readFileSync(join(WEB, "prisma", "migrations", row.name, "migration.sql"))) }));
  check(sql.every((row, i) => row.sha256 === MIGRATIONS[i].sha256), "MIGRATION_SQL_DRIFT");
  return { head: approvedHead, sql, schemaSha256: sha(readFileSync(join(WEB, "prisma", "schema.prisma"))),
    appSourceSha256: treeHash(join(WEB, "src")), helperSha256: sha(readFileSync(SELF)) };
}
export function inspectReadonlyTarget() {
  const [context] = JSON.parse(cmd("docker", ["context", "inspect", "desktop-linux"]));
  check(context?.Endpoints?.docker?.Host === "npipe:////./pipe/dockerDesktopLinuxEngine", "DOCKER_ENDPOINT_FORBIDDEN");
  const [container] = JSON.parse(cmd("docker", ["--context", "desktop-linux", "inspect", TARGET_LOCAL.containerId]));
  const identity = assertContainerIdentity(container);
  check(identity.id === TARGET_LOCAL.containerId && identity.name === TARGET_LOCAL.name &&
    identity.volume.name === TARGET_LOCAL.volume && identity.host === TARGET_LOCAL.host &&
    identity.port === TARGET_LOCAL.port && identity.database === TARGET_LOCAL.database &&
    identity.user === TARGET_LOCAL.user, "EXISTING_TARGET_DRIFT");
  const password = container.Config.Env.find((item) => item.startsWith("POSTGRES_PASSWORD="))?.slice(18);
  check(password?.length > 0, "DATABASE_SECRET_UNAVAILABLE");
  const url = new URL(`postgresql://${TARGET_LOCAL.host}:${TARGET_LOCAL.port}/${TARGET_LOCAL.database}`);
  url.username = TARGET_LOCAL.user; url.password = password;
  return { identity, url: url.href, password };
}
async function withPrisma(target, action) {
  const { PrismaClient } = REQUIRE("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: target.url, log: [] });
  try { return await action(db); } finally { await db.$disconnect(); }
}
async function fileHash(file) {
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest("hex"), bytes };
}
async function runToFile(exe, args, file, env, inputFile = null, timeout = 180000) {
  const fd = openSync(file, "wx", 0o600), errFile = `${file}.stderr`, errFd = openSync(errFile, "wx", 0o600);
  let settled = false;
  const outcome = await new Promise((done) => {
    const child = spawn(exe, args, { cwd: WEB, windowsHide: true, env,
      stdio: [inputFile ? "pipe" : "ignore", fd, errFd] });
    const complete = (value) => { if (!settled) { settled = true; clearTimeout(timer); done(value); } };
    const timer = setTimeout(() => { child.kill(); complete({ code: null, uncertain: true }); }, timeout);
    child.once("error", () => complete({ code: null, uncertain: true }));
    child.once("close", (code) => complete({ code, uncertain: false }));
    if (inputFile) createReadStream(inputFile).pipe(child.stdin).on("error", () => {});
  });
  closeSync(fd); closeSync(errFd);
  check(!outcome.uncertain && outcome.code === 0, "PROCESS_OUTCOME_UNKNOWN_INSPECT_PRIVATE");
  const errors = await fileHash(errFile);
  check(errors.bytes <= 128 * 1024, "PROCESS_STDERR_TOO_LARGE_INSPECT_PRIVATE");
  return { ...(await fileHash(file)), stderrSha256: errors.sha256, stderrBytes: errors.bytes };
}
function originalSnapshotRows(rows, optional) {
  const snapshot = { targetKind: TARGET_LOCAL.kind, optionalTables: optional, rows };
  return { snapshot, hashes: originalFingerprints(snapshot, "before") };
}
export function assertBackupToc(text, expectedTables) {
  check(typeof text === "string" && text.length > 0 && Array.isArray(expectedTables), "BACKUP_TOC_INVALID");
  const found = [...text.matchAll(/^\s*\d+;\s+\d+\s+\d+\s+TABLE DATA\s+public\s+("[^"]+"|\S+)\s+/gm)]
    .map((match) => match[1].replace(/^"|"$/g, ""));
  const expected = [...expectedTables, "_prisma_migrations"].sort();
  check(found.length === expected.length && new Set(found).size === found.length &&
    same(found.sort(), expected), "BACKUP_TOC_TABLE_DATA_MISMATCH");
  return found.length;
}
async function beforeBackup(target, dir) {
  const { Client } = await import("pg");
  const db = new Client({ connectionString: target.url });
  await db.connect();
  let open = false;
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); open = true;
    const { rows: [identity] } = await db.query("SELECT current_database() AS database,current_user AS username,inet_server_addr()::text AS address,inet_server_port() AS port,current_schema() AS schema");
    check(identity?.database === TARGET_LOCAL.database && identity.username === TARGET_LOCAL.user &&
      identity.schema === "public" && Number(identity.port) === 5432, "DATABASE_IDENTITY_DRIFT");
    const { rows: ledger } = await db.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM public."_prisma_migrations" ORDER BY migration_name');
    assertExactlyPending(migrationNames(), ledger);
    const { rows: found } = await db.query("SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename");
    const optional = found.map((row) => row.name).filter((name) => !tables("before").includes(name));
    check(same(found.map((row) => row.name).sort(), tables("before", optional)), "BEFORE_TABLE_SET_DRIFT");
    const rows = {};
    for (const table of tables("before", optional)) {
      const result = await db.query(`SELECT to_jsonb(t)::text AS raw FROM public."${table}" AS t`);
      rows[table] = result.rows.map((row) => row.raw);
    }
    const { rows: [snapshot] } = await db.query("SELECT pg_export_snapshot() AS token");
    check(snapshot?.token, "SNAPSHOT_EXPORT_FAILED");
    const dump = join(dir, "backup.dump"), toc = join(dir, "backup.toc"), readable = join(dir, "backup.readable.sql");
    const archive = await runToFile("docker", ["--context", "desktop-linux", "exec", "-e", "PGPASSWORD",
      TARGET_LOCAL.containerId, "pg_dump", "-h", "127.0.0.1", "-U", TARGET_LOCAL.user, "-d", TARGET_LOCAL.database,
      "-Fc", `--snapshot=${snapshot.token}`], dump, quietEnv({ PGPASSWORD: target.password }));
    const header = Buffer.alloc(5), handle = openSync(dump, "r");
    try { readSync(handle, header, 0, 5, 0); } finally { closeSync(handle); }
    check(header.toString() === "PGDMP", "BACKUP_ARCHIVE_INVALID");
    const list = await runToFile("docker", ["--context", "desktop-linux", "exec", "-i", TARGET_LOCAL.containerId,
      "pg_restore", "--list"], toc, quietEnv(), dump);
    const tocEntries = assertBackupToc(readFileSync(toc, "utf8"), tables("before", optional));
    const fullRead = await runToFile("docker", ["--context", "desktop-linux", "exec", "-i", TARGET_LOCAL.containerId,
      "pg_restore", "--file=-"], readable, quietEnv(), dump);
    check(list.bytes > 0 && fullRead.bytes > 0 && tocEntries === tables("before", optional).length + 1,
      "BACKUP_READBACK_EMPTY");
    await db.query("COMMIT"); open = false;
    const raw = originalSnapshotRows(rows, optional);
    return { identity, ledger, optionalTables: optional, oldFingerprints: raw.hashes,
      baselineSnapshot: raw.snapshot,
      backup: { verified: true, targetIdentity: target.identity, archiveSha256: archive.sha256,
        tocSha256: list.sha256, fullReadSha256: fullRead.sha256, sha256: digest({ archive, list, fullRead }) } };
  } finally { if (open) await db.query("ROLLBACK").catch(() => {}); await db.end().catch(() => {}); }
}

export function parseReadonlyArgs(args) {
  const arity = { "dry-run": 0, "seal-candidate": 2, before: 1, apply: 1, after: 2, start: 2, probe: 1,
    stop: 2, "browser-preflight": 2 };
  const [operation = "dry-run", ...paths] = args;
  check(Object.hasOwn(arity, operation) && paths.length === arity[operation], "READONLY_USAGE_INVALID");
  return { operation, paths };
}

export async function runReadonlyLocal(args = []) {
  const { operation, paths } = parseReadonlyArgs(args);
  if (operation === "dry-run") return { status: "DRY_RUN", openedConnection: false,
    commands: ["seal-candidate <approved-head> <private-storage-before>",
      "before <reviewed-source-seal>", "apply <private-dir>", "after <private-dir> <storage-inventory-after>",
      "start <private-dir> <3106|3110>", "probe <private-dir>",
      "browser-preflight <private-dir> <existing-actor-ids>", "stop <private-dir> <storage-inventory-after-navigation>"] };
  if (operation === "seal-candidate") {
    const source = inspectReadonlySource(paths[0]), target = inspectReadonlyTarget();
    const inventory = privateFile(paths[1]); assertStorageInventory(inventory.items, inventory.items);
    return { status: "SOURCE_SEAL_CANDIDATE_REVIEW_ONLY", approvedHead: source.head,
      source, targetIdentity: target.identity, storageInventoryPath: realpathSync(paths[1]) };
  }
  if (operation === "before") {
    const seal = privateFile(paths[0]), source = inspectReadonlySource(seal.approvedHead), target = inspectReadonlyTarget();
    check(same(source, seal.source) && same(target.identity, seal.targetIdentity), "BEFORE_SOURCE_TARGET_DRIFT");
    const dir = privateDir();
    save(dir, "before-intent.json", { source, target: target.identity, at: new Date().toISOString() });
    const receipt = await beforeBackup(target, dir);
    const storageBefore = privateFile(seal.storageInventoryPath).items;
    assertStorageInventory(storageBefore, storageBefore);
    save(dir, "before.json", { source, targetIdentity: target.identity, receipt,
      storageBefore, storageHash: digest(storageBefore) });
    return { status: "BACKUP_VERIFIED_TWO_MIGRATIONS_PENDING", directory: dir,
      archiveSha256: receipt.backup.archiveSha256, beforeHash: digest(receipt.oldFingerprints) };
  }
  const dir = privateState(paths[0]), before = load(dir, "before.json");
  const source = inspectReadonlySource(before.source.head), target = inspectReadonlyTarget();
  check(same(source, before.source) && same(target.identity, before.targetIdentity), "SOURCE_OR_TARGET_DRIFT");
  if (operation === "apply") {
    check(!existsSync(join(dir, "apply-intent.json")), "DDL_ALREADY_ATTEMPTED_INSPECT_OUTCOME");
    const current = await withPrisma(target, (db) => captureReadonly(db, TARGET_LOCAL, "before", before.receipt.optionalTables, migrationNames()));
    check(same(current.identity, before.receipt.identity) &&
      same(current.oldFingerprints, before.receipt.oldFingerprints), "BUSINESS_CHANGED_SINCE_BACKUP");
    save(dir, "apply-intent.json", { sourceHash: digest(source), targetIdentity: target.identity,
      backupSha256: before.receipt.backup.sha256, at: new Date().toISOString() });
    const output = await runToFile(process.execPath, [REQUIRE.resolve("prisma/build/index.js"), "migrate", "deploy",
      "--schema", "prisma/schema.prisma"], join(dir, "migrate.stdout"), quietEnv({ DATABASE_URL: target.url }));
    save(dir, "apply-returned.json", { outputSha256: output.sha256, at: new Date().toISOString() });
    return { status: "DDL_RETURNED_VERIFY_READONLY", directory: dir };
  }
  if (operation === "after") {
    check(existsSync(join(dir, "apply-intent.json")) && !existsSync(join(dir, "after.json")), "AFTER_ORDER_INVALID");
    const after = await withPrisma(target, (db) => captureReadonly(db, TARGET_LOCAL, "after", before.receipt.optionalTables));
    check(same(after.identity, before.receipt.identity) &&
      same(after.oldFingerprints, before.receipt.oldFingerprints), "OLD_BUSINESS_ROWS_CHANGED");
    const markers = assertCompatibilityMarkers(before.receipt.baselineSnapshot, after.snapshot);
    const fileHashValue = assertFileMetadata(before.receipt.baselineSnapshot, after.snapshot);
    const storageAfter = privateFile(paths[1]).items;
    const storageHash = assertStorageInventory(before.storageBefore, storageAfter);
    const saved = { schemaHash: after.schemaHash, fullFingerprints: after.fullFingerprints,
      oldFingerprints: after.oldFingerprints, markers, fileMetadataSha256: fileHashValue,
      storageMetadataSha256: storageHash, identity: after.identity, targetIdentity: target.identity,
      migrationSha256: MIGRATIONS.map((row) => row.sha256), backupSha256: before.receipt.backup.sha256 };
    save(dir, "after.json", saved);
    return { status: "MIGRATIONS_AND_OLD_DATA_ACCEPTED", directory: dir,
      schemaHash: saved.schemaHash, compatibilityMarkers: markers.count };
  }
  if (operation === "start") {
    const after = load(dir, "after.json"), port = Number(paths[1]);
    check([3106, 3110].includes(port) && !existsSync(join(dir, "runtime.json")) && await portUnbound(port) &&
      same(after.targetIdentity, target.identity), "RUNTIME_SOURCE_FORBIDDEN");
    const buildId = readFileSync(join(WEB, ".next", "BUILD_ID"), "utf8").trim();
    const manifestSha256 = sha(readFileSync(join(WEB, ".next", "server", "server-reference-manifest.json")));
    const nextBin = REQUIRE.resolve("next/dist/bin/next");
    const uploads = inspectUploadJunction();
    const stdout = openSync(join(dir, "next.stdout"), "wx", 0o600), stderr = openSync(join(dir, "next.stderr"), "wx", 0o600);
    const origin = `http://127.0.0.1:${port}`;
    const secret = randomBytes(32).toString("base64url");
    save(dir, "secret.json", { authSecret: secret, origin });
    const startEpoch = Math.floor(Date.now() / 1000);
    const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: WEB, windowsHide: true, detached: true, stdio: ["ignore", stdout, stderr],
      env: quietEnv({ DATABASE_URL: target.url, AUTH_SECRET: secret,
        AUTH_URL: origin, PORT: String(port) }),
    });
    closeSync(stdout); closeSync(stderr);
    check(Number.isSafeInteger(child.pid) && child.pid > 0, "RUNTIME_START_UNKNOWN");
    const runtime = { origin, pid: child.pid, noS3: true, uploadRoot: uploads.path,
      uploadsRealPath: uploads.realPath, uploadsLinkType: uploads.linkType,
      appSourceSha256: source.appSourceSha256, buildId, manifestSha256, startedAt: new Date().toISOString(),
      startEpoch, nextBin };
    save(dir, "runtime.json", runtime);
    return { status: "OWNED_NEXT_STARTED_VERIFY_HEALTH", directory: dir, pid: child.pid, origin };
  }
  if (operation === "probe") {
    const runtime = load(dir, "runtime.json"), after = load(dir, "after.json");
    check(!existsSync(join(dir, "runtime-ready.json")) && runtime.appSourceSha256 === source.appSourceSha256 &&
      sha(readFileSync(join(WEB, ".next", "server", "server-reference-manifest.json"))) === runtime.manifestSha256 &&
      same(inspectUploadJunction(), { path: runtime.uploadRoot, realPath: runtime.uploadsRealPath,
        linkType: runtime.uploadsLinkType }),
    "RUNTIME_BUILD_DRIFT");
    inspectOwnedProcess(runtime);
    const response = await fetch(`${runtime.origin}/api/health`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    const health = await response.json();
    check(response.status === 200 && health.status === "ok" && health.database === "ok" &&
      health.service === "pero-crm", "RUNTIME_HEALTH_NOT_READY");
    const observed = await withPrisma(target, (db) => captureReadonly(db, TARGET_LOCAL, "after", before.receipt.optionalTables));
    check(same(observed.fullFingerprints, after.fullFingerprints) && same(observed.identity, after.identity),
      "STARTUP_CHANGED_BUSINESS_DATA");
    save(dir, "runtime-ready.json", { ...runtime, healthAt: health.checkedAt,
      businessFingerprintSha256: digest(observed.fullFingerprints) });
    return { status: "OWNED_NEXT_READY_NO_BUSINESS_DRIFT", pid: runtime.pid, origin: runtime.origin };
  }
  if (operation === "browser-preflight") {
    check(existsSync(join(dir, "runtime-ready.json")), "RUNTIME_NOT_PROVEN_READY");
    const actors = privateFile(paths[1]);
    check(Array.isArray(actors.ids) && actors.ids.length > 0 && new Set(actors.ids).size === actors.ids.length &&
      actors.ids.every((id) => typeof id === "string"), "EXISTING_ACTOR_IDS_INVALID");
    const checked = await withPrisma(target, (db) => db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const identity = await tx.$queryRawUnsafe("SELECT current_database() AS database,current_user AS username");
      check(identity[0]?.database === TARGET_LOCAL.database && identity[0].username === TARGET_LOCAL.user,
        "DATABASE_IDENTITY_DRIFT");
      const people = await tx.user.findMany({ where: { id: { in: actors.ids }, active: true },
        select: { id: true, roles: true, sessionVersion: true } });
      const timers = await tx.timeEntry.findMany({ where: { userId: { in: actors.ids }, stoppedAt: null }, select: { id: true } });
      check(people.length === actors.ids.length && timers.length === 0, "ACTOR_INACTIVE_OR_TIMER_RUNNING");
      return people;
    }));
    return { status: "EXISTING_ACTORS_NAVIGATION_READONLY", actorCount: checked.length,
      actorDigest: digest(checked) };
  }
  if (operation === "stop") {
    const runtime = load(dir, "runtime.json");
    check(!existsSync(join(dir, "runtime-stopped.json")) && [3106, 3110].includes(Number(new URL(runtime.origin).port)),
      "OWNED_PID_STOP_FORBIDDEN");
    inspectOwnedProcess(runtime);
    execFileSync("taskkill", ["/PID", String(runtime.pid), "/T", "/F"], { windowsHide: true,
      timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });
    check(same(inspectUploadJunction(), { path: runtime.uploadRoot, realPath: runtime.uploadsRealPath,
      linkType: runtime.uploadsLinkType }), "READONLY_UPLOAD_JUNCTION_DRIFT");
    const after = load(dir, "after.json");
    const observed = await withPrisma(target, (db) => captureReadonly(db, TARGET_LOCAL, "after", before.receipt.optionalTables));
    const storageAfter = privateFile(paths[1]).items;
    check(same(observed.fullFingerprints, after.fullFingerprints) &&
      assertStorageInventory(before.storageBefore, storageAfter), "BROWSER_READONLY_DRIFT");
    save(dir, "runtime-stopped.json", { pid: runtime.pid, at: new Date().toISOString() });
    return { status: "OWNED_NEXT_STOPPED", pid: runtime.pid };
  }
  throw new Error("READONLY_OPERATION_INVALID");
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  runReadonlyLocal(process.argv.slice(2)).then((result) => process.stdout.write(JSON.stringify(result) + "\n"))
    .catch((error) => { process.stderr.write(`STOP:${error.code ?? error.message}\n`); process.exitCode = 1; });
}
