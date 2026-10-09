import assert from "node:assert/strict";
import test from "node:test";

import { canSetProductCover, validateProductCoverFile } from "../src/lib/product-cover";
import { authorizeProductCoverUpload, setProductCoverCore } from "../src/server/products/cover-core";

import type {Prisma,Role} from "@prisma/client";
import {resolveVisibilityActor,fileVisibilityWhere,productVisibilityWhere,projectVisibilityWhere} from "../src/server/access/visibility";
import {fixtureModel,matches,type FixtureRow} from "./helpers/visibility-fixture";

const product = { id: "product-1", projectId: "project-1", status: "DESIGN" as const,
  engineerId: "engineer-1", sketchFileId: "old-cover" };
const image = { id: "image-1", projectId: "project-1", productId: "product-1",
  mimeType: "image/jpeg", category: "PHOTO" as const };

test("cover permission follows management precedence and own or participating DESIGN engineering", () => {
  for (const role of ["ADMIN", "DIRECTOR", "MANAGER"] as const)
    assert.equal(canSetProductCover({ id: "other", roles: [role] }, product), true);
  assert.equal(canSetProductCover({ id: "engineer-1", roles: ["ENGINEER"] }, product), true);
  assert.equal(canSetProductCover({ id: "participant", roles: ["ENGINEER"],
    engineeringParticipantProductIds: [product.id] }, product), true);
  assert.equal(canSetProductCover({ id: "engineer-1", roles: ["ENGINEER"] },
    { ...product, status: "PRODUCTION" }), false);
  assert.equal(canSetProductCover({ id: "other", roles: ["MANAGER", "ENGINEER"] },
    { ...product, status: "DONE" }), true);
  assert.equal(canSetProductCover({ id: "engineer-1", roles: ["ENGINEER", "ACCOUNTANT"] }, product), true,
    "Role union preserves an engineering grant");
  for (const role of ["ACCOUNTANT", "WORKER", "MOUNTER"] as const)
    assert.equal(canSetProductCover({ id: "engineer-1", roles: [role] }, product), false);
});

test("cover source must be a supported image bound to this exact product and project", () => {
  assert.equal(validateProductCoverFile(product, image), null);
  assert.match(validateProductCoverFile(product, { ...image, productId: "other-product" }) ?? "", /издел/);
  assert.match(validateProductCoverFile(product, { ...image, projectId: "other-project" }) ?? "", /проект/);
  assert.match(validateProductCoverFile(product, { ...image, mimeType: "application/octet-stream" }) ?? "", /изображ/);
  assert.match(validateProductCoverFile(product, { ...image, mimeType: "image/svg+xml" }) ?? "", /изображ/);
});

test("legacy gallery endpoint without captured baseline is explicitly rejected", async () => {
 const result=await setProductCoverCore({} as never,{id:"manager",roles:["MANAGER"]} as never,product.id,image.id);
 assert.equal(result.ok,false);if(!result.ok)assert.equal(result.kind,"validation");
});
function participantCoverFixture(){
 const parent:FixtureRow={id:'qa-project',number:'216',stage:'CONTRACT',products:[],tasks:[]};
 const own:FixtureRow={id:'qa-product',projectId:parent.id,project:parent,status:'DESIGN',engineerId:null,sketchFileId:'manager-sketch'};
 const foreign:FixtureRow={id:'foreign-product',projectId:parent.id,project:parent,status:'DESIGN',engineerId:'other',sketchFileId:'foreign-sketch'};
 parent.products=[own,foreign];
 const current:FixtureRow={id:'manager-sketch',projectId:parent.id,project:parent,productId:own.id,product:own,taskId:null,mimeType:'image/png',uploadedById:'manager',fileName:'manager-sketch.png',storedName:'01234567-89ab-4def-8123-456789abcdef-manager-sketch.png',sketchForProduct:own,coverForProject:null};
 const foreignFile:FixtureRow={...current,id:'foreign-sketch',productId:foreign.id,product:foreign,fileName:'foreign-sketch.png',storedName:'21234567-89ab-4def-8123-456789abcdef-foreign-sketch.png',sketchForProduct:foreign};
 const config:FixtureRow={id:'config',productId:own.id,product:own,kind:'ENGINEERING'};
 const membership:FixtureRow={id:'member',userId:'participant',configId:config.id,config,shareUnits:1};
 const tx={project:fixtureModel([parent]),product:fixtureModel([own,foreign]),task:fixtureModel([]),productPercentageParticipant:fixtureModel([membership]),file:fixtureModel([current,foreignFile]),changeLog:{findUnique:async()=>null}} as unknown as Prisma.TransactionClient;
 const actor={id:'participant',roles:['ENGINEER'] as Role[]},input={projectId:parent.id as string,productId:own.id as string,expectedSketchFileId:current.id as string,clientMutationId:'01234567-89ab-4def-8123-456789abcdef'};
 return {tx,actor,input,parent,own,foreign,current,foreignFile};
}
test('112 direct DESIGN engineering participant reads project/product/manager sketch and passes replacement preflight',async()=>{
 const f=participantCoverFixture(),resolved=await resolveVisibilityActor(f.tx,f.actor);
 assert.deepEqual(resolved.engineeringParticipantProductIds,['qa-product']);
 const result=await authorizeProductCoverUpload(f.tx,f.actor,f.input);
 assert.equal(result.ok,true,`actual core preflight refused: ${result.ok?'':result.kind}`);
 assert.equal(matches(f.own,productVisibilityWhere(resolved)),true);
 assert.equal(matches(f.parent,projectVisibilityWhere(resolved)),true);
 assert.equal(matches(f.current,fileVisibilityWhere(resolved)),true);
 assert.equal(matches(f.foreign,productVisibilityWhere(resolved)),false);
 assert.equal(matches(f.foreignFile,fileVisibilityWhere(resolved)),false);
});
test('112 participant cover grant never leaks to post-DESIGN/deleted/foreign products or non-engineering roles',async()=>{
 for(const status of ['PREPARATION','PRODUCTION','STORAGE','INSTALLATION','DONE','RECLAMATION']){
  const f=participantCoverFixture();f.own.status=status;const resolved=await resolveVisibilityActor(f.tx,f.actor),result=await authorizeProductCoverUpload(f.tx,f.actor,f.input);
  assert.equal(result.ok,false);if(!result.ok)assert.equal(result.kind,'forbidden');
  assert.equal(matches(f.own,productVisibilityWhere(resolved)),false);assert.equal(matches(f.current,fileVisibilityWhere(resolved)),false);
 }
 for(const scope of ['foreign','deleted-product','deleted-parent','non-engineer']){
  const f=participantCoverFixture();if(scope==='foreign')f.input.productId=f.foreign.id as string;if(scope==='deleted-product')f.own.deletedAt=new Date();if(scope==='deleted-parent')f.parent.deletedAt=new Date();if(scope==='non-engineer')f.actor.roles=['ACCOUNTANT'];
  const result=await authorizeProductCoverUpload(f.tx,f.actor,f.input);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.kind,'forbidden');
 }
});

test('112 real File context keeps shared-cover and exact storage-alias preflight guards',async()=>{
 for(const scenario of ['shared-cover','storage-alias']){
  const f=participantCoverFixture();
  if(scenario==='shared-cover')f.current.coverForProject=f.parent;
  else f.foreignFile.storedName=f.current.storedName;
  const result=await authorizeProductCoverUpload(f.tx,f.actor,f.input);
  assert.equal(result.ok,false);if(!result.ok)assert.equal(result.kind,'validation');
  assert.equal(f.own.sketchFileId,f.current.id);
 }
});
