// Отдельные подписанные варианты №19: исходники helpers №17/18 не меняются.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url)),web=path.resolve(here,'..');
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
export function replaceReviewedOnce(source,before,after){const first=source.indexOf(before);if(first<0||source.indexOf(before,first+before.length)>=0)throw Error('DESCRIPTION_QA_SOURCE_SEAM_CHANGED_STOP');return source.slice(0,first)+after+source.slice(first+before.length)}
export function descriptionSessionSource(source){
 source=replaceReviewedOnce(source,'PERO_CRM_PROJECT_INLINE_SESSION_V1','PERO_PRODUCT_DESCRIPTION_SESSION_V1');
 return replaceReviewedOnce(source,'const PREF_KEYS = ["projects.list", "project.tab"];','const PREF_KEYS = ["projects.list", "project.tab", "product.tab"];');
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
 const sources={'product-description-session.mjs':'project-inline-session.mjs','product-description-browser-fixtures.mjs':'product-inline-browser-fixtures.mjs'};
 if(!Object.hasOwn(sources,entry))throw Error('DESCRIPTION_QA_ENTRY_REQUIRED');const actual=path.join(here,sources[entry]);
 const result=await build({entryPoints:[actual],bundle:true,write:false,platform:'node',format:'esm',target:'node22',external:['@prisma/client'],minify:true,tsconfig:path.join(web,'tsconfig.json'),logLevel:'silent',plugins:[{name:'reviewed-description19-signed-scope',setup(builder){builder.onLoad({filter:/[\\/](?:project-inline-session|product-inline-browser-fixtures)\.mjs$/},async args=>{if(path.resolve(args.path)!==actual)throw Error('DESCRIPTION_QA_SOURCE_SCOPE_STOP');const raw=await readFile(actual,'utf8');return{contents:entry==='product-description-session.mjs'?descriptionSessionSource(raw):descriptionFixtureSource(raw),loader:'js',resolveDir:here}})}}]});
 const bytes=Buffer.from(result.outputFiles[0].contents);if(bytes.length>256*1024)throw Error('DESCRIPTION_QA_BUNDLE_LIMIT');return bytes;
}
