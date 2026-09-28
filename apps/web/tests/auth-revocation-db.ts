import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

// Only a deliberately created disposable database is accepted. DATABASE_URL
// is never read: a developer's normal/legacy/live database is not a fallback.
async function main() {
  const dsn = process.env.PERO_AUTH_TEST_DATABASE_URL;
  if (!dsn) throw new Error("Set PERO_AUTH_TEST_DATABASE_URL to a disposable PostgreSQL database");
  const dbName = decodeURIComponent(new URL(dsn).pathname.slice(1));
  if (!/^pero_auth_test_[a-z0-9_]+$/.test(dbName) || process.env.PERO_AUTH_TEST_CONFIRM !== dbName) {
    throw new Error("Refusing database: require pero_auth_test_* name and identical PERO_AUTH_TEST_CONFIRM");
  }
  const db = new Client({ connectionString: dsn });
  await db.connect();
  try {
    const { rows: [identity] } = await db.query(
      "SELECT current_database() AS name, shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = current_database()",
    );
    if (identity.name !== dbName || identity.marker !== "PERO_AUTH_TEST_DISPOSABLE") {
      throw new Error("Refusing unmarked database: require COMMENT ON DATABASE ... IS 'PERO_AUTH_TEST_DISPOSABLE'");
    }
    await db.query("BEGIN");
    const schema = `auth_security_${randomBytes(8).toString("hex")}`;
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET LOCAL search_path TO "${schema}", public`);
    await db.query(`
      CREATE TABLE "User" ("id" text PRIMARY KEY, "email" text NOT NULL UNIQUE,
        "name" text NOT NULL, "passwordHash" text NOT NULL, "roles" text[] NOT NULL, "active" boolean NOT NULL);
      CREATE TABLE "ApiToken" ("id" text PRIMARY KEY, "createdById" text, "revokedAt" timestamptz);
      INSERT INTO "User" VALUES ('a', 'a@test.invalid', 'Test A', 'hash-1', ARRAY['ADMIN'], true),
        ('b', 'b@test.invalid', 'Test B', 'hash-1', ARRAY['MANAGER'], true),
        ('disabled', 'disabled@test.invalid', 'Disabled', 'hash-1', ARRAY['WORKER'], false);
      INSERT INTO "ApiToken" VALUES ('disabled-token', 'disabled', NULL), ('orphan-token', 'missing', NULL),
        ('service-token', NULL, NULL), ('a-token', 'a', NULL), ('b-token', 'b', NULL);
    `);
    const migration = await readFile(path.resolve("prisma/migrations/20260922160000_session_revocation/migration.sql"), "utf8");
    await db.query(migration);
    const version = async (id = "a") => Number((await db.query('SELECT "sessionVersion" FROM "User" WHERE id = $1', [id])).rows[0].sessionVersion);
    const revoked = async (id: string) => (await db.query('SELECT "revokedAt" FROM "ApiToken" WHERE id = $1', [id])).rows[0].revokedAt !== null;
    assert.equal(await version(), 0);
    assert.equal(await revoked("disabled-token"), true);
    assert.equal(await revoked("orphan-token"), true);
    assert.equal(await revoked("service-token"), false);
    await db.query('UPDATE "User" SET name = $1 WHERE id = $2', ["Renamed", "a"]);
    assert.equal(await version(), 0);
    await db.query('UPDATE "User" SET "passwordHash" = $1 WHERE id = $2', ["hash-2", "a"]);
    assert.equal(await version(), 1);
    assert.equal(await revoked("a-token"), false, "password reset keeps distinct integration credentials");
    await db.query('UPDATE "User" SET roles = $1 WHERE id = $2', [["WORKER"], "a"]);
    assert.equal(await version(), 2);
    assert.equal(await revoked("a-token"), true);
    await db.query('UPDATE "User" SET "sessionVersion" = 0 WHERE id = $1', ["a"]);
    assert.equal(await version(), 2, "cannot resurrect old version");
    await db.query('UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1 WHERE id = $1', ["a"]);
    assert.equal(await version(), 3);
    await db.query('UPDATE "User" SET email = $1 WHERE id = $2', ["new-a@test.invalid", "a"]);
    assert.equal(await version(), 4);
    await db.query('UPDATE "User" SET active = false WHERE id = $1', ["b"]);
    assert.equal(await version("b"), 1);
    assert.equal(await revoked("b-token"), true);
    await db.query('UPDATE "User" SET active = true WHERE id = $1', ["b"]);
    assert.equal(await version("b"), 2);
    assert.equal(await revoked("b-token"), true, "reenabling never revives old keys");
    assert.equal(await version(), 4, "other account unaffected");
    await db.query('UPDATE "User" SET "passwordHash" = $1 WHERE id = $2', ["hash-2", "a"]);
    assert.equal(await version(), 4, "identical values do not revoke again");
    assert.equal(await revoked("service-token"), false);
    await db.query('INSERT INTO "ApiToken" VALUES ($1, $2, NULL)', ["delete-token", "a"]);
    await db.query('DELETE FROM "User" WHERE id = $1', ["a"]);
    assert.equal(await revoked("delete-token"), true, "delete must revoke before owner becomes null");
    await db.query('UPDATE "ApiToken" SET "createdById" = NULL WHERE id = $1', ["delete-token"]);
    assert.equal(await revoked("delete-token"), true);
    console.log("PASS: PostgreSQL migration/trigger; password, roles, email, active, explicit revoke, rollback guard, API ownership and user isolation");
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    await db.end();
  }
}

main().catch(() => {
  // Do not print a DSN/password from driver errors in shared test logs.
  console.error("FAIL: isolated auth database test. Check disposable DB identity/marker and assertions locally.");
  process.exitCode = 1;
});
