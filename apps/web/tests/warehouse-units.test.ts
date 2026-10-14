import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type Role } from "@prisma/client";
import { canAccessSettingsPath } from "../src/lib/settings-access";
import { readFileSync } from "node:fs";

// Источник: warehouse-units-access.test.ts
test("warehouse unit settings grant ADMIN exclusively, including nested and trailing-slash paths", () => {
  for (const path of ["/settings/warehouse-units", "/settings/warehouse-units/", "/settings/warehouse-units/other"]) {
    assert.equal(canAccessSettingsPath(["ADMIN"], path), true);
    for (const role of ["DIRECTOR", "MANAGER", "ENGINEER", "PROCUREMENT", "ACCOUNTANT", "WORKER", "MOUNTER"] as Role[]) {
      assert.equal(canAccessSettingsPath([role], path), false, `${role} must not access ${path}`);
    }
  }
  assert.equal(canAccessSettingsPath(["DIRECTOR"], "/settings/payroll"), true);
  assert.equal(canAccessSettingsPath(["MANAGER", "ENGINEER"], "/settings/product-percentages"), true);
});

// Источник: warehouse-category-schema.test.ts
test('generated MaterialCategory default scalar fields match the historical warehouse table', () => {
  const model = Prisma.dmmf.datamodel.models.find(({ name }) => name === 'MaterialCategory');
  assert.ok(model);
  const historicalSql = readFileSync('prisma/migrations/20260720153036_warehouse/migration.sql', 'utf8');
  const table = historicalSql.match(/CREATE TABLE "MaterialCategory" \(([\s\S]*?)\n\);/)?.[1];
  assert.ok(table);
  const historicalFields = [...table.matchAll(/^\s+"(\w+)"\s+/gm)].map(([, name]) => name);
  assert.deepEqual(model.fields.filter(({ kind }) => kind === 'scalar').map(({ name }) => name), historicalFields);
  assert.equal(model.fields.some(({ name }) => name === 'revision'), false);
  assert.equal(model.fields.find(({ name }) => name === 'active')?.default, true);
  assert.equal(model.fields.find(({ name }) => name === 'materials')?.kind, 'object');
});
