import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink, rmdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Client } from "pg";
import { localConnection, localStatePath, snapshot, type MobileLocalState } from "./mobile-local";

// Разрешение владельца: один LOCAL QA Project и две Task в существующей local DB.
export const manifestPath = path.resolve("../../.playwright-mcp/mobile-owned-manifest.json");
const extraTables = ["TimeEntry", "Notification", "DomainEvent", "ChangeLog", "PluginRunLog"];
type OwnedTask = { id: string; title: string; userId: string; fileName: string };
type DiskFile = { path: string; sha256: string };
export type FixtureManifest = {
  runId: string; projectId: string; number: string; numberInt: number; title: string;
  clientId: string; managerId: string; tasks: Record<"worker" | "mounter", OwnedTask>;
  state: "prepared" | "created" | "captured" | "cleaned";
  baseline: Record<string, unknown>; beforeExtra: Record<string, unknown>;
  owned: Record<string, string[]>; diskFiles: DiskFile[];
  files: { id: string; taskId: string; fileName: string; storedName: string; hasThumb: boolean }[];
};

async function save(manifest: FixtureManifest) {
  const temporary = `${manifestPath}.tmp`;
  await writeFile(temporary, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await rename(temporary, manifestPath);
}

async function extraSnapshot(db: Client) {
  const values: Record<string, unknown> = {};
  for (const table of extraTables) {
    const { rows: [row] } = await db.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY id), '')) AS hash FROM "${table}" t`);
    values[table] = row;
  }
  return values;
}

export async function readManifest() {
  return JSON.parse(await readFile(manifestPath, "utf8")) as FixtureManifest;
}

async function guardSideEffects(db: Client, manifest: FixtureManifest) {
  const { rows: plugins } = await db.query('SELECT id FROM "Plugin" WHERE enabled=true ORDER BY id');
  assert.deepEqual(plugins.map((row) => row.id), ["file-stages"], "unexpected enabled plugin hooks; STOP");
  const taskIds = Object.values(manifest.tasks).map((task) => task.id);
  const userIds = Object.values(manifest.tasks).map((task) => task.userId);
  const { rows: [timers] } = await db.query(`SELECT count(*)::int AS count FROM "TimeEntry"
    WHERE "userId"=ANY($1::text[]) AND NOT ("taskId"=ANY($2::text[]))
    AND ("stoppedAt" IS NULL OR minutes=0)`, [userIds, taskIds]);
  assert.equal(timers.count, 0, "existing active/zero-minute timer would be touched; STOP");
}

export async function guardFixtureAction(role: "worker" | "mounter") {
  const manifest = await readManifest();
  assert.notEqual(manifest.state, "cleaned");
  const { db } = await localConnection();
  try {
    await guardSideEffects(db, manifest);
    const task = manifest.tasks[role];
    const { rows: [row] } = await db.query('SELECT "projectId", "assigneeId", "workId" FROM "Task" WHERE id=$1', [task.id]);
    assert.deepEqual(row, { projectId: manifest.projectId, assigneeId: task.userId, workId: null });
  } finally { await db.end(); }
  return manifest;
}

export async function captureFixture() {
  const { db } = await localConnection();
  try { return await capture(db, await readManifest()); }
  finally { await db.end(); }
}

export async function fixtureTaskState(role: "worker" | "mounter") {
  const manifest = await readManifest();
  const task = manifest.tasks[role];
  const { db } = await localConnection();
  try {
    const { rows: [row] } = await db.query('SELECT status,"doneAt","workId" FROM "Task" WHERE id=$1 AND "projectId"=$2', [task.id, manifest.projectId]);
    const { rows: time } = await db.query('SELECT id,minutes,"stoppedAt" FROM "TimeEntry" WHERE "taskId"=$1', [task.id]);
    const { rows: [payroll] } = await db.query('SELECT count(*)::int AS count FROM "PayrollEntry" WHERE "taskId"=$1', [task.id]);
    return { task: row, time, payroll: payroll.count };
  } finally { await db.end(); }
}

async function prepare(db: Client) {
  const state = JSON.parse(await readFile(localStatePath, "utf8")) as MobileLocalState;
  assert.ok(state.profiles.worker && state.profiles.mounter && state.profiles.manager);
  const { rows: [client] } = await db.query('SELECT "clientId" FROM "Project" WHERE id=$1', [state.projectPath.slice("/projects/".length)]);
  const runId = randomUUID();
  const taskFor = (role: "worker" | "mounter"): OwnedTask => ({
    id: randomUUID(), title: `LOCAL QA ${runId} ${role}: фото, таймер и завершение`,
    userId: state.profiles[role]!.id, fileName: `LOCAL-QA-${runId}-${role}.png`,
  });
  const manifest: FixtureManifest = {
    runId, projectId: randomUUID(), number: `LOCAL-QA-${runId}`, numberInt: -2_000_000_000,
    title: `LOCAL QA ${runId} — временная мобильная проверка`, clientId: client.clientId,
    managerId: state.profiles.manager.id, tasks: { worker: taskFor("worker"), mounter: taskFor("mounter") },
    state: "prepared", baseline: await snapshot(db), beforeExtra: await extraSnapshot(db), owned: {}, diskFiles: [], files: [],
  };
  assert.deepEqual(manifest.baseline, state.baseline, "original business snapshot drift; STOP");
  await guardSideEffects(db, manifest);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
  await db.query("BEGIN READ WRITE");
  try {
    await db.query(`INSERT INTO "Project" (id,number,"numberInt",title,"clientId","managerId","createdById","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$6,now())`, [manifest.projectId, manifest.number, manifest.numberInt, manifest.title, manifest.clientId, manifest.managerId]);
    for (const task of Object.values(manifest.tasks)) {
      await db.query(`INSERT INTO "Task" (id,"projectId",title,type,status,"assigneeId","workId","requiresPhoto","estimateMinutes","createdById","updatedAt")
        VALUES ($1,$2,$3,'LOCAL QA','NEW',$4,NULL,true,1,$5,now())`, [task.id, manifest.projectId, task.title, task.userId, manifest.managerId]);
    }
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  manifest.state = "created";
  await save(manifest);
  console.log(JSON.stringify({ result: "created-owned-only", runId, projectId: manifest.projectId, taskIds: Object.values(manifest.tasks).map((task) => task.id) }));
}

export async function fixturePng(role: "worker" | "mounter") {
  const manifest = await readManifest();
  return { name: manifest.tasks[role].fileName, mimeType: "image/png",
    buffer: await sharp({ create: { width: 80, height: 80, channels: 3, background: role === "worker" ? "#446688" : "#668844" } }).png().toBuffer() };
}

async function capture(db: Client, manifest: FixtureManifest, persist = true) {
  await guardSideEffects(db, manifest);
  const taskIds = Object.values(manifest.tasks).map((task) => task.id);
  const { rows: files } = await db.query('SELECT id,"taskId","fileName","storedName","hasThumb" FROM "File" WHERE "projectId"=$1', [manifest.projectId]);
  const diskFiles: DiskFile[] = [];
  const uploads = path.resolve("uploads", manifest.projectId);
  for (const file of files) {
    const task = Object.values(manifest.tasks).find((task) => task.id === file.taskId);
    assert.ok(task && file.fileName === task.fileName);
    assert.equal(path.basename(file.storedName), file.storedName);
    const diskPaths = [path.join(uploads, file.storedName), ...(file.hasThumb ? [path.join(uploads, "thumbs", `${file.storedName}.jpg`)] : [])];
    for (const diskPath of diskPaths) diskFiles.push({ path: diskPath, sha256: createHash("sha256").update(await readFile(diskPath)).digest("hex") });
  }
  const ownershipQueries: Record<string, { sql: string; args: unknown[] }> = {
    TimeEntry: { sql: 'SELECT id FROM "TimeEntry" WHERE "taskId"=ANY($1::text[])', args: [taskIds] },
    Notification: { sql: 'SELECT id FROM "Notification" WHERE link=$1', args: [`/projects/${manifest.projectId}`] },
    DomainEvent: { sql: 'SELECT id FROM "DomainEvent" WHERE payload->>\'projectId\'=$1 AND payload->>\'taskId\'=ANY($2::text[])', args: [manifest.projectId, taskIds] },
    ChangeLog: { sql: 'SELECT id FROM "ChangeLog" WHERE "entityId"=ANY($1::text[])', args: [[...taskIds, ...files.map((file) => file.id)]] },
  };
  const owned: Record<string, string[]> = { File: files.map((file) => file.id).sort() };
  for (const [table, query] of Object.entries(ownershipQueries)) owned[table] = (await db.query(query.sql, query.args)).rows.map((row) => row.id).sort();
  assert.deepEqual((await extraSnapshot(db)).PluginRunLog, manifest.beforeExtra.PluginRunLog, "unattributable plugin log changed; STOP");
  manifest.owned = owned;
  manifest.files = files;
  manifest.diskFiles = diskFiles.sort((a, b) => a.path.localeCompare(b.path));
  manifest.state = "captured";
  if (persist) await save(manifest);
  return manifest;
}

async function cleanup(db: Client, manifest: FixtureManifest) {
  assert.equal(manifest.state, "captured", "capture exact owned IDs before cleanup");
  const taskIds = Object.values(manifest.tasks).map((task) => task.id);
  const { rows: [project] } = await db.query('SELECT number,title,"numberInt" FROM "Project" WHERE id=$1', [manifest.projectId]);
  assert.deepEqual(project, { number: manifest.number, title: manifest.title, numberInt: manifest.numberInt });
  for (const table of ["Product", "Work", "Payment", "PayrollEntry", "Communication", "ProjectStageHistory"]) {
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM "${table}" WHERE "projectId"=$1`, [manifest.projectId])).rows[0].count, 0, "unexpected fixture relation; STOP");
  }
  assert.equal((await db.query('SELECT count(*)::int AS count FROM "TaskDependency" WHERE "taskId"=ANY($1::text[]) OR "dependsOnId"=ANY($1::text[])', [taskIds])).rows[0].count, 0);
  const current = await capture(db, structuredClone(manifest), false);
  assert.deepEqual(current.owned, manifest.owned, "new owned IDs appeared; inspect before deleting");
  assert.deepEqual(current.diskFiles, manifest.diskFiles, "owned file contents changed; STOP");
  assert.equal(await realpath(path.resolve("uploads")), path.resolve("uploads"), "uploads redirected outside worktree; STOP");
  for (const file of manifest.diskFiles) {
    assert.ok(file.path.startsWith(path.resolve("uploads", manifest.projectId) + path.sep));
    assert.equal(await realpath(file.path), file.path, "owned file is redirected; STOP");
    assert.equal(createHash("sha256").update(await readFile(file.path)).digest("hex"), file.sha256);
  }
  await db.query("BEGIN READ WRITE");
  try {
    const ownedConditions: Record<string, { sql: string; args: unknown[] }> = {
      Notification: { sql: 'link=$2', args: [`/projects/${manifest.projectId}`] },
      ChangeLog: { sql: '"entityId"=ANY($2::text[])', args: [[...taskIds, ...manifest.owned.File]] },
      DomainEvent: { sql: 'payload->>\'projectId\'=$2 AND payload->>\'taskId\'=ANY($3::text[])', args: [manifest.projectId, taskIds] },
      TimeEntry: { sql: '"taskId"=ANY($2::text[]) AND "userId"=ANY($3::text[])', args: [taskIds, Object.values(manifest.tasks).map((task) => task.userId)] },
      File: { sql: '"projectId"=$2 AND "taskId"=ANY($3::text[])', args: [manifest.projectId, taskIds] },
    };
    for (const table of ["Notification", "ChangeLog", "DomainEvent", "TimeEntry", "File"]) {
      const ids = manifest.owned[table];
      const condition = ownedConditions[table];
      const result = await db.query(`DELETE FROM "${table}" WHERE id=ANY($1::text[]) AND ${condition.sql}`, [ids, ...condition.args]);
      assert.equal(result.rowCount, ids.length);
    }
    const result = await db.query('DELETE FROM "Task" WHERE id=ANY($1::text[]) AND "projectId"=$2 AND "workId" IS NULL', [taskIds, manifest.projectId]);
    assert.equal(result.rowCount, 2);
    assert.equal((await db.query('DELETE FROM "Project" WHERE id=$1 AND number=$2 AND title=$3', [manifest.projectId, manifest.number, manifest.title])).rowCount, 1);
    assert.deepEqual(await snapshot(db), manifest.baseline, "business contents differ after owned cleanup; rollback");
    assert.deepEqual(await extraSnapshot(db), manifest.beforeExtra, "audit/time contents differ after cleanup; rollback");
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  for (const file of manifest.diskFiles) await unlink(file.path);
  const folder = path.resolve("uploads", manifest.projectId);
  for (const directory of [path.join(folder, "thumbs"), folder]) {
    try { assert.equal((await readdir(directory)).length, 0); await rmdir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  manifest.state = "cleaned";
  await save(manifest);
  console.log("PASS exact-ID cleanup; 13 business + 5 time/audit table counts/hashes restored; only owned local files removed");
}

async function main() {
  const mode = process.argv[2];
  assert.ok(["prepare", "capture", "cleanup", "guard"].includes(mode));
  const { db } = await localConnection();
  try {
    if (mode === "prepare") await prepare(db);
    else {
      const manifest = await readManifest();
      if (mode === "capture") {
        await capture(db, manifest);
        console.log(JSON.stringify({ result: "captured", owned: Object.fromEntries(Object.entries(manifest.owned).map(([table, ids]) => [table, ids.length])) }));
      } else if (mode === "cleanup") await cleanup(db, manifest);
      else { await guardSideEffects(db, manifest); console.log("PASS no non-owned active/zero-minute timers; plugin set unchanged"); }
    }
  } finally { await db.end(); }
}

if (process.argv[1]?.endsWith("mobile-owned-fixtures.ts")) {
  main().catch((error) => { console.error(`FAIL owned mobile fixture: ${error?.name ?? "Error"}; STOP and inspect exact manifest`); process.exitCode = 1; });
}
