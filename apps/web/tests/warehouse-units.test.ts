import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, type Role } from "@prisma/client";
import { createMaterialUnitInTransaction, renameMaterialUnitInTransaction, deleteMaterialUnitInTransaction } from "../src/server/warehouse/unit-core";
import { type DomainActor } from "../src/server/actor";
import { canAccessSettingsPath } from "../src/lib/settings-access";
import { readFileSync } from "node:fs";

// Источник: warehouse-units.test.ts
const admin: DomainActor = { id: "admin", name: "Администратор", roles: ["ADMIN"], source: "web" };
function fixture() {
  const units = new Map<string, {id: string; name: string}>([["pieces", {id:"pieces", name:"шт"}]]);
  const materials = [{id:"inactive", unitId:"pieces", active:false, quantity:"1.125", norm:"2.000", cost:"15.55"}];
  const logs: unknown[] = []; let lookups = 0, auditFailure = false;
  let currentRoles: Role[] = ["ADMIN"], active = true;
  const tx = {
    user: {findUnique: async()=>{lookups++;return {roles: currentRoles, active};}},
    materialUnit: {
      findUnique: async({where}: {where:{id: string}})=>units.get(where.id) ?? null,
      create: async({data}: {data:{name: string}})=>{const row={id:"new",...data};units.set(row.id,row);return row;},
      update: async({where,data}: {where:{id: string};data:{name:string}})=>{const row={id:where.id,...data};units.set(row.id,row);return row;},
      delete: async({where}: {where:{id:string}})=>{const row=units.get(where.id);units.delete(where.id);return row;},
    },
    material: {count: async({where}: {where:{unitId:string}})=>materials.filter(row=>row.unitId===where.unitId).length},
    changeLog: {create: async({data}: {data:unknown})=>{if(auditFailure)throw Error("audit-failed");logs.push(data);return data;}},
  } as unknown as Prisma.TransactionClient;
  return {tx, units, materials, logs, get lookups(){return lookups;}, roles(value:Role[]){currentRoles=value;}, inactive(){active=false;}, failAudit(){auditFailure=true;}};
}
test("audit failure propagates, allowing enclosing transaction to roll the catalog mutation back",async()=>{
  const f=fixture();f.failAudit();await assert.rejects(()=>createMaterialUnitInTransaction(f.tx,admin,{name:"л"}),/audit-failed/);assert.equal(f.logs.length,0);
});

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
