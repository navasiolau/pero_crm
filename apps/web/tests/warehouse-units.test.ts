import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, Role } from "@prisma/client";
import { createMaterialUnitInTransaction, renameMaterialUnitInTransaction, deleteMaterialUnitInTransaction } from "../src/server/warehouse/unit-core";
import type { DomainActor } from "../src/server/actor";
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
test("ADMIN creates and renames a used unit with stable id, including audit, without touching numbers", async()=>{
  const f=fixture(), facts=structuredClone(f.materials);
  const row=await createMaterialUnitInTransaction(f.tx,admin,{name:"  л  "});assert.equal(row.name,"л");
  await renameMaterialUnitInTransaction(f.tx,admin,"pieces",{name:"1/10 листа"});
  assert.equal(f.units.get("pieces")?.name,"1/10 листа");assert.deepEqual(f.materials,facts);assert.equal(f.logs.length,2);
});
test("DIRECTOR and other roles fail before DB access; revoked ADMIN fails inside transaction",async()=>{
  const f=fixture();for(const role of ["DIRECTOR","MANAGER","ENGINEER","PROCUREMENT","ACCOUNTANT","WORKER","MOUNTER"] as Role[]){
    await assert.rejects(()=>createMaterialUnitInTransaction(f.tx,{...admin,roles:[role]},{name:"л"}),/только администратор/);
    await assert.rejects(()=>renameMaterialUnitInTransaction(f.tx,{...admin,roles:[role]},"pieces",{name:"другое"}),/только администратор/);
    await assert.rejects(()=>deleteMaterialUnitInTransaction(f.tx,{...admin,roles:[role]},"pieces"),/только администратор/);
  }assert.equal(f.lookups,0);f.roles(["DIRECTOR"]);await assert.rejects(()=>createMaterialUnitInTransaction(f.tx,admin,{name:"л"}),/только администратор/);
  f.roles(["ADMIN"]);f.inactive();await assert.rejects(()=>deleteMaterialUnitInTransaction(f.tx,admin,"pieces"),/только администратор/);assert.equal(f.units.size,1);
});
test("inactive usage prevents deletion; after reassignment unit can be deleted, missing and blank values refuse",async()=>{
  const f=fixture();await assert.rejects(()=>deleteMaterialUnitInTransaction(f.tx,admin,"pieces"),/используется/);assert.equal(f.logs.length,0);
  f.materials[0].unitId="another";await deleteMaterialUnitInTransaction(f.tx,admin,"pieces");assert.equal(f.units.has("pieces"),false);assert.equal(f.logs.length,1);
  await assert.rejects(()=>renameMaterialUnitInTransaction(f.tx,admin,"missing",{name:"л"}),/не найдена/);
  await assert.rejects(()=>createMaterialUnitInTransaction(f.tx,admin,{name:"  "}));
});
test("audit failure propagates, allowing enclosing transaction to roll the catalog mutation back",async()=>{
  const f=fixture();f.failAudit();await assert.rejects(()=>createMaterialUnitInTransaction(f.tx,admin,{name:"л"}),/audit-failed/);assert.equal(f.logs.length,0);
});
