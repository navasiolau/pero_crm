import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { APPROVED, assertAddedDefaults, assertApprovedSql, assertContainerIdentity, assertDatasourceSchema, assertLocalUrl, assertOriginalData, assertPendingMigration, recordFailure, rowHashSql } from "./work-shares-local-migrate.mjs";

const docker = () => ({
  Id: String(APPROVED.containerId), Name: "/pero_crm_pg", Image: "sha256:test-image", RestartCount: 0,
  State: { Running: true, Paused: false, StartedAt: "2026-09-01T00:00:00.000000000Z" },
  HostConfig: { PortBindings: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5433" }] } },
  NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5433" }] } },
  Mounts: [{ Type: "volume", Name: "pero_crm_v2_pgdata", Destination: "/var/lib/postgresql/data", Source: "/var/lib/docker/volumes/pero_crm_v2_pgdata/_data", RW: true }],
  Config: { Env: ["POSTGRES_DB=pero_crm", "POSTGRES_USER=pero", "POSTGRES_PASSWORD=unit-only-password", "PGDATA=/var/lib/postgresql/data"] },
});
const schema = 'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}';
const manifest = [{ name: "20260101000000_initial", sha256: "a".repeat(64) }, { name: APPROVED.migration, sha256: APPROVED.sqlSha256 }];
const ledger = [{ id: "one", name: "20260101000000_initial", checksum: "a".repeat(64), finishedAt: "2026-01-01T00:00:00Z", rolledBackAt: null }];

test("only the exact reviewed transaction-wrapped SQL is accepted", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20260928140000_universal_work_shares/migration.sql", import.meta.url));
  assert.equal(assertApprovedSql(sql), APPROVED.sqlSha256);
  assert.throws(() => assertApprovedSql(Buffer.concat([sql, Buffer.from("\n-- changed")])), /SQL/);
});

test("datasource requires only PostgreSQL and DATABASE_URL, rejecting alternate URLs/config", () => {
  assertDatasourceSchema(schema);
  for (const text of [schema.replace("postgresql", "sqlite"), schema.replace('env("DATABASE_URL")', 'env("PROD_DATABASE_URL")'), schema.replace("\n}", '\n directUrl = env("DIRECT_URL")\n}'), schema.replace("\n}", '\n shadowDatabaseUrl = env("SHADOW_URL")\n}'), `${schema}\n${schema}`]) {
    assert.throws(() => assertDatasourceSchema(text), /DATASOURCE/);
  }
});

test("container guard rejects wrong ID, public/legacy port, swapped volume and restart state", () => {
  const identity = assertContainerIdentity(docker());
  assert.equal(identity.id, APPROVED.containerId);
  const variants = [docker(), docker(), docker(), docker(), docker()];
  variants[0].Id = "0".repeat(64);
  variants[1].HostConfig.PortBindings["5432/tcp"][0].HostPort = "5432";
  variants[2].NetworkSettings.Ports["5432/tcp"][0].HostIp = "0.0.0.0";
  variants[3].Mounts[0].Name = "production-volume";
  variants[4].State.Running = false;
  for (const container of variants) assert.throws(() => assertContainerIdentity(container), /CONTAINER/);
});

test("a secret-bearing DSN is accepted only for the exact local binding and no options", () => {
  assertLocalUrl("postgresql://pero:unit-only-password@127.0.0.1:5433/pero_crm", "unit-only-password");
  for (const dsn of ["postgresql://pero:unit-only-password@127.0.0.1:5432/pero_crm", "postgresql://pero:unit-only-password@192.168.0.20:5432/crm", "postgresql://pero:wrong@127.0.0.1:5433/pero_crm", "postgresql://pero:unit-only-password@127.0.0.1:5433/pero_crm?host=production", "postgresql://pero:unit-only-password@127.0.0.1:5433/legacy"]) {
    assert.throws(() => assertLocalUrl(dsn, "unit-only-password"), /LOCAL_DATABASE_URL/);
  }
});

test("only the approved single pending migration is accepted; failed or extra pending work stops", () => {
  assert.equal(assertPendingMigration(manifest, ledger), APPROVED.migration);
  assert.throws(() => assertPendingMigration([...manifest, { name: "20270101000000_unreviewed", sha256: "b".repeat(64) }], ledger), /MIGRATION/);
  assert.throws(() => assertPendingMigration(manifest, [...ledger, { id: "failed", name: APPROVED.migration, checksum: APPROVED.sqlSha256, finishedAt: null, rolledBackAt: null }]), /MIGRATION/);
  assert.throws(() => assertPendingMigration(manifest, [...ledger, { id: "done", name: APPROVED.migration, checksum: APPROVED.sqlSha256, finishedAt: "2026-09-28T00:00:00Z", rolledBackAt: null }]), /MIGRATION/);
});

test("all original counts/hashes must survive and only the empty approved group may be new", () => {
  const before = { Task: { count: "100", hash: "a" }, Payment: { count: "4", hash: "b" } };
  assertOriginalData(before, before);
  assertOriginalData(before, { ...before, TaskAllocationGroup: { count: "0", hash: "empty" } }, true);
  assert.throws(() => assertOriginalData(before, { ...before, Task: { count: "100", hash: "changed" } }), /DATA/);
  assert.throws(() => assertOriginalData(before, { ...before, Unknown: { count: "0", hash: "empty" } }), /DATA/);
  assert.throws(() => assertOriginalData(before, { ...before, TaskAllocationGroup: { count: "1", hash: "new-row" } }, true), /DATA/);
});

test("old tasks must retain NULL allocation fields and revision zero after deployment", () => {
  assertAddedDefaults({ groupCount: "0", invalidTasks: "0" });
  assert.throws(() => assertAddedDefaults({ groupCount: "1", invalidTasks: "0" }), /POST/);
  assert.throws(() => assertAddedDefaults({ groupCount: "0", invalidTasks: "1" }), /POST/);
});

test("Task fingerprints strip exactly the four additive fields; other tables remain whole", () => {
  assert.match(rowHashSql("Task"), /to_jsonb\(t\) - ARRAY\['allocationGroupId','shareUnits','shareAmount','splitRevision'\]/);
  assert.doesNotMatch(rowHashSql("Payment"), /ARRAY|allocationGroup/);
  assert.match(rowHashSql('odd"name'), /public\."odd""name"/);
});

test("denied repeated apply preserves the earlier outcome byte-for-byte", () => {
  const dir = mkdtempSync(join(tmpdir(), "work-shares-guard-unit-"));
  const file = join(dir, "apply-outcome.json");
  const original = '{"status":"APPLIED_AND_VERIFIED","evidence":"original"}\n';
  try {
    writeFileSync(file, original, { flag: "wx" });
    const outcome = recordFailure("apply", { dir, phase: "APPLY_GUARDS", outcomeOwned: false }, new Error("receipt already attempted"));
    assert.equal(outcome.status, "STOP");
    assert.equal(readFileSync(file, "utf8"), original);
  } finally {
    unlinkSync(file);
    rmdirSync(dir);
  }
});
