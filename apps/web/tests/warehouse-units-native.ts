import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";
import { createMaterialUnitInTransaction, renameMaterialUnitInTransaction, deleteMaterialUnitInTransaction } from "../src/server/warehouse/unit-core";

/** Полная проверка в одной rollback-only транзакции существующей local5433. Никаких дампов, reset или новых БД. */
async function main() {
  const db = new PrismaClient({ datasourceUrl: existingLocalCrmDatabaseUrl() });
  const rollback = Error("WAREHOUSE_UNITS110_EXPECTED_ROLLBACK"), marker = "QA_UNIT110_" + randomUUID();
  let passed = false;
  async function inventory(tx: Prisma.TransactionClient | PrismaClient) {
    const tables = await tx.$queryRaw<{ name: string }[]>`SELECT tablename name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
    const state: Record<string, unknown> = {};
    for (const { name } of tables) {
      const quoted = '"' + name.replaceAll('"', '""') + '"';
      state[name] = await tx.$queryRawUnsafe(`SELECT count(*)::text n,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) h FROM (SELECT md5(to_jsonb(t)::text) h FROM ${quoted} t) x`);
    }
    return state;
  }
  const before = await inventory(db);
  const schemaBefore = await db.$queryRaw`SELECT table_name,column_name,data_type,column_default,is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`;
  try {
    assert.ok(!Object.hasOwn(before, "MaterialUnit"), "Harness expects the existing local pre-migration schema; do not apply shared migrations to make this pass");
    const migration = await readFile("prisma/migrations/20261008190000_warehouse_unit_catalog/migration.sql", "utf8");
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '20s'");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(18436,110)`;
      await tx.$executeRaw`INSERT INTO "Material" (id,name,unit,"purchasePrice","minStock",active,"createdAt","updatedAt") VALUES (${marker},${marker},${marker + '-custom'},17.25,0.125,false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`;
      const legacyMaterials = await tx.$queryRaw`SELECT to_jsonb(m) row FROM "Material" m ORDER BY id`;
      const protectedBefore = await tx.$queryRaw`SELECT to_jsonb(m) row FROM "PriceItem" m ORDER BY id`;
      for (const statement of migration.split(";").map(value => value.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
      const migrated = await tx.$queryRaw`SELECT (to_jsonb(m) - 'unitId') || jsonb_build_object('unit',u.name) row FROM "Material" m JOIN "MaterialUnit" u ON u.id=m."unitId" ORDER BY m.id`;
      assert.deepEqual(migrated, legacyMaterials, "Backfill must preserve every old material field and exact unit label");
      for (const name of ["шт","м²","м.п.","лист","кг","м","компл","упак","л","1/10 листа", marker + "-custom"]) assert.ok(await tx.materialUnit.findUnique({ where: { name } }));
      const custom = await tx.material.findUniqueOrThrow({ where: { id: marker }, include: { measurementUnit: true } });
      assert.equal(custom.measurementUnit.name, marker + "-custom");
      const user = await tx.user.create({ data: { id: marker, name: marker, email: marker + "@qa.invalid", passwordHash: "not-used", roles: ["ADMIN"] } });
      const actor = { id: user.id, name: user.name, roles: ["ADMIN" as const], source: "web" as const };
      await assert.rejects(() => deleteMaterialUnitInTransaction(tx, actor, custom.unitId), /используется/);
      await tx.$executeRawUnsafe("SAVEPOINT used_unit_constraint");
      await assert.rejects(() => tx.materialUnit.delete({ where: { id: custom.unitId } }), /Foreign key|constraint/i);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT used_unit_constraint");
      const added = await createMaterialUnitInTransaction(tx, actor, { name: marker + "-new" });
      const numbers = { purchasePrice: custom.purchasePrice?.toString(), minStock: custom.minStock?.toString(), active: custom.active };
      await tx.material.update({ where: { id: marker }, data: { unitId: added.id } });
      const changed = await tx.material.findUniqueOrThrow({ where: { id: marker } });
      assert.deepEqual({ purchasePrice: changed.purchasePrice?.toString(), minStock: changed.minStock?.toString(), active: changed.active }, numbers);
      await deleteMaterialUnitInTransaction(tx, actor, custom.unitId);
      assert.equal(await tx.materialUnit.findUnique({ where: { id: custom.unitId } }), null);
      await tx.$executeRawUnsafe("SAVEPOINT deleted_unit_assignment");
      await assert.rejects(() => tx.material.update({ where: { id: marker }, data: { unitId: custom.unitId } }), /Foreign key|constraint/i);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT deleted_unit_assignment");
      await renameMaterialUnitInTransaction(tx, actor, added.id, { name: marker + "-renamed" });
      assert.equal((await tx.material.findUniqueOrThrow({ where: { id: marker }, include: { measurementUnit: true } })).measurementUnit.name, marker + "-renamed");
      await tx.$executeRawUnsafe("SAVEPOINT duplicate_unit_name");
      await assert.rejects(() => tx.materialUnit.create({ data: { name: "л" } }), /Unique constraint/i);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT duplicate_unit_name");
      assert.equal(await tx.changeLog.count({ where: { actorId: marker, entity: "materialUnit" } }), 3);
      assert.deepEqual(await tx.$queryRaw`SELECT to_jsonb(m) row FROM "PriceItem" m ORDER BY id`, protectedBefore);
      const untouchedBefore = { ...before }; delete untouchedBefore.Material;
      delete untouchedBefore.User; delete untouchedBefore.ChangeLog;
      const untouchedAfter = await inventory(tx); delete untouchedAfter.MaterialUnit; delete untouchedAfter.Material; delete untouchedAfter.User; delete untouchedAfter.ChangeLog;
      assert.deepEqual(untouchedAfter, untouchedBefore, "No quantities, norms, movements, balances, payroll or other facts may change");
      passed = true;
      throw rollback;
    }, { timeout: 60000, maxWait: 10000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally {
    try {
      assert.deepEqual(await inventory(db), before, "Rollback must restore every table row and catalog absence");
      assert.deepEqual(await db.$queryRaw`SELECT table_name,column_name,data_type,column_default,is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`, schemaBefore, "Rollback must restore the pre-migration schema");
    } finally { await db.$disconnect(); }
  }
  assert.equal(passed, true);
  process.stdout.write("warehouse-unit110 native PASS: exact legacy backfill, standard/custom labels, Restrict/unique constraints, inactive usage, stable rename, numeric invariants, complete schema+row rollback\n");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Native test failed"); process.exitCode=1; });
