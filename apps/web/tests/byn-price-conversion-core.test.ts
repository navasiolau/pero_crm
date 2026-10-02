import assert from "node:assert/strict";
import test from "node:test";
import {createHash,createHmac} from "node:crypto";
import {Prisma,type PrismaClient} from "@prisma/client";
import {inventoryPrices,sealPricePlan,applyPricePlan,priceTargetBinding,PRICE_FINGERPRINT_PROFILE,type OriginalManifest,type TestBinding} from "../scripts/byn-price-conversion/core";
import {validateHistoricalRate,canonical,type CurrentProjectPrices} from "../scripts/byn-price-conversion/planner";
import {createPricePacket,validatePricePacket} from "../scripts/byn-price-conversion/packet";
const binding:TestBinding={target:"local",revision:"a".repeat(40),hostname:"test-host",image:"local-node",database:"pero_crm",databaseVolume:"existing-local-5433"};
const secret="synthetic-test-only-secret";
const rate=()=>validateHistoricalRate("USD","2024-01-06",JSON.stringify([{Cur_ID:431,Cur_Abbreviation:"USD",Cur_Scale:1,Cur_DateStart:"2021-07-09T00:00:00",Cur_DateEnd:"2050-01-01T00:00:00"}]),JSON.stringify({Cur_ID:431,Cur_Abbreviation:"USD",Cur_Scale:1,Date:"2024-01-06T00:00:00",Cur_OfficialRate:3}));
function fixture(){
 let source:CurrentProjectPrices[]=[{id:"p",number:"205",title:"Synthetic",currency:"USD",createdAt:"2024-01-05T22:00:00.000Z",initialPrice:"100",delivery:"2",unloading:null,installation:"0",products:[{id:"x",projectId:"p",number:"205.1",title:"Synthetic product",quantity:3,expectedPrice:"10.01",initialPrice:"12"}]}];
 let protectedHash="a".repeat(32),blocked=false,changeAfterWrite=false;const writes:string[]=[],queries:string[]=[];
 const tokens=[{id:"token",tokenHash:"synthetic-frozen-token-hash",active:true,lastUsedAt:"2024-01-01T00:00:00.000Z"}];
 const rows=()=>source.map(project=>({...project,createdAt:new Date(project.createdAt),products:project.products.map(row=>({...row}))}));
 const tx={
  $executeRawUnsafe:async(sql:string)=>{assert.equal(sql,"SET TRANSACTION READ ONLY");return 0;},
  $queryRawUnsafe:async(sql:string)=>{queries.push(sql);if(sql.includes("current_database"))return[{database:"pero_crm",schema:"public"}];if(sql.includes("pg_tables"))return [...Object.values(Prisma.ModelName),"_prisma_migrations","ExternalLegacyFact"].sort().map(tablename=>({tablename}));if(sql.includes('FROM "ApiToken"')){const projection=tokens.map(row=>{const copy:Partial<typeof row>={...row};if(sql.includes("to_jsonb(t) - 'lastUsedAt'"))delete copy.lastUsedAt;return copy;});return[{count:String(tokens.length),hash:createHash("md5").update(canonical(projection)).digest("hex")}];}return[{count:"1",hash:protectedHash}];},
  $queryRaw:async(strings:TemplateStringsArray)=>strings.join("").includes("txid_current")?[{pricingVersion:"123456"}]:[],
  project:{findMany:async()=>rows(),updateMany:async({where,data}:{where:{id:string;currency:string};data:Record<string,unknown>})=>{assert.equal(where.id,"p");assert.equal(where.currency,source[0].currency);writes.push("project");for(const field of ["currency","initialPrice","delivery","unloading","installation"] as const)(source[0] as unknown as Record<string,unknown>)[field]=data[field];assert.ok(data.updatedAt instanceof Date);if(changeAfterWrite)protectedHash="b".repeat(32);return{count:1};}},
  product:{updateMany:async({where,data}:{where:{id:string;quantity:number};data:{expectedPrice:string;initialPrice:string;updatedAt:Date}})=>{if(blocked)throw Error("APPEND_ONLY_TRIGGER_REFUSED");assert.equal(where.id,"x");assert.equal(where.quantity,3);writes.push("product");source[0].products[0].expectedPrice=data.expectedPrice;source[0].products[0].initialPrice=data.initialPrice;assert.ok(data.updatedAt instanceof Date);return{count:1};}},
 };
 const db={$transaction:async(operation:(transaction:unknown)=>Promise<unknown>)=>{const original=structuredClone(source),hash=protectedHash;try{return await operation(tx);}catch(error){source=original;protectedHash=hash;throw error;}}} as unknown as PrismaClient;
 return{db,writes,queries,state:()=>structuredClone(source),block:()=>{blocked=true;},changeOther:()=>{protectedHash="b".repeat(32);},changeAfterWrite:()=>{changeAfterWrite=true;},touchToken:()=>{tokens[0].lastUsedAt="2024-01-02T00:00:00.000Z";},changeToken:()=>{tokens[0].active=false;},addToken:()=>{tokens.push({...tokens[0],id:"new-token"});}};
}
test("production and unknown target are refused before any DB client; stage needs exact actual image proof",()=>{
 const env={CRM_MODERNIZATION_TARGET:"production",DATABASE_URL:"postgresql://fake:fake@localhost:5433/pero_crm"};assert.throws(()=>priceTargetBinding({revision:binding.revision,image:"local-node"},env,"win32","test-host",false),/TEST_TARGET_ONLY/);
 assert.throws(()=>priceTargetBinding({revision:binding.revision,image:"sha256:"+"b".repeat(64)},{...env,CRM_MODERNIZATION_TARGET:"staging",DATABASE_URL:"postgresql://fake:fake@db:5432/crm"},"linux","c".repeat(12),true),/OUTER_STAGE_PROOF/);
 assert.equal(priceTargetBinding({revision:binding.revision,image:"local-node"},{...env,CRM_MODERNIZATION_TARGET:"local"},"win32","test-host",false).database,"pero_crm");
});
test("atomic apply updates only current price/currency/updatedAt, returns txid and replays without second conversion",async()=>{
 const f=fixture(),manifest=await inventoryPrices(f.db,binding,secret),sealed=sealPricePlan(manifest,[rate()],binding,secret);assert.equal(f.writes.length,0);
 const result=await applyPricePlan(f.db,manifest,sealed,binding,secret);assert.equal(result.status,"APPLIED");if("pricingVersion"in result)assert.equal(result.pricingVersion,"123456");assert.deepEqual(f.writes,["project","product"]);assert.equal(f.state()[0].products[0].quantity,3);assert.equal(f.state()[0].products[0].expectedPrice,"30.03");assert.equal(f.state()[0].currency,"BYN");
 const second=await applyPricePlan(f.db,manifest,sealed,binding,secret);assert.equal(second.status,"ALREADY_APPLIED");assert.equal(second.committed,false);assert.deepEqual(f.writes,["project","product"]);
 assert.ok(f.queries.some(query=>query.includes('"ExternalLegacyFact"')));assert.ok(f.queries.some(query=>query.includes('"_prisma_migrations"')));assert.ok(f.queries.some(query=>query.includes('"TimeEntry"')));
});
test("signed-source tampering/missing FX/stale other models stop before writes",async()=>{
 const f=fixture(),manifest=await inventoryPrices(f.db,binding,secret);assert.throws(()=>sealPricePlan(manifest,[],binding,secret),/MISSING_FX/);
 const tampered=structuredClone(manifest);tampered.source[0].delivery="200";assert.throws(()=>sealPricePlan(tampered,[rate()],binding,secret),/SIGNATURE_MISMATCH/);
 const sealed=sealPricePlan(manifest,[rate()],binding,secret);f.changeOther();await assert.rejects(applyPricePlan(f.db,manifest,sealed,binding,secret),/OTHER_DATA_CHANGED/);assert.deepEqual(f.writes,[]);
});
test("append-only refusal and post-write frozen-fact change roll back the entire transaction",async()=>{
 for(const mode of ["trigger","fingerprint"]){const f=fixture(),before=f.state(),manifest=await inventoryPrices(f.db,binding,secret),sealed=sealPricePlan(manifest,[rate()],binding,secret);if(mode==="trigger")f.block();else f.changeAfterWrite();await assert.rejects(applyPricePlan(f.db,manifest,sealed,binding,secret));assert.deepEqual(f.state(),before);}
});
test("all price steps satisfy the existing outer inspect gate and reject mismatched/extra packet keys without DB",()=>{
 const base={revision:binding.revision,image:binding.image};
 for(const [step,payload] of [["inventory",base],["seal",{...base,manifest:{},rates:[]}],["apply",{...base,manifest:{},sealed:{}}]] as const){const packet=createPricePacket(step,payload);assert.equal(packet.operation,"inspect");assert.equal(packet.priceOperation,step);assert.doesNotThrow(()=>validatePricePacket(packet));}
 assert.throws(()=>validatePricePacket({operation:"inventory",...base}),/OUTER_INSPECT/);assert.throws(()=>createPricePacket("inventory",{...base,unexpected:true}),/UNKNOWN_INPUT/);assert.throws(()=>validatePricePacket({operation:"inspect",priceOperation:"production",...base}),/OPERATION_REQUIRED/);
 assert.throws(()=>createPricePacket("inventory",{...base,priceOperation:"apply"}),/OPERATION_OVERRIDE/);
});
test("signed V2 profile allows only ApiToken lastUsedAt, rejects token fields/counts/financial changes",async()=>{
 const allowed=fixture(),manifest=await inventoryPrices(allowed.db,binding,secret);assert.equal(manifest.version,2);assert.equal(manifest.fingerprintProfile,PRICE_FINGERPRINT_PROFILE);const sealed=sealPricePlan(manifest,[rate()],binding,secret);allowed.touchToken();assert.equal((await applyPricePlan(allowed.db,manifest,sealed,binding,secret)).status,"APPLIED");
 for(const mutation of ["field","count","financial"]){const f=fixture(),before=f.state(),original=await inventoryPrices(f.db,binding,secret),plan=sealPricePlan(original,[rate()],binding,secret);if(mutation==="field")f.changeToken();else if(mutation==="count")f.addToken();else f.changeOther();await assert.rejects(applyPricePlan(f.db,original,plan,binding,secret),/OTHER_DATA_CHANGED_STOP/);assert.deepEqual(f.writes,[]);assert.deepEqual(f.state(),before);}
});
test("old valid signed manifests without the new fingerprint profile are never reinterpreted",async()=>{
 const f=fixture(),current=await inventoryPrices(f.db,binding,secret),old:Partial<OriginalManifest>={...current};delete old.version;delete old.fingerprintProfile;delete old.signature;old.signature=createHmac("sha256",secret).update("PERO_TEST_BYN_PRICES_V1\0").update(canonical(old)).digest("hex");assert.throws(()=>sealPricePlan(old as OriginalManifest,[rate()],binding,secret),/FINGERPRINT_PROFILE_REQUIRED/);assert.deepEqual(f.writes,[]);
});
