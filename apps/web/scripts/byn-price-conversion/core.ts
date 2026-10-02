import {Prisma,type PrismaClient} from "@prisma/client";
import {createHmac,timingSafeEqual,randomUUID} from "node:crypto";
import {hostname} from "node:os";
import {existsSync} from "node:fs";
import {buildBynPricePlan,canonical,classifyConversionState,conversionAssert,sha256,PROJECT_MONEY_FIELDS,PRODUCT_MONEY_FIELDS,type CurrentProjectPrices,type HistoricalRate} from "./planner";
const NS="PERO_TEST_BYN_PRICES_V1";
export const PRICE_FINGERPRINT_PROFILE="ALL_PUBLIC_TABLES_APITOKEN_LASTUSEDAT_ONLY_V2";
export type TestBinding={target:"local"|"staging";revision:string;hostname:string;image:string;database:string;databaseVolume:string};
type Fingerprints=Record<string,{count:string;hash:string}>;
export type OriginalManifest={namespace:typeof NS;kind:"original";version:2;fingerprintProfile:typeof PRICE_FINGERPRINT_PROFILE;runId:string;binding:TestBinding;source:CurrentProjectPrices[];fingerprints:Fingerprints;signature:string};
export type SealedPlan={namespace:typeof NS;kind:"plan";manifestHash:string;planHash:string;rates:HistoricalRate[];signature:string};
function unsigned<T extends {signature:string}>(value:T){const body={...value};delete (body as Partial<T>).signature;return body;}
function sign(value:unknown,secret:string){conversionAssert(typeof secret==="string"&&secret.length>=16,"PRICE_SIGNING_SECRET_REQUIRED");return createHmac("sha256",secret).update(`${NS}\0`).update(canonical(value)).digest("hex");}
function verify(value:OriginalManifest|SealedPlan,kind:"original"|"plan",secret:string){conversionAssert(value?.namespace===NS&&value.kind===kind&&/^[a-f0-9]{64}$/.test(value.signature??""),"PRICE_SIGNED_SCOPE_REQUIRED");conversionAssert(timingSafeEqual(Buffer.from(value.signature,"hex"),Buffer.from(sign(unsigned(value),secret),"hex")),"PRICE_SIGNATURE_MISMATCH");if(kind==="original"){const manifest=value as OriginalManifest;conversionAssert(manifest.version===2&&manifest.fingerprintProfile===PRICE_FINGERPRINT_PROFILE,"PRICE_FINGERPRINT_PROFILE_REQUIRED");}}
export function priceTargetBinding(input:{revision:string;image:string},env:Record<string,string|undefined>=process.env,platform=process.platform,host=hostname(),docker=existsSync("/.dockerenv")):TestBinding {
 conversionAssert(env.CRM_MODERNIZATION_TARGET==="local"||env.CRM_MODERNIZATION_TARGET==="staging","PRICE_TEST_TARGET_ONLY");
 conversionAssert(/^[a-f0-9]{40}$/.test(input.revision??""),"PRICE_EXPECTED_REVISION_REQUIRED");
 let url:URL;try{url=new URL(env.DATABASE_URL??"");}catch{throw Error("PRICE_DB_URL_REQUIRED");}
 conversionAssert(["postgresql:","postgres:"].includes(url.protocol)&&!url.hash&&[...url.searchParams.keys()].every(key=>["schema","connection_limit","pool_timeout","connect_timeout","socket_timeout","sslmode"].includes(key)&&url.searchParams.getAll(key).length===1)&&(!url.searchParams.has("schema")||url.searchParams.get("schema")==="public"),"PRICE_DB_ADDRESS_STOP");
 if(env.CRM_MODERNIZATION_TARGET==="local") {conversionAssert(platform==="win32"&&["localhost","127.0.0.1"].includes(url.hostname)&&url.port==="5433"&&url.pathname==="/pero_crm"&&input.image==="local-node","PRICE_LOCAL_GUARD_STOP");return {target:"local",revision:input.revision,hostname:host,image:"local-node",database:"pero_crm",databaseVolume:"existing-local-5433"};}
 let proof:Record<string,unknown>;try{proof=JSON.parse(env.CRM_MODERNIZATION_STAGE_PROOF??"");}catch{throw Error("PRICE_OUTER_STAGE_PROOF_REQUIRED");}
 conversionAssert(docker&&/^[a-f0-9]{12,64}$/.test(host)&&url.hostname==="db"&&(url.port===""||url.port==="5432")&&url.pathname==="/crm"&&env.S3_BUCKET==="pero-crm-staging"&&proof.hostname==="crm-staging"&&proof.revision===input.revision&&proof.image===input.image&&/^sha256:[a-f0-9]{64}$/.test(input.image)&&proof.databaseVolume==="crm-staging_pgdata"&&/^[a-f0-9]{64}$/.test(String(proof.outerW07Sha256??""))&&typeof proof.web==="string"&&typeof proof.database==="string","PRICE_STAGE_GUARD_STOP");
 return {target:"staging",revision:input.revision,hostname:host,image:input.image,database:"crm",databaseVolume:"crm-staging_pgdata"};
}
async function dbGuard(tx:Prisma.TransactionClient,binding:TestBinding){const [row]=await tx.$queryRawUnsafe<{database:string;schema:string}[]>("SELECT current_database() AS database,current_schema() AS schema");conversionAssert(row?.database===binding.database&&row.schema==="public","PRICE_ACTUAL_DB_IDENTITY_STOP");}
async function sourceRows(tx:Prisma.TransactionClient,ids?:string[]):Promise<CurrentProjectPrices[]> {
 const projects=await tx.project.findMany({where:ids?{id:{in:ids}}:{currency:{not:"BYN"}},select:{id:true,number:true,title:true,currency:true,createdAt:true,initialPrice:true,delivery:true,unloading:true,installation:true,products:{select:{id:true,projectId:true,number:true,title:true,quantity:true,expectedPrice:true,initialPrice:true},orderBy:{id:"asc"}}},orderBy:{id:"asc"}});
 conversionAssert(projects.length<=200&&projects.reduce((count,row)=>count+row.products.length,0)<=1000,"PRICE_INVENTORY_BOUNDS");
 return projects.map(project=>({...project,createdAt:project.createdAt.toISOString(),initialPrice:project.initialPrice?.toString()??null,delivery:project.delivery?.toString()??null,unloading:project.unloading?.toString()??null,installation:project.installation?.toString()??null,products:project.products.map(product=>({...product,expectedPrice:product.expectedPrice?.toString()??null,initialPrice:product.initialPrice?.toString()??null}))}));
}
async function fingerprints(tx:Prisma.TransactionClient,source:CurrentProjectPrices[]):Promise<Fingerprints> {
 const projectIds=source.map(row=>row.id),productIds=source.flatMap(row=>row.products.map(product=>product.id)),result:Fingerprints={};
 const tables=await tx.$queryRawUnsafe<{tablename:string}[]>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");conversionAssert(tables.length>0&&tables.length<=200&&Object.values(Prisma.ModelName).every(name=>tables.some(row=>row.tablename===name))&&tables.some(row=>row.tablename==="_prisma_migrations"),"PRICE_ALL_MODEL_TABLES_REQUIRED");
 for(const {tablename:table} of tables){conversionAssert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(table),"PRICE_MODEL_IDENTIFIER_STOP");const ids=table==="Project"?projectIds:table==="Product"?productIds:[],fields=table==="Project"?["currency",...PROJECT_MONEY_FIELDS,"updatedAt"]:table==="Product"?[...PRODUCT_MONEY_FIELDS,"updatedAt"]:[];
  // Только явно выбранные rows теряют разрешённые текущие поля из сравнения.
  const expression=table==="ApiToken"?"(to_jsonb(t) - 'lastUsedAt')::text":ids.length?`CASE WHEN t.id IN (${ids.map((_,index)=>`$${index+1}`).join(",")}) THEN (to_jsonb(t) - ARRAY[${fields.map(field=>`'${field}'`).join(",")}])::text ELSE row_to_json(t)::text END`:"row_to_json(t)::text";
  const [row]=await tx.$queryRawUnsafe<{count:string;hash:string}[]>(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(${expression},'' ORDER BY ${expression}),'')) AS hash FROM "${table}" t`,...ids);conversionAssert(row&&/^\d+$/.test(row.count)&&/^[a-f0-9]{32}$/.test(row.hash),"PRICE_FINGERPRINT_INVALID");result[table]=row;
 }
 return result;
}
export async function inventoryPrices(db:PrismaClient,binding:TestBinding,secret:string):Promise<OriginalManifest> {
 return db.$transaction(async tx=>{await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");await dbGuard(tx,binding);const source=await sourceRows(tx),body:Omit<OriginalManifest,"signature">={namespace:NS,kind:"original",version:2,fingerprintProfile:PRICE_FINGERPRINT_PROFILE,runId:randomUUID(),binding,source,fingerprints:await fingerprints(tx,source)};return {...body,signature:sign(body,secret)};},{isolationLevel:"RepeatableRead",maxWait:10000,timeout:120000});
}
export function sealPricePlan(manifest:OriginalManifest,rates:HistoricalRate[],binding:TestBinding,secret:string):SealedPlan {
 verify(manifest,"original",secret);conversionAssert(canonical(manifest.binding)===canonical(binding),"PRICE_MANIFEST_TARGET_CHANGED");const plan=buildBynPricePlan(manifest.source,rates),body:Omit<SealedPlan,"signature">={namespace:NS,kind:"plan",manifestHash:sha256(canonical(manifest)),planHash:sha256(canonical(plan)),rates:plan.rates};return {...body,signature:sign(body,secret)};
}
export async function applyPricePlan(db:PrismaClient,manifest:OriginalManifest,sealed:SealedPlan,binding:TestBinding,secret:string) {
 verify(manifest,"original",secret);verify(sealed,"plan",secret);const plan=buildBynPricePlan(manifest.source,sealed.rates);conversionAssert(canonical(manifest.binding)===canonical(binding)&&sealed.manifestHash===sha256(canonical(manifest))&&sealed.planHash===sha256(canonical(plan)),"PRICE_PLAN_BINDING_OR_CONTENT_CHANGED");
 return db.$transaction(async tx=>{
  await dbGuard(tx,binding);await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,46001)`;
  for(const project of manifest.source){await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${project.id} FOR UPDATE`;for(const product of project.products)await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${product.id} FOR UPDATE`;}
  conversionAssert(canonical(await fingerprints(tx,manifest.source))===canonical(manifest.fingerprints),"PRICE_OTHER_DATA_CHANGED_STOP");
  if(!manifest.source.length)return {status:"NO_FOREIGN_PROJECTS",committed:false,projects:0,products:0,originalOtherData:"MATCH",planHash:sealed.planHash};
  const state=classifyConversionState(plan,await sourceRows(tx,manifest.source.map(row=>row.id)));if(state==="AFTER")return {status:"ALREADY_APPLIED",committed:false,projects:manifest.source.length,products:manifest.source.reduce((count,row)=>count+row.products.length,0),originalOtherData:"MATCH",planHash:sealed.planHash};
  const timestamp=new Date();
  for(const project of plan.projects){const changed=await tx.project.updateMany({where:{id:project.before.id,currency:project.before.currency,initialPrice:project.before.initialPrice,delivery:project.before.delivery,unloading:project.before.unloading,installation:project.before.installation},data:{currency:"BYN",initialPrice:project.after.initialPrice,delivery:project.after.delivery,unloading:project.after.unloading,installation:project.after.installation,updatedAt:timestamp}});conversionAssert(changed.count===1,"PRICE_PROJECT_CAS_STOP");
   for(const product of project.before.products){const after=project.after.products.find(row=>row.id===product.id)!;const changedProduct=await tx.product.updateMany({where:{id:product.id,projectId:product.projectId,quantity:product.quantity,expectedPrice:product.expectedPrice,initialPrice:product.initialPrice},data:{expectedPrice:after.expectedPrice,initialPrice:after.initialPrice,updatedAt:timestamp}});conversionAssert(changedProduct.count===1,"PRICE_PRODUCT_CAS_STOP");}
  }
  conversionAssert(classifyConversionState(plan,await sourceRows(tx,manifest.source.map(row=>row.id)))==="AFTER"&&canonical(await fingerprints(tx,manifest.source))===canonical(manifest.fingerprints),"PRICE_POST_APPLY_VERIFICATION_STOP");
  const [version]=await tx.$queryRaw<{pricingVersion:string}[]>`SELECT txid_current()::text AS "pricingVersion"`;conversionAssert(/^\d+$/.test(version?.pricingVersion??""),"PRICE_TRANSACTION_VERSION_REQUIRED");
  return {status:"APPLIED",committed:true,projects:manifest.source.length,products:manifest.source.reduce((count,row)=>count+row.products.length,0),originalOtherData:"MATCH",planHash:sealed.planHash,pricingVersion:version.pricingVersion,updatedAt:timestamp.toISOString()};
 },{isolationLevel:"Serializable",maxWait:10000,timeout:120000});
}
