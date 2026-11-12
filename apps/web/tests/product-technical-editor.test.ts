import assert from "node:assert/strict";
import test from "node:test";
import { createProductTechnicalEditor } from "../src/lib/product-technical-editor";
import type { ProductPatch, ProductPatchResult } from "../src/server/products/patch-contract";
import type { TechnicalSpecifications } from "@pero/kp-template";
const initial: TechnicalSpecifications = {sections:[{id:"body-id",type:"body",group:"construction",label:"Корпус",value:"Берёза"}],description:null,size:null,note:null,sourceGeneration:1};
function saved(patch: ProductPatch): ProductPatchResult {
 assert.equal(patch.field,"technicalSpecificationEntry");
 return {kind:"saved",field:patch.field,value:"value" in patch ? patch.value : null,clientMutationId:patch.clientMutationId,derived:{technicalSpecificationSectionId:"created-id"}};
}
test("виртуальные строки не пишут при просмотре и первом пустом flush; первый ввод создаёт строку",async()=>{
 const patches:ProductPatch[]=[];
 const editor=createProductTechnicalEditor({productId:"p",initial:null,id:()=>"mutation",send:async patch=>{patches.push(patch);return saved(patch);}});
 assert.equal(await editor.flush(),true); assert.equal(patches.length,0);
 const row=editor.section("body");row.setDraft("Дуб");assert.equal(await row.commit(),true);
 assert.deepEqual(patches[0],{productId:"p",field:"technicalSpecificationEntry",type:"body",expectedSectionId:null,expectedSourceGeneration:0,expectedValue:"",value:"Дуб",clientMutationId:"mutation"});
 row.setDraft("Ясень");await row.commit();assert.equal(patches[1].field==="technicalSpecificationEntry"&&patches[1].expectedSectionId,"created-id");
});
test("RSC обновляет чистые строки, но сохраняет CAS и поколение черновика",async()=>{
 const patches:ProductPatch[]=[];
 const editor=createProductTechnicalEditor({productId:"p",initial,send:async patch=>{patches.push(patch);return saved(patch);}});
 editor.section("body").setDraft("Дуб");
 editor.receive({...initial,sourceGeneration:2,sections:[{...initial.sections[0],id:"replacement",value:"Ясень"}]});
 editor.section("hardware").setDraft("Петли");await editor.flush();
 const body=patches.find(p=>p.field==="technicalSpecificationEntry"&&p.type==="body");
 assert.ok(body?.field==="technicalSpecificationEntry");assert.equal(body.expectedSourceGeneration,1);assert.equal(body.expectedSectionId,"body-id");assert.equal(body.expectedValue,"Берёза");
 const hardware=patches.find(p=>p.field==="technicalSpecificationEntry"&&p.type==="hardware");assert.ok(hardware?.field==="technicalSpecificationEntry");assert.equal(hardware.expectedSourceGeneration,2);
});
test("потерянный ответ повторяется тем же запросом, очередь сохраняет последующий ввод",async()=>{
 const patches:ProductPatch[]=[];let attempts=0;
 const editor=createProductTechnicalEditor({productId:"p",initial:null,id:()=>`mutation-${attempts}`,send:async patch=>{patches.push(patch);if(++attempts===1)throw Error("lost");return saved(patch);}});
 const row=editor.section("body");row.setDraft("Дуб");assert.equal(await row.commit(),false);row.setDraft("Ясень");assert.equal(await row.retry(),true);assert.deepEqual(patches[0],patches[1]);assert.equal(row.getSnapshot().draft,"Ясень");await editor.flush();assert.equal(row.getSnapshot().baseline,"Ясень");
});
test("конфликт сохраняет черновик и блокирует переход, соседняя строка сохраняется",async()=>{
 const editor=createProductTechnicalEditor({productId:"p",initial,send:async patch=>patch.field==="technicalSpecificationEntry"&&patch.type==="body"?{kind:"conflict",field:patch.field,clientMutationId:patch.clientMutationId,error:"Источник изменился"}:saved(patch)});
 editor.section("body").setDraft("Дуб");editor.section("hardware").setDraft("Петли");assert.equal(await editor.flush(),false);assert.equal(editor.section("body").getSnapshot().draft,"Дуб");assert.equal(editor.section("hardware").getSnapshot().baseline,"Петли");
});
