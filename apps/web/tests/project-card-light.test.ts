import assert from "node:assert/strict";
import {before,test} from "node:test";
import type {PrismaClient} from "@prisma/client";
import {engineerFixture} from "./helpers/visibility-fixture";
const fixture=engineerFixture();const captured:Record<string,unknown>[]=[];
let queries:typeof import("../src/server/projects/queries");
before(async()=>{
 const original=fixture.db.project.findFirst;
 const db={...fixture.db,project:{...fixture.db.project,findFirst:async(input:Record<string,unknown>)=>{captured.push(input);return original(input as Parameters<typeof original>[0]);}}};
 (globalThis as {prisma?:PrismaClient}).prisma=db as unknown as PrismaClient;
 queries=await import("../src/server/projects/queries");
});
test("light project card omits unused communication/product history queries, DONE date is bounded",async()=>{
 await queries.getProjectFor("engineer",["ENGINEER"],"mixed",{includeHistory:false});
 const include=captured.at(-1)!.include as {communications:unknown;products:{include:{statusHistory:unknown}};stageHistory:unknown};
 assert.equal(include.communications,false);assert.equal(include.products.include.statusHistory,false);
 assert.deepEqual(include.stageHistory,{where:{toStage:"DONE"},orderBy:{createdAt:"desc"},take:1});
});
test("existing non-card callers keep full history queries by default",async()=>{
 await queries.getProjectFor("engineer",["ENGINEER"],"mixed");
 const include=captured.at(-1)!.include as {communications:unknown;products:{include:{statusHistory:unknown}};stageHistory:unknown};
 assert.deepEqual(include.communications,{orderBy:{happenedAt:"desc"}});assert.deepEqual(include.products.include.statusHistory,{orderBy:{createdAt:"desc"}});assert.deepEqual(include.stageHistory,{orderBy:{createdAt:"desc"}});
});
