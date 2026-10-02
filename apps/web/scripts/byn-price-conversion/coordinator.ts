// Только root после review; inventory/FX/plan/apply — отдельные явные шаги.
import {createRequire} from "node:module";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {qaTransport,acceptanceRoot,acceptanceWeb,bundleHash} from "../../tests/crm-acceptance-transport.mjs";
import {buildBynPricePlan,projectCalendarDate,canonical,sha256,conversionAssert,type CurrentProjectPrices} from "./planner";
import {fetchHistoricalEvidence} from "./nbrb";
import type {OriginalManifest,SealedPlan} from "./core";
import {createPricePacket,type PriceOperation} from "./packet";
const require=createRequire(import.meta.url);
export function canonicalCurrentPriceSource(input:{projects:unknown[]}):CurrentProjectPrices[] {
 conversionAssert(Array.isArray(input.projects),"PRICE_REAL_PROJECT_SOURCE_REQUIRED");
 return input.projects.map(raw=>{const project=raw as CurrentProjectPrices;conversionAssert(project&&Array.isArray(project.products),"PRICE_REAL_NESTED_PRODUCTS_REQUIRED");return {id:project.id,number:project.number,title:project.title,currency:project.currency,createdAt:project.createdAt,initialPrice:project.initialPrice,delivery:project.delivery,unloading:project.unloading,installation:project.installation,products:project.products.map(product=>{conversionAssert(product.projectId===undefined||product.projectId===project.id,"PRICE_SOURCE_PRODUCT_RELATION_MISMATCH");return {id:product.id,projectId:project.id,number:product.number,title:product.title,quantity:product.quantity,expectedPrice:product.expectedPrice,initialPrice:product.initialPrice};})};});
}
export async function runRootPriceStep({target,revision,image,operation,directory}:{target:"local"|"staging";revision:string;image:string;operation:"inventory"|"plan"|"apply";directory:string}) {
 conversionAssert(["local","staging"].includes(target)&&/^[a-f0-9]{40}$/.test(revision)&&["inventory","plan","apply"].includes(operation)&&path.isAbsolute(directory),"PRICE_EXPLICIT_ROOT_STEP_REQUIRED");
 const outputDir=path.resolve(directory),allowed=path.join(acceptanceRoot,".playwright-mcp","round2");conversionAssert(outputDir.startsWith(allowed+path.sep),"PRICE_PRIVATE_DIRECTORY_REQUIRED");await mkdir(outputDir,{recursive:true});
 const {build}=createRequire(require.resolve("tsx/package.json"))("esbuild");const compiled=await build({entryPoints:[path.join(acceptanceWeb,"tests/byn-price-conversion-native.mjs")],bundle:true,write:false,platform:"node",format:"esm",target:"node22",external:["@prisma/client"],minify:true,tsconfig:path.join(acceptanceWeb,"tsconfig.json"),logLevel:"silent"});const bytes=Buffer.from(compiled.outputFiles[0].contents),transport=qaTransport({target,revision,outputDir});
 async function save(name:string,value:unknown){await writeFile(path.join(outputDir,name),JSON.stringify(value,null,2),{flag:"wx",mode:0o600});}
 async function execute(input:Record<string,unknown>){const {operation:priceOperation,...payload}=input;const packet=createPricePacket(priceOperation as PriceOperation,payload);conversionAssert(Buffer.byteLength(Buffer.from(JSON.stringify(packet)).toString("base64"))<=96*1024,"PRICE_INPUT_TRANSPORT_BOUNDS");return transport.execute(bytes,"inspect",packet);}
 if(operation==="inventory"){const result=await execute({operation:"inventory",revision,image});conversionAssert(result.body.status==="INVENTORIED","PRICE_INVENTORY_RECEIPT_REQUIRED");await save("original-manifest.private.json",result.body.manifest);return {status:"INVENTORIED",projects:result.body.manifest.source.length,outputDir,bundleSha256:bundleHash(bytes)};}
 const manifest=JSON.parse(await readFile(path.join(outputDir,"original-manifest.private.json"),"utf8")) as OriginalManifest;
 if(operation==="plan"){
  const requests=[...new Map(manifest.source.map(row=>[`${row.currency}:${projectCalendarDate(row.createdAt)}`,{currency:row.currency,date:projectCalendarDate(row.createdAt)}])).values()];
  const evidence=requests.length?await fetchHistoricalEvidence(requests):null;await save("official-fx.private.json",evidence);const rates=evidence?.rates??[];
  const result=await execute({operation:"seal",revision,image,manifest,rates});conversionAssert(result.body.status==="SEALED","PRICE_SEALED_RECEIPT_REQUIRED");const sealed=result.body.sealed as SealedPlan,plan=buildBynPricePlan(manifest.source,rates);conversionAssert(sealed.planHash===sha256(canonical(plan)),"PRICE_LOCAL_SEAL_HASH_MISMATCH");await save("sealed-plan.private.json",sealed);await save("canonical-report.private.json",{version:1,sourceStatus:"ACTUAL_TEST_DB_MANIFEST",sourceHash:sha256(canonical(manifest.source)),target,plan,officialCatalogRaw:evidence?.catalogRaw??null});return {status:"SEALED",projects:plan.projects.length,rows:plan.rows.length,outputDir};
 }
 const sealed=JSON.parse(await readFile(path.join(outputDir,"sealed-plan.private.json"),"utf8")) as SealedPlan;
 const result=await execute({operation:"apply",revision,image,manifest,sealed});conversionAssert(["APPLIED","ALREADY_APPLIED","NO_FOREIGN_PROJECTS"].includes(result.body.status)&&result.body.originalOtherData==="MATCH","PRICE_ACTUAL_APPLY_RECEIPT_REQUIRED");await save("apply-receipt.private.json",result.receipt);return {status:result.body.status,projects:result.body.projects,products:result.body.products,committed:result.body.committed,outputDir};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try{const [target,revision,image,operation,directory]=process.argv.slice(2);const result=await runRootPriceStep({target:target as "local"|"staging",revision,image,operation:operation as "inventory"|"plan"|"apply",directory});console.log(JSON.stringify(result));}
 catch(error){const message=error instanceof Error?error.message:"";console.log(JSON.stringify({status:"STOP",code:/^[A-Z0-9_]+$/.test(message)?message:"PRICE_COORDINATOR_STOP"}));process.exitCode=1;}
}
