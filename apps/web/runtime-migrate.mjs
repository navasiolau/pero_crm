import { spawnSync } from "node:child_process";
import { constants, fstatSync, openSync, readFileSync, closeSync, statSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIPv4 } from "node:net";

const secretPath = "/run/pero-crm/migrator.env";
function requireGuard(value) { if (!value) throw new Error("CRM migration admission refused"); }
function databaseUrl(value, database) {
  const url = new URL(value);
  const role = decodeURIComponent(url.username);
  requireGuard(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "db" &&
    (!url.port || url.port === "5432") && url.pathname === "/" + database && url.password && !url.hash &&
    (!url.search || url.search === "?schema=public") && /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(role));
  return role;
}
function readOwnerUrl() {
  const directory = statSync("/run/pero-crm");
  requireGuard(directory.isDirectory() && directory.uid === 0 && (directory.mode & 0o777) === 0o700);
  const fd = openSync(secretPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    requireGuard(info.isFile() && info.uid === 0 && info.gid === 0 && info.nlink === 1 && (info.mode & 0o777) === 0o400 && info.size > 0 && info.size <= 4096);
    const line = readFileSync(fd, "utf8").trimEnd();
    requireGuard(/^DATABASE_URL=[!-~]+$/.test(line));
    return line.slice("DATABASE_URL=".length);
  } finally { closeSync(fd); }
}
async function execute() {
  requireGuard(process.getuid() === 0 && process.env.PERO_DB_MIGRATE_ON_START === "1" && process.env.PERO_DB_ENFORCE_RUNTIME === "1");
  const role = process.env.PERO_DB_MIGRATOR_ROLE;
  const database = process.env.PERO_DB_MIGRATION_DATABASE;
  requireGuard(typeof database === "string" && /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(database));
  const ownerUrl = readOwnerUrl();
  requireGuard(databaseUrl(ownerUrl, database) === role && databaseUrl(process.env.DATABASE_URL, database) !== role);
  const addresses = await lookup("db", { all: true, family: 4 });
  requireGuard(addresses.length === 1 && isIPv4(addresses[0].address));
  const ip = addresses[0].address;
  if (process.env.PERO_MIGRATION_EXPECTED_DB_IP) requireGuard(ip === process.env.PERO_MIGRATION_EXPECTED_DB_IP);
  // Пароль мигратора существует только у привилегированного init и его Prisma-процессов.
  const env = { PATH: process.env.PATH, HOME: "/root", DATABASE_URL: ownerUrl };
  const deadline = Date.now() + 60_000;
  const prisma = (args, input) => {
    const remaining = deadline - Date.now();
    requireGuard(remaining > 0);
    const result = spawnSync("prisma", [...args, "--schema", "apps/web/prisma/schema.prisma"], {
      env, input, timeout: remaining, stdio: [input ? "pipe" : "ignore", "ignore", "ignore"],
    });
    requireGuard(result.status === 0 && !result.error);
  };
  prisma(["db", "execute", "--stdin"], `
DO $check$ BEGIN
IF current_database() <> '${database}' OR current_user <> '${role}' OR current_user <> session_user
   OR current_schema() <> 'public' OR pg_is_in_recovery() OR inet_server_addr() IS DISTINCT FROM '${ip}'::inet THEN
  RAISE EXCEPTION 'CRM database identity refused';
END IF;
END $check$;`);
  prisma(["migrate", "deploy"]);
  prisma(["db", "execute", "--stdin"], "SELECT public.pero_refresh_runtime_grants();");
}
execute().then(() => process.stdout.write("CRM migration and grants ready\n"), () => {
  process.stderr.write("CRM migration or grants refused\n");
  process.exitCode = 1;
});
