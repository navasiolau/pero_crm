// Подписанная область №19 использует общий session-код с отдельной фиксированной политикой.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {hostname} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url)),web=path.resolve(here,'..');
function qaEsbuild(){const require=createRequire(import.meta.url);return createRequire(require.resolve('tsx/package.json'))('esbuild');}
const nativeFamilies={
 'project-inline':{tx:'Project',schemas:['projects/project-field-core.ts','projects/patch-contract.ts','projects/stage-contract.ts','clients/core.ts'],targetError:'EXPLICIT_LOCAL_STAGING_TARGET_REQUIRED'},
 'product-inline':{tx:'Inline',factories:['object','string','number','enum','literal','uuid','discriminatedUnion'],targetError:'EXPLICIT_LOCAL_OR_STAGING_TARGET_REQUIRED'},
 'product-description':{tx:'Description',schemas:['products/core.ts','products/patch-contract.ts','clients/core.ts'],targetError:'EXPLICIT_TARGET_REQUIRED'},
 'product-attachments':{tx:'Attachments',schemas:['product-percentage-pay/core.ts','files/upload-context.ts'],targetError:'EXPLICIT_TARGET_REQUIRED'},
};
// Те же четыре закрытые области native; общий код не создаёт Prisma-клиент.
function nativeFamily(kind){const family=nativeFamilies[kind];if(!family)throw Error('NATIVE_FAMILY_REQUIRED');return family;}
export function modernizationNativeGuard(kind){
 const family=nativeFamily(kind),target=process.env.CRM_MODERNIZATION_TARGET,url=new URL(process.env.DATABASE_URL??'');
 assert.equal(url.protocol,'postgresql:');assert.ok(!url.hash);
 if(kind!=='product-inline'){
  const options=new Set(['schema','connection_limit','pool_timeout','connect_timeout','socket_timeout','sslmode']);
  assert.ok([...url.searchParams.keys()].every(key=>options.has(key)),kind==='project-inline'?'DATABASE_OPTIONS_NOT_ALLOWLISTED':undefined);
  assert.ok([...url.searchParams.keys()].every(key=>url.searchParams.getAll(key).length===1),kind==='project-inline'?'DUPLICATE_DATABASE_OPTION':undefined);
 }
 assert.ok(!url.searchParams.has('schema')||url.searchParams.get('schema')==='public');
 if(target==='local'){
  assert.equal(process.platform,'win32');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.port,'5433');assert.equal(url.pathname,'/pero_crm');
 }else if(target==='staging'){
  assert.ok(existsSync('/.dockerenv')&&/^[a-f0-9]{12,64}$/.test(hostname()));assert.equal(url.hostname,'db');assert.equal(url.port||'5432','5432');assert.equal(url.pathname,'/crm');assert.equal(process.env.S3_BUCKET,'pero-crm-staging');
  const proof=JSON.parse(process.env.CRM_MODERNIZATION_STAGE_PROOF??'');assert.equal(proof.hostname,'crm-staging');assert.match(proof.revision,/^[a-f0-9]{40}$/);assert.equal(proof.databaseVolume,'crm-staging_pgdata');assert.match(proof.outerW07Sha256,/^[a-f0-9]{64}$/);assert.ok(proof.web&&proof.database);
 }else throw Error(family.targetError);
 return target;
}
export async function modernizationNativeFingerprint(db,tables,omitTokenClock=true){
 const result={};
 for(const table of tables){
  assert.match(table,/^[A-Za-z_][A-Za-z0-9_]*$/);
  const projection=omitTokenClock&&table==='ApiToken'?"(to_jsonb(t)-'lastUsedAt')::text":'row_to_json(t)::text';
  const [row]=await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(${projection},'' ORDER BY ${projection}),'')) AS hash FROM "${table}" t`);result[table]=row;
 }
 return result;
}
export async function buildModernizationNative(kind,out){
 const family=nativeFamily(kind),{build}=qaEsbuild();
 if(!out)throw Error('EXPLICIT_BUNDLE_OUTPUT_PATH_REQUIRED');out=path.resolve(out);
 const factories=family.factories??[...new Set(family.schemas.flatMap(file=>[...readFileSync(path.join(web,'src/server',file),'utf8').matchAll(/\bz\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(match=>match[1])))].filter(name=>!['infer','input','output'].includes(name)&&!name.startsWith('Zod')).sort();
 const imports=factories.map(name=>name==='enum'?'enum as enumeration':name).join(','),properties=factories.map(name=>name==='enum'?'enum:enumeration':name).join(',');
 const proxySource=`export const prisma = new Proxy({}, { get(_target, name) {
 const tx = globalThis.__crm${family.tx}Tx;
 if (!tx) throw new Error("NATIVE_OUTER_TRANSACTION_REQUIRED");
 if (name === "$transaction") return async operation => {
   if (typeof operation !== "function") throw new Error("NATIVE_CALLBACK_TRANSACTION_ONLY");
   const boundary = globalThis.__crm${family.tx}Transaction;
   if (typeof boundary !== "function") throw new Error("NATIVE_SAVEPOINT_BOUNDARY_REQUIRED");
   return boundary(operation);
 };
 const value = tx[name]; return typeof value === "function" ? value.bind(tx) : value;
} });`;
 const result=await build({entryPoints:[path.join(here,kind+'-native.mjs')],outfile:out,metafile:true,bundle:true,platform:'node',format:'esm',target:'node22',external:['@prisma/client'],minify:true,tsconfig:path.join(web,'tsconfig.json'),plugins:[{name:'outer-transaction-and-external-effects',setup(builder){
  builder.onResolve({filter:/^zod$/},()=>({path:'zod-domain-factories',namespace:'native-zod'}));
  builder.onLoad({filter:/.*/,namespace:'native-zod'},()=>({loader:'js',resolveDir:web,contents:`import {${imports}} from "zod/v4"; export const z={${properties}};`}));
  builder.onResolve({filter:/^(@\/lib\/prisma|next\/cache|@\/server\/notifications\/notify|@\/server\/plugins\/events)$/},args=>({path:args.path,namespace:'native-stubs'}));
  builder.onLoad({filter:/.*/,namespace:'native-stubs'},args=>({loader:'js',contents:args.path==='@/lib/prisma'?proxySource:args.path==='next/cache'?'export const revalidatePath = () => {};':args.path.includes('notifications')?'export const notifyOrg = async () => {}; export const notifyPerson = async () => {}; export const notifyUser = async () => {};':`import { prisma } from "@/lib/prisma"; export async function emitDomainEvent(type,payload,actor) { await prisma.domainEvent.create({data:{type,payload,actor}}); } export const dispatchEvent = async () => {};`}));
 }}]});
 const bytes=readFileSync(out);if(bytes.length>256*1024)throw Error('REVIEWED_NATIVE_BUNDLE_LIMIT_EXCEEDED');
 return{kind:kind+'-native-bundle',out,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),dbExecuted:false,...(family.schemas?{zodFactories:factories}:{}),largestInputs:Object.entries(Object.values(result.metafile.outputs)[0].inputs).sort((a,b)=>b[1].bytesInOutput-a[1].bytesInOutput).slice(0,15).map(([file,info])=>({path:file,bytes:info.bytesInOutput}))};
}
export function replaceReviewedOnce(source,before,after){const first=source.indexOf(before);if(first<0||source.indexOf(before,first+before.length)>=0)throw Error('DESCRIPTION_QA_SOURCE_SEAM_CHANGED_STOP');return source.slice(0,first)+after+source.slice(first+before.length)}
export function descriptionSessionSource(source){
 return replaceReviewedOnce(source,'const SESSION_SCOPE = typeof __QA_SESSION_POLICY__ === "undefined" ? "modernization" : __QA_SESSION_POLICY__;','const SESSION_SCOPE = "description";');
}
export function descriptionFixtureSource(source){
 source=replaceReviewedOnce(source,'PERO_PRODUCT_INLINE_BROWSER_FIXTURES_V2','PERO_PRODUCT_DESCRIPTION_BROWSER_FIXTURES_V1');
 const binding=`function descriptionSessionProfiles(session,secret){
 const namespace='PERO_PRODUCT_DESCRIPTION_SESSION_V1';requireThat(session?.namespace===namespace&&session.version===1&&/^[a-f0-9]{64}$/.test(session.signature??''),'DESCRIPTION_SESSION_CHECKPOINT_REQUIRED');
 const unsigned={...session};delete unsigned.signature;const expected=createHmac('sha256',secret).update(namespace+'\\0').update(canonical(unsigned)).digest('hex');requireThat(timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(session.signature,'hex')),'DESCRIPTION_SESSION_SIGNATURE_MISMATCH');
 requireThat(session.profiles?.admin&&session.profiles?.manager&&session.profiles?.engineer,'DESCRIPTION_SESSION_CORE_PROFILES_REQUIRED');return session.profiles;
}
`;
 source=replaceReviewedOnce(source,'async function prepare(db,input,target,secret){',binding+'async function prepare(db,input,target,secret){');
 source=replaceReviewedOnce(source,"Object.keys(input).sort().join('|')==='operation|runId','PREPARE_INPUT_INVALID');return db.$transaction", "Object.keys(input).sort().join('|')==='operation|runId|sessionCheckpoint','PREPARE_INPUT_INVALID');const profiles=descriptionSessionProfiles(input.sessionCheckpoint,secret);return db.$transaction");
 const start="const users=await tx.user.findMany({where:{active:true},select:{id:true,name:true,roles:true},orderBy:{id:'asc'}});",end='const ids=Object.fromEntries';
 const first=source.indexOf(start),last=source.indexOf(end,first);if(first<0||last<0||source.indexOf(start,first+start.length)>=0||source.indexOf(end,last+end.length)>=0)throw Error('DESCRIPTION_FIXTURE_ACTOR_SOURCE_CHANGED_STOP');
 const actors=`const users=await tx.user.findMany({where:{id:{in:Object.values(profiles).map(row=>row.id)}},select:{id:true,name:true,roles:true,active:true}}),actors={};for(const[key,profile]of Object.entries(profiles)){const user=users.find(row=>row.id===profile.id);requireThat(user?.active&&canonical([...user.roles].sort())===canonical([...profile.roles].sort()),'DESCRIPTION_SESSION_ACTOR_CHANGED_STOP');actors[key]={id:user.id,name:user.name,roles:user.roles};}const engineer=actors.engineer,combined=actors.combined;`;
 source=source.slice(0,first)+actors+source.slice(last);
 source=replaceReviewedOnce(source,"descriptionA:'QA техническое описание',", "descriptionA:'QA техническое описание',descriptionB:' \\t\\r\\n\\r\\n',");
 source=replaceReviewedOnce(source,'description:initial.descriptionA,status:',"description:key==='productA'?initial.descriptionA:initial.descriptionB,status:");
 source=replaceReviewedOnce(source,'runId:input.runId,target,ids,actors,initial,numbers,baseline,originalRows:', 'runId:input.runId,target,sessionCheckpointHash:hash(input.sessionCheckpoint),ids,actors,initial,numbers,baseline,originalRows:');
 source=replaceReviewedOnce(source,"const mutable={clients:['phone','updatedAt'],projects:['clientId','address','updatedAt'],products:['title','kind','description','engineerId','quantity','expectedPrice','status','statusChangedAt','updatedAt']};","const mutable={clients:[],projects:[],products:['description','updatedAt']};");
 source=replaceReviewedOnce(source,"requireThat(['DESIGN','RECLAMATION'].includes(actual.status),'FROZEN_STATUS_FORBIDDEN_STOP')","requireThat(actual.status==='DESIGN','FROZEN_STATUS_FORBIDDEN_STOP')");
 source=replaceReviewedOnce(source,"requireThat(logs.every(row=>row.action==='inline.update'||row.action==='update'||(row.action==='status'&&row.oldValue==='DESIGN'&&row.newValue==='RECLAMATION')),'UNEXPECTED_OWNED_AUDIT_STOP');","requireThat(logs.every(row=>row.action==='inline.update'&&row.field==='description'),'UNEXPECTED_OWNED_AUDIT_STOP');");
 source=replaceReviewedOnce(source,"['product.updated','product.statusChanged','project.updated','client.updated'].includes(row.type)","row.type==='product.updated'");
 source=replaceReviewedOnce(source,"requireThat(histories.every(row=>row.fromStatus==='DESIGN'&&row.toStatus==='RECLAMATION'&&actorIds.includes(row.changedById)),'UNEXPECTED_STATUS_HISTORY_STOP');","requireThat(histories.length===0,'UNEXPECTED_STATUS_HISTORY_STOP');");
 source=replaceReviewedOnce(source,"requireThat(notifications.every(row=>row.type==='product.statusChanged'),'UNEXPECTED_OWNED_NOTIFICATION_STOP');","requireThat(notifications.length===0,'UNEXPECTED_OWNED_NOTIFICATION_STOP');");
 return source;
}
export async function bundleProductDescriptionQa(entry){
 const {build}=qaEsbuild();
 const sources={'product-description-session.mjs':'crm-modernization-session.mjs','product-description-browser-fixtures.mjs':'product-inline-browser-fixtures.mjs'};
 if(!Object.hasOwn(sources,entry))throw Error('DESCRIPTION_QA_ENTRY_REQUIRED');const actual=path.join(here,sources[entry]);
 const result=await build({entryPoints:[actual],bundle:true,write:false,platform:'node',format:'esm',target:'node22',external:['@prisma/client'],minify:true,tsconfig:path.join(web,'tsconfig.json'),logLevel:'silent',plugins:[{name:'reviewed-description19-signed-scope',setup(builder){builder.onLoad({filter:/[\\/](?:crm-modernization-session|product-inline-browser-fixtures)\.mjs$/},async args=>{if(path.resolve(args.path)!==actual)throw Error('DESCRIPTION_QA_SOURCE_SCOPE_STOP');const raw=await readFile(actual,'utf8');return{contents:entry==='product-description-session.mjs'?descriptionSessionSource(raw):descriptionFixtureSource(raw),loader:'js',resolveDir:here}})}}]});
 const bytes=Buffer.from(result.outputFiles[0].contents);if(bytes.length>256*1024)throw Error('DESCRIPTION_QA_BUNDLE_LIMIT');return bytes;
}
