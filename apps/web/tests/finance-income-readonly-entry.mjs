// Existing-data readonly income acceptance. SAFETY: STOP guard mismatch, no writes/content/credentials persisted.
import {PrismaClient} from '@prisma/client';
import {encode} from '@auth/core/jwt';
import {hostname} from 'node:os';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import * as frozen from 'task113:frozen-library';
import {need,digest,canonical,signed,verifySignedFixture,fixtureStageGuard,FIXTURE_NAMESPACE as NS} from 'task113:protocol';
const hashes=()=>{need(typeof __INCOME_QA_SOURCE_HASHES__!=='undefined','REVIEWED_READONLY_INCOME_SOURCES_REQUIRED');return __INCOME_QA_SOURCE_HASHES__;};
const binding=input=>({namespace:NS,version:2,runId:input.runId,revision:input.revision});
async function chosen(tx){
 const users=await tx.$queryRawUnsafe('SELECT id::text id,roles::text[] roles,active,"sessionVersion"::int "sessionVersion" FROM "User" WHERE active=true AND roles::text[]=ARRAY[$1]::text[] ORDER BY id LIMIT 1','ADMIN');
 need(users.length===1&&users[0].active===true&&canonical(users[0].roles)==='["ADMIN"]','NO_CURRENT_ACTIVE_ADMIN_STOP_BEFORE_BROWSER');
 const docs=await tx.$queryRawUnsafe('SELECT p.id::text "paymentId",p."projectId"::text "projectId",d.id::text "documentId",d."fileName"::text "fileName",d."mimeType"::text "mimeType" FROM "Payment" p JOIN "FinanceDocument" d ON d.id=p."reportDocumentId" JOIN "Project" j ON j.id=p."projectId" WHERE p.direction::text=$1 AND d.state::text=$2 AND j."deletedAt" IS NULL ORDER BY CASE WHEN d."mimeType"=$3 THEN 0 ELSE 1 END,p.id LIMIT 1','INCOME','READY','application/pdf');
 need(docs.length===1,'NO_SUITABLE_READY_INCOME_STOP_BEFORE_BROWSER');
 const doc=docs[0];need(typeof doc.fileName==='string'&&doc.fileName.length>0&&doc.fileName.length<=512&&['projectId','documentId','paymentId'].every(k=>/^[A-Za-z0-9_-]{1,128}$/.test(doc[k])),'EXACT_BOUNDED_READY_INCOME_METADATA');
 return{admin:users[0],doc};
}
const summary=selection=>({adminIdSha256:digest(selection.admin.id),adminRoles:['ADMIN'],adminActive:true,projectIdSha256:digest(selection.doc.projectId),paymentIdSha256:digest(selection.doc.paymentId),documentIdSha256:digest(selection.doc.documentId),filenameSha256:digest(selection.doc.fileName),mimeType:selection.doc.mimeType});
async function before(db,input,secret){
 const state=await frozen.readonly(db,async tx=>({baseline:await frozen.original(tx),selection:await chosen(tx)}));
 const sealed=signed({...binding(input),kind:'income-readonly-before',baseline:state.baseline,selection:summary(state.selection),sources:hashes()},secret);
 const cookies=[];for(const name of ['__Secure-authjs.session-token','authjs.session-token']){
  const value=await encode({secret,salt:name,maxAge:900,token:{sub:state.selection.admin.id,id:state.selection.admin.id,roles:state.selection.admin.roles,sessionVersion:state.selection.admin.sessionVersion}});
  need(typeof value==='string'&&value.length>0&&value.length<=8192,'BOUNDED_MEMORY_ADMIN_JWT');cookies.push({name,value,url:'https://staging-crm.peromebel.by',secure:true,httpOnly:true,sameSite:'Lax'});
 }
 return{status:'READONLY_INCOME_BEFORE',before:sealed,memory:{adminId:state.selection.admin.id,roles:['ADMIN'],projectId:state.selection.doc.projectId,documentId:state.selection.doc.documentId,fileName:state.selection.doc.fileName,mimeType:state.selection.doc.mimeType,cookies},credentialsMemoryOnly:true};
}
async function after(db,input,secret){
 const old=input.before;verifySignedFixture(old,secret,'income-readonly-before',input);need(old.revision===input.revision&&input.beforeSha256===digest(old)&&canonical(old.sources)===canonical(hashes()),'EXACT_SIGNED_READONLY_INCOME_BEFORE');
 const current=await frozen.readonly(db,async tx=>({baseline:await frozen.original(tx),selection:await chosen(tx)}));
 need(canonical(summary(current.selection))===canonical(old.selection),'EXISTING_READY_INCOME_OR_ADMIN_CHANGED');
 const verification=frozen.compareOriginal(old.baseline,current.baseline);
 return{status:'READONLY_INCOME_CLOSED',proof:signed({...binding(input),kind:'income-readonly-closed',beforeSha256:digest(old),selection:old.selection,verification,sources:hashes(),upstreamWrites:0},secret)};
}
async function main(){let db,result;try{
 const raw=process.env.CRM_STAGING_BROWSER_INPUT;need(typeof raw==='string'&&raw.length>0&&raw.length<=96*1024,'BOUNDED_READONLY_INCOME_INPUT');
 const input=JSON.parse(Buffer.from(raw,'base64').toString('utf8')),guard=fixtureStageGuard(input,process.env,{host:hostname(),docker:existsSync('/.dockerenv')});need(input.operation==='inspect'&&['income-before','income-after','income-metadata'].includes(input.mode),'READONLY_INCOME_INSPECT_ONLY');hashes();
 db=new PrismaClient({log:[],errorFormat:'minimal'});if(input.mode==='income-metadata'){const selection=await frozen.readonly(db,chosen);result={status:'EXISTING_READY_INCOME_AVAILABLE',selection:summary(selection),sources:hashes(),databaseReadOnly:true,credentialsMinted:false};}else result=input.mode==='income-before'?await before(db,input,guard.secret):await after(db,input,guard.secret);
 need(Buffer.byteLength(JSON.stringify(result))<=64*1024,'READONLY_INCOME_REPLY_CAP');
 }catch(error){result={status:'STOP_BEFORE_BROWSER_OR_PRESERVE',code:/^[A-Z0-9_]{1,100}$/.test(error?.message??'')?error.message:'READONLY_INCOME_REJECTED'};process.exitCode=1;}
 finally{await db?.$disconnect();}console.log(JSON.stringify(result));}
const entry=process.argv[1];if((!entry||path.resolve(entry)===fileURLToPath(import.meta.url))&&process.env.CRM_STAGING_BROWSER_INPUT&&process.env.CRM_MODERNIZATION_TARGET==='staging')void main();
