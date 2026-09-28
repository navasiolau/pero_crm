/** Read-only inventory for planning bounded QA fixtures; never production. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

let database;
let username;
let datasourceUrl;
let target;
try {
  if (process.env.CRM_LOCAL_CONTAINER_ID) {
    const expected = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
    assert.equal(process.env.CRM_LOCAL_CONTAINER_ID, expected);
    const [container] = JSON.parse(execFileSync("docker", ["--context", "desktop-linux", "inspect", "pero_crm_pg"], { encoding: "utf8", windowsHide: true }));
    assert.equal(container.Id, expected);
    assert.equal(container.State.Running, true);
    assert.deepEqual(container.HostConfig.PortBindings["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: "5433" }]);
    assert.ok(container.Mounts.some((mount) => mount.Type === "volume" && mount.Name === "pero_crm_v2_pgdata"));
    const env = Object.fromEntries(container.Config.Env.map((row) => { const at = row.indexOf("="); return [row.slice(0, at), row.slice(at + 1)]; }));
    assert.equal(env.POSTGRES_DB, "pero_crm");
    assert.equal(env.POSTGRES_USER, "pero");
    assert.ok(env.POSTGRES_PASSWORD);
    const url = new URL("postgresql://127.0.0.1:5433/pero_crm");
    url.username = "pero";
    url.password = env.POSTGRES_PASSWORD;
    datasourceUrl = url.href;
    database = "pero_crm"; username = "pero"; target = "EXISTING_LOCAL";
  } else {
    // Root's external wrapper must also prove exact staging Docker/DB identity.
    assert.equal(process.env.S3_BUCKET, "pero-crm-staging");
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "db");
    assert.equal(url.pathname, "/crm");
    assert.ok(!url.port || url.port === "5432");
    assert.ok([...url.searchParams.keys()].every((key) => ["schema", "connection_limit", "pool_timeout", "connect_timeout", "socket_timeout", "sslmode"].includes(key)));
    datasourceUrl = url.href;
    database = "crm"; username = "crm"; target = "EXISTING_STAGING";
  }
  const db = new PrismaClient({ datasourceUrl, log: [] });
  try {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const [identity] = await tx.$queryRawUnsafe("SELECT current_database() AS database, current_user AS username, current_setting('transaction_read_only') AS readonly");
      assert.deepEqual(identity, { database, username, readonly: "on" });
      const users = await tx.user.findMany({ where: { active: true }, select: { id: true, roles: true, payScheme: true } });
      const profiles = [];
      for (const role of ["WORKER", "MOUNTER"]) {
        const eligible = users.filter((user) => user.roles.length === 1 && user.roles[0] === role && user.payScheme === "PIECE");
        const timerFree = [];
        for (const user of eligible) {
          if (await tx.timeEntry.count({ where: { userId: user.id, OR: [{ stoppedAt: null }, { minutes: 0 }] } }) === 0) timerFree.push(user.id);
        }
        profiles.push({ role, eligiblePieceEmployees: eligible.length, safeWithoutExistingTimerOrZeroTime: timerFree.length });
      }
      const [lastMigration] = await tx.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1');
      const [allocationSchema] = await tx.$queryRawUnsafe('SELECT to_regclass(\'public."TaskAllocationGroup"\')::text AS table_name');
      const currency = await tx.orgSetting.findUnique({ where: { key: "payrollCurrency" }, select: { value: true } });
      return { status: "PASS", target, readonly: true, profiles,
        clients: await tx.client.count(), activePriceItems: await tx.priceItem.count({ where: { active: true } }),
        payrollCurrency: currency?.value ?? "BYN", lastMigration: lastMigration?.migration_name,
        allocationSchemaPresent: allocationSchema.table_name !== null };
    }, { timeout: 30_000, isolationLevel: "RepeatableRead" });
    console.log(JSON.stringify(result));
  } finally { await db.$disconnect(); }
} catch {
  console.error(JSON.stringify({ status: "STOP", code: "READ_ONLY_FIXTURE_PREFLIGHT_FAILED" }));
  process.exitCode = 1;
}
