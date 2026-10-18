import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { captureMigrationSource, pinMigrationBundle } from "../scripts/kp/storage-native";

test("pinned migration bundle ignores later edited and added source files", async () => {
  // Только синтетические файлы в ignored-каталоге; CLI Prisma и БД здесь не запускаются.
  const fixture = resolve(__dirname, "../../../.playwright-mcp/kp-180/migration-pinning-fixtures", randomUUID());
  const migrations = resolve(fixture, "migrations");
  const current = "20261018000100_kp_document_storage", legacy = "20260718165710_init", late = "20261019000100_late";
  for (const name of [current, legacy]) await mkdir(resolve(migrations, name), { recursive: true });
  const schema = 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n';
  const lock = '# Synthetic lock\nprovider = "postgresql"\n';
  const original = Buffer.from("-- Synthetic; never executed\r\nSELECT 1;\r\n");
  await writeFile(resolve(fixture, "schema.prisma"), schema);
  await writeFile(resolve(migrations, "migration_lock.toml"), lock);
  for (const name of [current, legacy]) await writeFile(resolve(migrations, name, "migration.sql"), original);
  const captured = await captureMigrationSource(migrations);

  await writeFile(resolve(migrations, current, "migration.sql"), "-- Late source edit before pin\nSELECT 2;\n");
  await writeFile(resolve(fixture, "schema.prisma"), schema.replace("postgresql", "sqlite"));
  await writeFile(resolve(migrations, "migration_lock.toml"), 'provider = "sqlite"\n');
  await mkdir(resolve(migrations, late));
  await writeFile(resolve(migrations, late, "migration.sql"), "-- Late source addition\nSELECT 3;\n");

  const bundle = await pinMigrationBundle(captured, {
    containerId: "a".repeat(64), currentMigrationChecksum: createHash("sha256").update(original).digest("hex"), historyDigest: "b".repeat(64),
  });
  await writeFile(resolve(migrations, legacy, "migration.sql"), "-- Late source edit after pin\nSELECT 4;\n");
  assert.equal(await readFile(bundle.schemaPath, "utf8"), schema);
  assert.equal(await readFile(resolve(bundle.bundlePath, "migrations/migration_lock.toml"), "utf8"), lock);
  for (const name of [current, legacy]) assert.deepEqual(await readFile(resolve(bundle.bundlePath, "migrations", name, "migration.sql")), original);
  assert.deepEqual((await readdir(resolve(bundle.bundlePath, "migrations"))).sort(), [current, legacy, "migration_lock.toml"].sort());
  const manifest = JSON.parse(await readFile(resolve(bundle.bundlePath, "execution-manifest.json"), "utf8")) as {
    executionManifestHash: string; files: { path: string; sha256: string }[];
  };
  assert.equal(manifest.executionManifestHash, bundle.executionManifestHash);
  assert.equal(manifest.files.length, 4);
  assert.equal(manifest.files.find(file => file.path === `migrations/${current}/migration.sql`)?.sha256, createHash("sha256").update(original).digest("hex"));
});
