/**
 * Чистые guards исторической migration universal-work-shares и существующей local БД.
 * Одноразовые prepare/apply/dump команды завершённого выпуска выведены из эксплуатации.
 * Проверки SQL, контейнера и сохранности остаются в существующем pure companion.
 * Import не подключается к БД и не вызывает Docker.
 */
import { createHash } from "node:crypto";

export const APPROVED = Object.freeze({
  context: "desktop-linux",
  containerId: "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5",
  containerName: "/pero_crm_pg",
  volume: "pero_crm_v2_pgdata",
  host: "127.0.0.1", port: 5433, database: "pero_crm", user: "pero",
  migration: "20260928140000_universal_work_shares",
  sqlSha256: "65058910bdeec05482a9881c4f83a015cd1e86c32e0ffc352278ac3aa378f0a6",
  group: "TaskAllocationGroup",
  taskFields: Object.freeze(["allocationGroupId", "shareUnits", "shareAmount", "splitRevision"]),
  root: "D:\\Projects\\pero_crm_worktrees\\universal-work-shares",
  prismaVersion: "6.19.3",
});

const hash = (value) => createHash("sha256").update(value).digest("hex");
const stable = (value) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, "en"))) : item);
class GuardError extends Error { constructor(code) { super(code); this.code = code; } }
function guard(value, code) { if (!value) throw new GuardError(code); }
function same(left, right, code) { guard(stable(left) === stable(right), code); }

export function assertApprovedSql(buffer) {
  const digest = hash(buffer);
  guard(digest === APPROVED.sqlSha256, "SQL_CHECKSUM_MISMATCH");
  const statements = buffer.toString("utf8").replace(/--[^\r\n]*/g, "").trim();
  guard(/^BEGIN\s*;/i.test(statements) && /COMMIT\s*;$/i.test(statements), "SQL_TRANSACTION_REQUIRED");
  return digest;
}
export function assertDatasourceSchema(text) {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\r\n]*/g, "");
  const blocks = [...source.matchAll(/\bdatasource\s+(\w+)\s*\{([^}]*)\}/g)];
  guard(blocks.length === 1 && blocks[0][1] === "db", "DATASOURCE_SINGLE_DB_REQUIRED");
  const fields = blocks[0][2].trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  guard(fields.length === 2 && fields.includes('provider = "postgresql"') && fields.some((line) => /^url\s*=\s*env\("DATABASE_URL"\)$/.test(line)), "DATASOURCE_LOCAL_ENV_ONLY");
  guard(!/\b(?:directUrl|shadowDatabaseUrl)\b/.test(source), "DATASOURCE_ALTERNATE_URL_FORBIDDEN");
  return true;
}
export function assertContainerIdentity(container) {
  guard(container?.Id === APPROVED.containerId && container.Name === APPROVED.containerName, "CONTAINER_IDENTITY_MISMATCH");
  guard(container.State?.Running === true && container.State.Paused === false && typeof container.State.StartedAt === "string" && Number.isFinite(Date.parse(container.State.StartedAt)), "CONTAINER_NOT_RUNNING");
  const bindings = [{ HostIp: "127.0.0.1", HostPort: "5433" }];
  same(container.HostConfig?.PortBindings?.["5432/tcp"], bindings, "CONTAINER_CONFIG_PORT_MISMATCH");
  same(container.NetworkSettings?.Ports?.["5432/tcp"], bindings, "CONTAINER_LIVE_PORT_MISMATCH");
  const mounts = container.Mounts?.filter((mount) => mount.Destination === "/var/lib/postgresql/data");
  guard(mounts?.length === 1 && mounts[0].Type === "volume" && mounts[0].Name === APPROVED.volume && mounts[0].RW === true && typeof mounts[0].Source === "string", "CONTAINER_VOLUME_MISMATCH");
  const env = Object.fromEntries(container.Config.Env.map((entry) => { const at = entry.indexOf("="); return [entry.slice(0, at), entry.slice(at + 1)]; }));
  guard(env.POSTGRES_DB === APPROVED.database && env.POSTGRES_USER === APPROVED.user && typeof env.POSTGRES_PASSWORD === "string" && env.POSTGRES_PASSWORD.length > 0, "CONTAINER_DATABASE_MISMATCH");
  guard(env.PGDATA === "/var/lib/postgresql/data" || env.PGDATA === "/var/lib/postgresql/data/pgdata", "CONTAINER_PGDATA_MISMATCH");
  guard(!Object.keys(env).some((key) => ["PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGOPTIONS"].includes(key)), "CONTAINER_PG_CONFIG_FORBIDDEN");
  return { id: container.Id, name: container.Name, image: container.Image, startedAt: container.State.StartedAt, restartCount: container.RestartCount, volume: { name: mounts[0].Name, source: mounts[0].Source, destination: mounts[0].Destination }, pgdata: env.PGDATA, database: env.POSTGRES_DB, user: env.POSTGRES_USER, host: APPROVED.host, port: APPROVED.port };
}
export function assertLocalUrl(value, password) {
  let url;
  try { url = new URL(value); } catch { throw new GuardError("LOCAL_DATABASE_URL_INVALID"); }
  guard(url.protocol === "postgresql:" && url.hostname === APPROVED.host && url.port === String(APPROVED.port) && url.pathname === `/${APPROVED.database}` && decodeURIComponent(url.username) === APPROVED.user && decodeURIComponent(url.password) === password && !url.search && !url.hash, "LOCAL_DATABASE_URL_MISMATCH");
  return true;
}
export function assertPendingMigration(manifest, rows) {
  guard(Array.isArray(rows) && rows.every((row) => row.finishedAt || row.rolledBackAt), "MIGRATION_UNFINISHED_OR_FAILED");
  const names = new Set(manifest.map((entry) => entry.name));
  guard(rows.every((row) => names.has(row.name)), "MIGRATION_HISTORY_NOT_IN_SOURCE");
  const applied = new Set(rows.filter((row) => row.finishedAt && !row.rolledBackAt).map((row) => row.name));
  const pending = manifest.filter((entry) => !applied.has(entry.name));
  guard(pending.length === 1 && pending[0].name === APPROVED.migration && pending[0].sha256 === APPROVED.sqlSha256, "MIGRATION_PENDING_NOT_EXACT_APPROVED");
  return APPROVED.migration;
}
export function assertOriginalData(before, after, withGroup = false) {
  const remaining = { ...after };
  if (withGroup) {
    guard(remaining[APPROVED.group]?.count === "0", "DATA_NEW_GROUP_NOT_EMPTY");
    delete remaining[APPROVED.group];
  }
  same(before, remaining, "DATA_COUNTS_OR_HASHES_CHANGED");
  return true;
}
export function assertAddedDefaults(counts) {
  guard(counts?.groupCount === "0" && counts.invalidTasks === "0", "POST_ALLOCATION_DEFAULTS_CHANGED");
  return true;
}

const identifier = (value) => `"${value.replaceAll('"', '""')}"`;
export function rowHashSql(table) {
  const row = table === "Task" ? `(pg_catalog.to_jsonb(t) - ARRAY['allocationGroupId','shareUnits','shareAmount','splitRevision'])` : "pg_catalog.to_jsonb(t)";
  return `SELECT count(*)::text AS count, pg_catalog.md5(COALESCE(pg_catalog.string_agg(r.digest, '' ORDER BY r.digest COLLATE "C"), '')) AS hash FROM (SELECT pg_catalog.md5((${row})::text) AS digest FROM public.${identifier(table)} t) r`;
}
