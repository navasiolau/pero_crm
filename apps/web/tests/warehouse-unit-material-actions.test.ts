import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import { createRequire, Module } from "node:module";
import type { Role } from "@prisma/client";
const require = createRequire(import.meta.url);
let roles: Role[] = ["MANAGER"], currentRoles: Role[] = ["ADMIN"], writes: unknown[] = [], failAudit = false;
let material = { id: "m", name: "ЛДСП", sku: null as string | null, unitId: "sheet", measurementUnit: { name: "лист" }, active: false, purchasePrice: "17.25" };
const numbers = { quantity: "0.125", issued: "0.025", norm: "0.125", stock: "10.325", cost: "177.77" };
const units = new Map([ ["sheet", { id: "sheet", name: "лист" }], ["tenth", { id: "tenth", name: "1/10 листа" }] ]);
const db = {
  user: { findUnique: async () => ({ roles: currentRoles, active: true }) },
  $queryRaw: async () => [{ phase: "ACTIVE" }],
  $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
    const before = structuredClone([...units]), previousWrites = [...writes];
    try { return await callback(db); } catch (error) { units.clear(); for (const [id,row] of before) units.set(id,row); writes=previousWrites; throw error; }
  },
  materialUnit: {
    findUnique: async ({ where }: {where: {id:string}}) => units.get(where.id) ?? null,
    create: async ({ data }: { data: { name:string } }) => { const row={id:"new",...data};units.set(row.id,row);return row; },
    delete: async () => { throw { code: "P2003" }; },
  },
  material: {
    findUnique: async () => material,
    update: async ({ data }: {data: typeof material}) => { writes.push(data); material={...material,...data,measurementUnit:{name:units.get(data.unitId)!.name}}; return material; },
    create: async ({ data }: {data: typeof material}) => { writes.push(data);return {...data,id:"created",measurementUnit:{name:units.get(data.unitId)!.name}}; },
    count: async () => 0,
  },
  changeLog: { create: async () => { if(failAudit)throw Error("audit-failed"); return {}; } },
};
function inject(name:string,exports:Record<string,unknown>){const filename=require.resolve(name),stub=new Module(filename);stub.filename=filename;stub.loaded=true;stub.exports=exports;require.cache[filename]=stub;}
let materials: typeof import("../src/server/warehouse/actions"), catalog: typeof import("../src/server/warehouse/unit-actions");
before(()=>{
  inject("../src/auth",{auth:async()=>({user:{id:"actor",name:"Actor",roles}})});
  inject("../src/lib/prisma",{prisma:db});
  inject("next/cache",{revalidatePath(){}});
  inject("../src/server/plugins/changelog",{writeChangeLog:async()=>({})});
  inject("../src/server/products/revalidate",{revalidateProductPaths:async()=>{}});
  materials=require("../src/server/warehouse/actions");catalog=require("../src/server/warehouse/unit-actions");
});
beforeEach(()=>{roles=["MANAGER"];currentRoles=["ADMIN"];writes=[];failAudit=false;material={id:"m",name:"ЛДСП",sku:null,unitId:"sheet",measurementUnit:{name:"лист"},active:false,purchasePrice:"17.25"};units.clear();units.set("sheet",{id:"sheet",name:"лист"});units.set("tenth",{id:"tenth",name:"1/10 листа"});});
test("existing warehouse managers can select unitId for inactive material without numeric recalculation",async()=>{
  const before = structuredClone(numbers);
  for(const role of ["ADMIN","DIRECTOR","MANAGER","PROCUREMENT"] as Role[]) {
    roles=[role];assert.equal((await materials.updateMaterial("m",{name:material.name,unitId:"tenth"})).ok,true);
    assert.equal(material.purchasePrice,"17.25");assert.equal(material.unitId,"tenth");assert.deepEqual(numbers,before);
    assert.deepEqual(Object.keys(writes.at(-1) as object).sort(),["name","sku","unitId","categoryId","minStock","comment"].sort());
  }
});
test("unknown/deleted unit refuses before write and forged unit string or price is rejected",async()=>{
  assert.equal((await materials.addMaterial({name:"Материал",unitId:"missing"})).ok,false);
  assert.equal((await materials.updateMaterial("m",{name:"Материал",unitId:"missing"})).ok,false);assert.equal(writes.length,0);
  const fake={name:"Материал",unitId:"tenth",unit:"л"};assert.equal((await materials.updateMaterial("m",fake)).ok,false);
  const fakePrice={name:"Материал",unitId:"tenth",purchasePrice:1};assert.equal((await materials.updateMaterial("m",fakePrice)).ok,false);
  assert.equal(writes.length,0);roles=["ENGINEER"];await assert.rejects(()=>materials.updateMaterial("m",{name:"Материал",unitId:"tenth"}),/прав/);
});
test("catalog actions deny DIRECTOR, recheck ADMIN, preserve unit on transaction audit error and translate FK race",async()=>{
  roles=["DIRECTOR"];await assert.rejects(()=>catalog.addMaterialUnit({name:"л"}),/прав/);
  roles=["ADMIN"];currentRoles=["DIRECTOR"];assert.equal((await catalog.addMaterialUnit({name:"л"})).ok,false);assert.equal(units.has("new"),false);
  currentRoles=["ADMIN"];failAudit=true;assert.equal((await catalog.addMaterialUnit({name:"л"})).ok,false);assert.equal(units.has("new"),false);
  failAudit=false;const failed=await catalog.deleteMaterialUnit("sheet");assert.equal(failed.ok,false);assert.match(failed.error ?? "",/используется/);assert.equal(units.has("sheet"),true);
});
