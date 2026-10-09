// Fresh-owned producer113/115/116; root-only. Import/build has no side effects.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP on mismatch.
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {hostname} from 'node:os';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {PrismaClient} from '@prisma/client';
import {encode} from '@auth/core/jwt';
import sharp from 'sharp';
import {S3Client,ListObjectVersionsCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {captureTokenClockEvidence,compareTokenClockEvidence} from './crm-acceptance-token-clock.mjs';
import {FIXTURE_NAMESPACE as NS,DISABLED_PASSWORD,CLEANUP_ORDER,need,canonical,digest,sha,signed,verifySignedFixture,newFixturePlan,validatePlan,ownFileKey,ownFinanceKey,validateStorageVersions,cleanupIntent,compareFileDelete,fixtureStageGuard,preferencePairs,handoffSubjects,compareCurrentHandoff,publicDeleteMetadata} from './file-fixture113-protocol.mjs';
const tableModels={User:'user',Client:'client',Project:'project',Product:'product',Task:'task',CashAccount:'cashAccount',ExpenseArticle:'expenseArticle',Payment:'payment',FinanceDocument:'financeDocument',File:'file',ChangeLog:'changeLog',Notification:'notification',DomainEvent:'domainEvent',UserPreference:'userPreference'};
const MAX_OUTPUT=64*1024,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
let phase='guard';
const plain=value=>JSON.parse(JSON.stringify(value));
function quote(value){need(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value),'TABLE_IDENTIFIER_REQUIRED');return '"'+value+'"';}
function bind(ids){need(Array.isArray(ids)&&ids.length<=200&&ids.every(id=>typeof id==='string'&&id.length<=160),'BOUNDED_SCALAR_IDS');return ids.map((_,i)=>'$'+(i+1)).join(',');}
async function fingerprint(tx,query,args=[]){
 need(args.every(value=>['string','number','boolean'].includes(typeof value)||value===null),'SQL_SCALAR_ONLY');
 const rows=await tx.$queryRawUnsafe("SELECT count(*)::text count,encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') hash FROM (SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h FROM ("+query+") r) q",...args);
 need(rows.length===1&&/^\d+$/.test(rows[0].count)&&HASH.test(rows[0].hash),'SINGLE_FINGERPRINT_REQUIRED');return rows[0];
}
async function original(tx,scope={},actors=[]){
 const[identity]=await tx.$queryRawUnsafe("SELECT current_database()::text name,current_schema()::text schema,current_setting('transaction_read_only')::text readonly");need(identity.name==='crm'&&identity.schema==='public','DATABASE_IDENTITY_REQUIRED');
 const tables=(await tx.$queryRawUnsafe("SELECT tablename::text name FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>row.name);need(tables.length>30&&tables.length<150,'PUBLIC_TABLE_COUNT_REQUIRED');
 const fingerprints={};for(const table of tables){const ids=scope[table]??[],column=table==='UserPreference'&&actors.length?'userId':'id',values=column==='userId'?actors:ids;fingerprints[table]=await fingerprint(tx,'SELECT t.* FROM '+quote(table)+' t'+(values.length?' WHERE '+quote(column)+' NOT IN ('+bind(values)+')':''),values);}
 const schema={
  columns:await fingerprint(tx,"SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_schema,udt_name,is_identity,is_generated,generation_expression FROM information_schema.columns WHERE table_schema='public'"),
  constraints:await fingerprint(tx,"SELECT r.relname,c.conname,c.contype,pg_get_constraintdef(c.oid,true) definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public'"),
  indexes:await fingerprint(tx,"SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'"),
  types:await fingerprint(tx,"SELECT t.* FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'"),
  triggers:await fingerprint(tx,"SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'"),
 };
 const tokenClock=await captureTokenClockEvidence(tx);need(canonical(tokenClock.full)===canonical(fingerprints.ApiToken),'TOKEN_CLOCK_FULL_COHERENCE');
 const[bot]=await tx.$queryRawUnsafe("SELECT encode(sha256(convert_to(to_jsonb(value)::text,'UTF8')),'hex') \"valueHash\",encode(sha256(convert_to((to_jsonb(t)-'updatedAt')::text,'UTF8')),'hex') \"stableHash\",to_char(\"updatedAt\",'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') \"updatedAt\" FROM \"OrgSetting\" t WHERE key=$1",'telegram.botUsername');
 const otherOrg=await fingerprint(tx,'SELECT t.* FROM "OrgSetting" t WHERE key<>$1',['telegram.botUsername']);
 return {tables,fingerprints,schema,tokenClock,org:{bot:bot??null,other:otherOrg}};
}
export function compareOriginal(before,after){
 need(canonical(before.tables)===canonical(after.tables)&&canonical(before.schema)===canonical(after.schema),'ORIGINAL_SCHEMA_OR_MODEL_SET_CHANGED');
 need(canonical(before.tokenClock?.full)===canonical(before.fingerprints.ApiToken)&&canonical(after.tokenClock?.full)===canonical(after.fingerprints.ApiToken),'TOKEN_CLOCK_TABLE_INCOHERENT');
 const tokens=compareTokenClockEvidence(before.tokenClock,after.tokenClock);
 need(canonical(before.org.other)===canonical(after.org.other)&&before.fingerprints.OrgSetting.count===after.fingerprints.OrgSetting.count,'ORIGINAL_SETTINGS_CHANGED');
 let botClock=false;const old=before.org.bot,current=after.org.bot;
 if(!old||!current)need(old===current,'BOT_SETTING_ADDED_REMOVED');
 else{need(old.valueHash===current.valueHash&&old.stableHash===current.stableHash&&Date.parse(current.updatedAt)>=Date.parse(old.updatedAt)&&Date.parse(current.updatedAt)<=Date.parse(after.tokenClock.capturedAt),'BOT_STABLE_OR_CLOCK_CHANGED');botClock=old.updatedAt!==current.updatedAt;}
 for(const name of before.tables)if(!['ApiToken','OrgSetting'].includes(name))need(canonical(before.fingerprints[name])===canonical(after.fingerprints[name]),'ORIGINAL_ROWS_CHANGED_'+name);
 if(!botClock)need(canonical(before.fingerprints.OrgSetting)===canonical(after.fingerprints.OrgSetting),'UNEXPLAINED_ORG_DRIFT');
 return {originalRelationsMatch:true,preferencesUntouched:true,tokenClockValid:tokens.valid,tokenClockChanged:tokens.changed,botClockChanged:botClock};
}
function client(){return new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION??'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY,secretAccessKey:process.env.S3_SECRET_KEY}});}
async function storage(s3,ownKeys=[]){
 const rows=[];let KeyMarker,VersionIdMarker;
 do{const page=await s3.send(new ListObjectVersionsCommand({Bucket:'pero-crm-staging',KeyMarker,VersionIdMarker}));for(const item of page.Versions??[])rows.push({key:item.Key,versionId:item.VersionId??'null',deleteMarker:false,latest:item.IsLatest===true,etag:item.ETag??null,size:item.Size??null});for(const item of page.DeleteMarkers??[])rows.push({key:item.Key,versionId:item.VersionId??'null',deleteMarker:true,latest:item.IsLatest===true,etag:null,size:null});need(rows.length<=100000,'VERSION_INVENTORY_LIMIT');if(!page.IsTruncated)break;need(page.NextKeyMarker&&page.NextKeyMarker!==KeyMarker,'VERSION_PAGE_STALLED');KeyMarker=page.NextKeyMarker;VersionIdMarker=page.NextVersionIdMarker;}while(true);
 rows.sort((a,b)=>canonical(a).localeCompare(canonical(b)));const own=rows.filter(row=>ownKeys.includes(row.key));validateStorageVersions(own,ownKeys);
 return {originalHash:digest(rows.filter(row=>!ownKeys.includes(row.key))),originalCount:rows.length-own.length,own};
}
async function readonly(db,fn){return db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return fn(tx);},{isolationLevel:'RepeatableRead',maxWait:10000,timeout:120000});}
function sourcePin(){if(typeof __FIXTURE_SOURCE_HASHES__!=='undefined')return __FIXTURE_SOURCE_HASHES__;const paths=['file-fixture113-entry.mjs','file-fixture113-protocol.mjs','crm-acceptance-token-clock.mjs'];return Object.fromEntries(paths.map(name=>[name,sha(readFileSync(new URL('./'+name,import.meta.url)))]));}
function serverManifest(revision){const bytes=readFileSync(path.resolve(process.cwd(),'.next/server/server-reference-manifest.json'));return publicDeleteMetadata(bytes,revision);}
export async function preCapture(db,s3,input,secret){
 need(input.nativePrerequisite?.kind==='file-fixture113-finance-native'&&input.nativePrerequisite.status==='PASS'&&input.nativePrerequisite.rollbackVerified===true&&input.nativePrerequisite.originalFinancialFactsPreserved===true&&input.nativePrerequisite.metadataOnly===true,'REVIEWED_NATIVE_FINANCE_PASS_REQUIRED');
 const plan=newFixturePlan(input.runId,input.revision),baseline=await readonly(db,async tx=>{
  const base=await original(tx);for(const row of Object.values(plan.actors)){need(await tx.user.count({where:{id:row.id}})===0&&await tx.userPreference.count({where:{userId:row.id}})===0,'FRESH_ACTOR_PREF_SCOPE_REQUIRED');}
  plan.numberInt=(await tx.project.aggregate({_max:{numberInt:true}}))._max.numberInt+1;plan.articleCode=((await tx.expenseArticle.aggregate({_max:{code:true}}))._max.code??0)+1;return base;});
 plan.numberInt=plan.numberInt||1;plan.projectNumber=String(plan.numberInt);plan.productNumber=plan.projectNumber+'.1';plan.taskTitle='QA113 files '+input.runId;
 const bucket=await storage(s3);need(!bucket.own.length,'PRE_HAS_NO_STORAGE_OWNERS');
 return signed({namespace:NS,version:2,kind:'pre',runId:input.runId,revision:input.revision,plan,baseline,storageBaseline:{hash:bucket.originalHash,count:bucket.originalCount},sources:sourcePin(),nativePrerequisiteHash:digest(input.nativePrerequisite),createdAt:new Date().toISOString()},secret);
}
function preGuard(pre,secret,input){
 verifySignedFixture(pre,secret,'pre',input);validatePlan(pre.plan);need(canonical(pre.sources)===canonical(sourcePin()),'PRODUCER_SOURCE_CHANGED');
 need(input.preSha256===digest(pre),'DURABLE_SIGNED_PRE_REQUIRED');return pre.plan;
}
async function selected(tx,table,ids,column='id'){if(!ids.length)return [];return tx.$queryRawUnsafe('SELECT to_jsonb(t) row FROM '+quote(table)+' t WHERE '+quote(column)+' IN ('+bind(ids)+') ORDER BY '+(table==='UserPreference'?'"userId","key"':'id'),...ids).then(rows=>rows.map(item=>item.row));}
export async function ownState(tx,pre,prior=null){
 const p=pre.plan,a=Object.values(p.actors).map(row=>row.id),rows={};
 const fixed={User:a,Client:[p.ids.client],Project:[p.ids.project],Product:[p.ids.product],Task:[p.ids.task],CashAccount:[p.ids.cashAccount],ExpenseArticle:[p.ids.article],Payment:[p.ids.income,p.ids.expense]};
 for(const[table,ids]of Object.entries(fixed))rows[table]=await selected(tx,table,ids);
 rows.File=await selected(tx,'File',[p.ids.project],'projectId');rows.FinanceDocument=await selected(tx,'FinanceDocument',p.financeDocs.map(row=>row.clientMutationId),'clientMutationId');rows.UserPreference=await selected(tx,'UserPreference',a,'userId');
 need(rows.File.length<=7&&rows.FinanceDocument.length<=3&&rows.UserPreference.length<=60,'OWN_ROW_BOUND');
 const fileIds=[...new Set([...rows.File.map(row=>row.id),...(prior?.scope?.File??[])])],docIds=rows.FinanceDocument.map(row=>row.id),subjects=[p.ids.product,...fileIds,...docIds];
 rows.ChangeLog=await selected(tx,'ChangeLog',a,'actorId');need(rows.ChangeLog.every(row=>subjects.includes(row.entityId)&&['file','financeDocument','product'].includes(row.entity)&&['create','delete','cover.change','cover.upload'].includes(row.action)),'UNKNOWN_OWN_AUDIT');
 rows.Notification=await tx.$queryRawUnsafe('SELECT to_jsonb(t) row FROM "Notification" t WHERE type=$1 AND body LIKE $2 AND (link=$3 OR link=$4) ORDER BY id','file.added','qa113-'+p.runId+'-%','/projects/'+p.ids.project,'/products/'+p.productNumber).then(items=>items.map(item=>item.row));
 need(rows.Notification.length<=200&&rows.Notification.every(row=>p.files.some(file=>file.fileName===row.body)),'UNKNOWN_OWN_NOTIFICATION');
 rows.DomainEvent=await tx.$queryRawUnsafe('SELECT to_jsonb(t) row FROM "DomainEvent" t WHERE actor IN ('+bind(a)+') ORDER BY id',...a).then(items=>items.map(item=>item.row));need(rows.DomainEvent.length===0,'UNPLANNED_OWN_EVENT');
 need(rows.User.length===3&&rows.User.every(row=>row.passwordHash===DISABLED_PASSWORD&&p.actors[row.roles[0].toLowerCase()]?.id===row.id&&row.active&&row.sessionVersion===0),'FRESH_ACTORS_CHANGED');
 need(rows.Client.length===1&&rows.Project.length===1&&rows.Product.length===1&&rows.Task.length===1&&rows.CashAccount.length===1&&rows.ExpenseArticle.length===1&&rows.Payment.length===2,'OWN_GRAPH_INCOMPLETE');
 need(rows.Project[0].clientId===p.ids.client&&rows.Project[0].currency==='BYN'&&rows.Project[0].stage==='CONTRACT'&&rows.Product[0].projectId===p.ids.project&&rows.Product[0].engineerId===p.actors.engineer.id&&rows.Product[0].status==='DESIGN'&&rows.Task[0].projectId===p.ids.project&&rows.Task[0].productId===p.ids.product&&rows.Task[0].assigneeId===p.actors.engineer.id,'OWN_GRAPH_LINK_CHANGED');
 for(const row of rows.File){const media=p.files.find(item=>item.fileName===row.fileName);need(media&&row.section===media.section&&row.uploadedById===p.actors[media.actor].id&&row.projectId===p.ids.project&&row.productId===(media.target==='project'?null:p.ids.product)&&row.taskId===(media.target==='task'?p.ids.task:null),'UNKNOWN_FILE_CONTEXT');}
 for(const row of rows.FinanceDocument){const media=p.financeDocs.find(item=>item.clientMutationId===row.clientMutationId);need(media&&row.uploadedById===p.actors.admin.id&&row.fileName===media.fileName&&row.mimeType===media.mimeType&&['PENDING','READY'].includes(row.state),'UNKNOWN_FINANCE_DOC_CONTEXT');}
 for(const row of rows.Payment)need(row.projectId===p.ids.project&&row.cashAccountId===p.ids.cashAccount&&row.createdById===p.actors.admin.id&&row.currency==='BYN'&&Number(row.rate)===1&&row.deletionId===null&&Number(row.amount)===(row.id===p.ids.income?2:1)&&Number(row.bynAmount)===Number(row.amount)&&Number(row.projectAmount)===Number(row.amount)&&row.direction===(row.id===p.ids.income?'INCOME':'EXPENSE')&&row.expenseArticleId===(row.id===p.ids.income?null:p.ids.article)&&typeof row.paidAt==='string'&&row.paidAt.slice(0,10)===p.financeDate,'OWN_FINANCIAL_FACT_CHANGED');
 const docKeys=Object.fromEntries(rows.FinanceDocument.map(doc=>[doc.id,p.financeDocs.find(media=>media.clientMutationId===doc.clientMutationId).key]));
 const links=Object.fromEntries(['income','expense'].map(key=>{const payment=rows.Payment.find(row=>row.id===p.ids[key]);need(payment.reportDocumentId===null||Object.hasOwn(docKeys,payment.reportDocumentId),'UNKNOWN_REPORT_DOCUMENT_LINK');return [key,payment.reportDocumentId===null?null:docKeys[payment.reportDocumentId]];}));
 need((links.income===null&&links.expense===null)||p.finance.allowedLinkPhases.some(pair=>canonical(pair)===canonical(links)),'UNAPPROVED_OWN_FINANCE_LINK_PHASE');
 const scope=Object.fromEntries(Object.entries(rows).map(([table,list])=>[table,list.map(row=>row.id)]));scope.File=fileIds;scope.UserPreference=preferencePairs(rows.UserPreference,a);
 const keys=[...new Set([...(prior?.keys??[]),...rows.File.flatMap(row=>{const values=[row.projectId+'/'+row.storedName,...(row.hasThumb?[row.projectId+'/thumbs/'+row.storedName+'.jpg']:[])];need(values.every(key=>ownFileKey(p,row,key)),'UNKNOWN_OWN_FILE_KEY');return values;}),...rows.FinanceDocument.map(row=>{need(ownFinanceKey(p,row,row.storageKey),'UNKNOWN_FINANCE_KEY');return row.storageKey;})])];
 return {rows,scope,keys,actors:a};
}
export async function observe(db,s3,pre,input,secret){
 preGuard(pre,secret,input);
 return readonly(db,async tx=>{
  if(input.priorObservation){verifySignedFixture(input.priorObservation,secret,'observation',input);need(input.priorObservation.preSha256===digest(pre),'PRIOR_OWN_OBSERVATION_BINDING');}
  const state=await ownState(tx,pre,input.priorObservation??null),actual=await original(tx,state.scope,state.actors),verification=compareOriginal(pre.baseline,actual),versions=await storage(s3,state.keys);need(versions.originalHash===pre.storageBaseline.hash&&versions.originalCount===pre.storageBaseline.count,'ORIGINAL_STORAGE_CHANGED');
  for(const file of [...state.rows.File,...state.rows.FinanceDocument])if(file.state!=='PENDING'){
   const key=file.storageKey??file.projectId+'/'+file.storedName,head=versions.own.find(row=>row.key===key&&row.latest&&!row.deleteMarker);need(head&&head.size===file.size,'CURRENT_OWN_ORIGINAL_MISSING');
  }
  return signed({namespace:NS,version:2,kind:'observation',runId:pre.runId,revision:input.revision,preSha256:digest(pre),checkpointHash:digest(pre),rows:state.rows,scope:state.scope,keys:state.keys,currentOwnedStateHash:digest(state.rows),financialStateHash:digest({payments:state.rows.Payment,docs:state.rows.FinanceDocument,cash:state.rows.CashAccount,article:state.rows.ExpenseArticle}),storage:versions.own,storageManifestHash:digest(versions.own),originalVerification:verification},secret);
 });
}
async function protectedWriteRows(tx,pre,state){
 const tables=(await tx.$queryRawUnsafe("SELECT tablename::text name FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>row.name);need(canonical(tables)===canonical(pre.baseline.tables),'ORIGINAL_TABLE_SET_CHANGED');
 for(const table of tables){
  if(table==='ApiToken'){
   const[actual]=await tx.$queryRawUnsafe("SELECT count(*)::text count,encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') hash FROM (SELECT encode(sha256(convert_to((to_jsonb(t)-'lastUsedAt')::text,'UTF8')),'hex') h FROM \"ApiToken\" t) q");need(canonical(actual)===canonical(pre.baseline.tokenClock.stable),'TOKEN_STABLE_FIELDS_CHANGED');continue;
  }
  if(table==='OrgSetting'){
   need(canonical(await fingerprint(tx,'SELECT t.* FROM \"OrgSetting\" t WHERE key<>$1',['telegram.botUsername']))===canonical(pre.baseline.org.other),'ORIGINAL_NONBOT_SETTINGS_CHANGED');
   const[bot]=await tx.$queryRawUnsafe("SELECT encode(sha256(convert_to((to_jsonb(t)-'updatedAt')::text,'UTF8')),'hex') hash FROM \"OrgSetting\" t WHERE key=$1",'telegram.botUsername');need((bot?.hash??null)===(pre.baseline.org.bot?.stableHash??null),'ORIGINAL_BOT_STABLE_CHANGED');continue;
  }
  const column=table==='UserPreference'?'userId':'id',ids=column==='userId'?state.actors:(state.scope[table]??[]);
  const actual=await fingerprint(tx,'SELECT t.* FROM '+quote(table)+' t'+(ids.length?' WHERE '+quote(column)+' NOT IN ('+bind(ids)+')':''),ids);need(canonical(actual)===canonical(pre.baseline.fingerprints[table]),'ORIGINAL_WRITE_GUARD_'+table);
 }
}
export async function lockOwned(tx,state){
 for(const [table,rows]of Object.entries(state.rows)){
  if(table==='UserPreference'){const pairs=preferencePairs(rows,state.actors);if(pairs.length){const values=pairs.flatMap(pair=>[pair.userId,pair.key]);await tx.$queryRawUnsafe('SELECT "userId"::text,"key"::text FROM "UserPreference" WHERE '+pairs.map((_,index)=>'("userId"=$'+(index*2+1)+' AND "key"=$'+(index*2+2)+')').join(' OR ')+' ORDER BY "userId","key" FOR UPDATE',...values);}continue;}
  const ids=rows.map(row=>row.id);if(ids.length)await tx.$queryRawUnsafe('SELECT id::text FROM '+quote(table)+' WHERE id IN ('+bind(ids)+') ORDER BY id FOR UPDATE',...ids);
 }
}
async function beforeWrite(db,pre){
 const current=await readonly(db,tx=>original(tx));return compareOriginal(pre.baseline,current);
}
export async function createOwnGraph(tx,p){
  for(const row of Object.values(p.actors))await tx.user.create({data:{...row,active:true,payScheme:'NONE'}});
  await tx.client.create({data:{id:p.ids.client,name:'QA113 '+p.runId,phone:'100'}});
  await tx.project.create({data:{id:p.ids.project,number:p.projectNumber,numberInt:p.numberInt,title:'QA113 '+p.runId,clientId:p.ids.client,managerId:p.actors.manager.id,currency:'BYN',stage:'CONTRACT'}});
  await tx.product.create({data:{id:p.ids.product,projectId:p.ids.project,number:p.productNumber,suffixInt:1,title:'QA113 '+p.runId,engineerId:p.actors.engineer.id,status:'DESIGN',expectedPrice:'0',quantity:1}});
  await tx.task.create({data:{id:p.ids.task,projectId:p.ids.project,productId:p.ids.product,title:p.taskTitle,assigneeId:p.actors.engineer.id,status:'NEW',estimateMinutes:60}});
  await tx.cashAccount.create({data:{id:p.ids.cashAccount,name:'QA113 cash '+p.runId,currency:'BYN',active:true}});
  await tx.expenseArticle.create({data:{id:p.ids.article,code:p.articleCode,name:'QA113 expense '+p.runId,active:true}});
  for(const direction of ['income','expense'])await tx.payment.create({data:{id:p.ids[direction],projectId:p.ids.project,cashAccountId:p.ids.cashAccount,expenseArticleId:direction==='expense'?p.ids.article:null,direction:direction==='income'?'INCOME':'EXPENSE',amount:direction==='income'?'2':'1',bynAmount:direction==='income'?'2':'1',projectAmount:direction==='income'?'2':'1',currency:'BYN',rate:'1',paidAt:new Date(p.financeDate+'T12:00:00.000Z'),createdById:p.actors.admin.id,comment:'QA113 '+p.runId}});
}
export async function prepare(db,s3,pre,input,secret){
 const p=preGuard(pre,secret,input);need(input.revision===pre.revision,'PREPARE_REVISION_CHANGED');await beforeWrite(db,pre);
 return db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(18435,55113)');
  for(const row of Object.values(p.actors))need(await tx.user.count({where:{id:row.id}})===0&&await tx.userPreference.count({where:{userId:row.id}})===0,'OWN_ACTOR_ALREADY_EXISTS');
  need(((await tx.project.aggregate({_max:{numberInt:true}}))._max.numberInt??0)+1===p.numberInt&&((await tx.expenseArticle.aggregate({_max:{code:true}}))._max.code??0)+1===p.articleCode,'OWN_PLANNED_NUMBER_CHANGED');
  await createOwnGraph(tx,p);
  const state=await ownState(tx,pre);await protectedWriteRows(tx,pre,state);return signed({namespace:NS,version:2,kind:'prepared',runId:pre.runId,revision:input.revision,preSha256:digest(pre),currentOwnedStateHash:digest(state.rows),scope:state.scope,commitAck:true},secret);
 },{isolationLevel:'Serializable',maxWait:10000,timeout:120000});
}
async function cookies(plan,secret){
 const out={};for(const[key,actor]of Object.entries(plan.actors)){const name='__Secure-authjs.session-token',token=await encode({secret,salt:name,maxAge:1800,token:{sub:actor.id,id:actor.id,name:actor.name,email:actor.email,roles:actor.roles,sessionVersion:0}});out[key]={id:actor.id,roles:actor.roles,cookies:[{name,value:token,domain:'staging-crm.peromebel.by',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]};}return out;
}
function pdf(){
 const stream='BT /F1 18 Tf 40 780 Td (PERO QA113) Tj ET\n';const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'endstream'];let text='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(text));text+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}const xref=Buffer.byteLength(text);text+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(value=>String(value).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return Buffer.from(text);
}
export async function mediaBytes(media){return media.mimeType==='image/png'?sharp({create:{width:360,height:480,channels:3,background:'#336699'}}).png().toBuffer():media.mimeType==='application/pdf'?pdf():Buffer.from('PERO QA113 unsupported CAD download fixture; no parser\n');}
export async function issueIntent(db,s3,pre,input,secret){
 const obs=await observe(db,s3,pre,input,secret),media=[...pre.plan.files,...pre.plan.financeDocs].find(row=>row.key===input.mediaKey);need(media,'EXACT_MEDIA_INTENT_REQUIRED');
 const bytes=await mediaBytes(media);
 return signed({namespace:NS,version:2,kind:'upload-intent',runId:pre.runId,revision:input.revision,preSha256:digest(pre),mediaKey:media.key,clientMutationId:media.clientMutationId,fileName:media.fileName,mimeType:media.mimeType,size:bytes.length,contentHash:sha(bytes),expectedOwnedStateHash:obs.currentOwnedStateHash,expectedStorageManifestHash:obs.storageManifestHash},secret);
}
export async function upload(db,s3,pre,input,secret){
 const p=preGuard(pre,secret,input),intent=input.intent;verifySignedFixture(intent,secret,'upload-intent',input);need(intent.preSha256===digest(pre)&&input.intentSha256===digest(intent),'DURABLE_UPLOAD_INTENT_REQUIRED');
 const obs=await observe(db,s3,pre,input,secret);need(obs.currentOwnedStateHash===intent.expectedOwnedStateHash&&obs.storageManifestHash===intent.expectedStorageManifestHash,'UPLOAD_INTENT_CAS_CHANGED');
 const media=[...p.files,...p.financeDocs].find(row=>row.key===intent.mediaKey);need(media&&media.clientMutationId===intent.clientMutationId,'PLANNED_MEDIA_REQUIRED');const bytes=await mediaBytes(media);need(sha(bytes)===intent.contentHash&&bytes.length===intent.size,'MEDIA_BYTES_CHANGED');
 const profiles=await cookies(p,secret),profile=profiles[media.actor],form=new FormData();form.append('file',new File([new Uint8Array(bytes)],media.fileName,{type:media.mimeType}));form.append('clientMutationId',media.clientMutationId);
 const finance=media.key.startsWith('finance-');
 if(!finance){form.append('projectId',p.ids.project);form.append('section',media.section);if(media.target==='product')form.append('productId',p.ids.product);if(media.target==='task')form.append('taskId',p.ids.task);if(media.cover){form.append('assignCover','1');form.append('expectedSketchFileId','null');}}
 const cookie=profile.cookies.map(row=>row.name+'='+row.value).join('; ');
 const response=await fetch('http://127.0.0.1:3000'+(finance?'/api/finance/documents/upload':'/api/files/upload'),{method:'POST',headers:{cookie},body:form,redirect:'manual',signal:AbortSignal.timeout(60000)});const result=await response.json();need((response.status===200||(finance&&response.status===201))&&result.ok===true,'COMPILED_OWN_UPLOAD_UNCONFIRMED');const id=finance?result.document?.id??result.id:result.id;need(typeof id==='string','COMPILED_OWN_FILE_ID_REQUIRED');
 const captured=await observe(db,s3,pre,input,secret);return signed({namespace:NS,version:2,kind:'upload-ack',runId:pre.runId,revision:input.revision,preSha256:digest(pre),intentSha256:digest(intent),mediaKey:media.key,fileId:id,responseStatus:response.status,observation:captured},secret);
}
export async function linkFinance(db,s3,pre,input,secret){
 const p=preGuard(pre,secret,input),obs=input.observation;verifySignedFixture(obs,secret,'observation',input);need(input.observationSha256===digest(obs),'DURABLE_FINANCE_OBSERVATION_REQUIRED');const now=await observe(db,s3,pre,input,secret);need(now.currentOwnedStateHash===obs.currentOwnedStateHash&&now.storageManifestHash===obs.storageManifestHash,'FINANCE_LINK_CAS_CHANGED');
 const desired=p.finance.allowedLinkPhases[input.linkPhase];need(desired,'EXACT_OWN_LINK_PHASE');
 return db.$transaction(async tx=>{await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(18435,55113)');for(const key of ['income','expense']){const media=p.financeDocs.find(row=>row.key===desired[key]),doc=now.rows.FinanceDocument.find(row=>row.clientMutationId===media.clientMutationId),previous=now.rows.Payment.find(row=>row.id===p.ids[key]);need(doc?.state==='READY'&&doc.uploadedById===p.actors.admin.id,'OWN_READY_DOC_REQUIRED');need((await tx.payment.updateMany({where:{id:p.ids[key],projectId:p.ids.project,cashAccountId:p.ids.cashAccount,reportDocumentId:previous.reportDocumentId},data:{reportDocumentId:doc.id}})).count===1,'EXACT_PAYMENT_LINK_CAS');}return signed({namespace:NS,version:2,kind:'finance-link-ack',runId:pre.runId,revision:input.revision,preSha256:digest(pre),phase:input.linkPhase,commitAck:true},secret);},{isolationLevel:'Serializable',maxWait:10000,timeout:120000});
}
export async function handoff(db,s3,pre,input,secret,{includeProfiles=true}={}){
 const obs=await observe(db,s3,pre,input,secret),p=pre.plan,manifest=serverManifest(input.revision),profile=includeProfiles?await cookies(p,secret):null;
 const contentHashes={};
 for(const file of obs.rows.File){const key=file.projectId+'/'+file.storedName,object=obs.storage.find(row=>row.key===key&&row.latest&&!row.deleteMarker);need(object,'OWN_ORIGINAL_VERSION_REQUIRED');const actual=await s3.send(new GetObjectCommand({Bucket:'pero-crm-staging',Key:key,VersionId:object.versionId}));contentHashes[file.id]=sha(Buffer.from(await actual.Body.transformToByteArray()));const media=p.files.find(row=>row.fileName===file.fileName);need(contentHashes[file.id]===sha(await mediaBytes(media)),'OWN_ORIGINAL_CONTENT_MISMATCH');}
 for(const doc of obs.rows.FinanceDocument){const media=p.financeDocs.find(row=>row.clientMutationId===doc.clientMutationId);need(doc.state==='READY'&&doc.contentHash===sha(await mediaBytes(media)),'OWN_FINANCE_CONTENT_MISMATCH');}
 const body=signed({namespace:NS,version:2,kind:'handoff',runId:p.runId,revision:input.revision,preSha256:digest(pre),checkpointHash:digest(pre),currentOwnedStateHash:obs.currentOwnedStateHash,storageManifestHash:obs.storageManifestHash,financialStateHash:obs.financialStateHash,...manifest,...handoffSubjects(p,obs,contentHashes)},secret);
 const certificate=signed({namespace:NS,version:2,kind:'current-owned-fixture-verification',runId:p.runId,revision:input.revision,preSha256:digest(pre),checkpointHash:digest(pre),currentOwnedStateHash:obs.currentOwnedStateHash,storageManifestHash:obs.storageManifestHash,financialStateHash:obs.financialStateHash,actionManifestHash:manifest.actionManifestHash,rawManifestSha256:manifest.rawManifestSha256,compiledDeleteFileHash:manifest.compiledDeleteFileHash,verifierSourceSha256:sourcePin()['file-fixture113-entry.mjs'],verified:true},secret);
 return {handoff:body,profiles:profile,certificate,observation:obs,credentialsMemoryOnly:true};
}
export async function verifyHandoff(db,s3,pre,input,secret){
 verifySignedFixture(input.handoff,secret,'handoff',input);need(input.handoff.revision===input.revision,'CURRENT_HANDOFF_REVISION_REQUIRED');
 const actual=await handoff(db,s3,pre,input,secret,{includeProfiles:false});compareCurrentHandoff(input.handoff,actual.handoff,secret,{...input,preSha256:digest(pre)});
 return {certificate:actual.certificate,observation:actual.observation};
}
export async function deleteIntent(db,s3,pre,input,secret){
 const p=preGuard(pre,secret,input),obs=await observe(db,s3,pre,input,secret),file=obs.rows.File.find(row=>row.id===input.fileId),actor=p.actors[input.actorKey];
 need(file&&actor&&file.id!==obs.rows.Product[0].sketchFileId,'OWN_NONCOVER_DELETE_INTENT_REQUIRED');
 need(input.actorKey!=='engineer'||file.uploadedById===actor.id,'ENGINEER_OWN_UPLOAD_REQUIRED');
 return signed({namespace:NS,version:2,kind:'delete-intent',runId:p.runId,revision:input.revision,preSha256:digest(pre),fileId:file.id,actorId:actor.id,observation:obs,expectedOwnStateHash:obs.currentOwnedStateHash,expectedStorageManifestHash:obs.storageManifestHash},secret);
}
export async function deleteAck(db,s3,pre,input,secret){
 const intent=input.deleteIntent;verifySignedFixture(intent,secret,'delete-intent',input);need(input.deleteIntentSha256===digest(intent)&&intent.preSha256===digest(pre),'DURABLE_DELETE_INTENT_REQUIRED');
 const obs=await observe(db,s3,pre,{...input,priorObservation:intent.observation},secret),verification=compareFileDelete(intent.observation,obs,intent.fileId,intent.actorId,input.cancelled===true);
 return signed({namespace:NS,version:2,kind:'delete-ack',runId:pre.runId,revision:input.revision,preSha256:digest(pre),intentSha256:digest(intent),observation:obs,verification},secret);
}
export async function finalState(db,s3,pre,input,secret){
 need(HASH.test(input.expectedOwnStateHash??''),'EXACT_FINAL_CAS_REQUIRED');
 const obs=await observe(db,s3,pre,input,secret);need(obs.currentOwnedStateHash===input.expectedOwnStateHash,'FINAL_OWN_STATE_CAS_CHANGED');
 return signed({namespace:NS,version:2,kind:'current-owned-final-verification',runId:pre.runId,revision:input.revision,preSha256:digest(pre),checkpointHash:digest(pre),currentOwnedStateHash:obs.currentOwnedStateHash,financialStateHash:obs.financialStateHash,storageManifestHash:obs.storageManifestHash,untouchedRelationsMatch:obs.originalVerification.originalRelationsMatch,preferencesUntouched:obs.originalVerification.preferencesUntouched,storageVersionsAccounted:true,tokenClockValid:obs.originalVerification.tokenClockValid,verifierSourceSha256:sourcePin()['file-fixture113-entry.mjs']},secret);
}
export async function deleteOwnedRows(tx,state){
 const counts={};for(const table of CLEANUP_ORDER){
  if(table==='UserPreference'){const pairs=preferencePairs(state.rows.UserPreference,state.actors);for(const pair of pairs)need((await tx.userPreference.deleteMany({where:{userId:pair.userId,key:pair.key}})).count===1,'EXACT_PREFERENCE_PAIR_DELETE');counts.UserPreference=pairs.length;continue;}
  const ids=state.rows[table]?.map(row=>row.id)??[];if(!ids.length){counts[table]=0;continue;}const result=await tx[tableModels[table]].deleteMany({where:{id:{in:ids}}});need(result.count===ids.length,'EXACT_OWN_DELETE_COUNT_'+table);counts[table]=result.count;
 }return counts;
}
export async function cleanup(db,s3,pre,input,secret){
 const p=preGuard(pre,secret,input),obs=input.observation,intent=input.cleanupIntent;verifySignedFixture(obs,secret,'observation',input);verifySignedFixture(intent,secret,'cleanup-intent',input);
 need(canonical(intent)===canonical(signed(cleanupIntent(pre,obs,input.revision),secret))&&input.cleanupIntentSha256===digest(intent),'DURABLE_EXACT_CLEANUP_INTENT_REQUIRED');
 const current=await observe(db,s3,pre,input,secret);need(current.currentOwnedStateHash===obs.currentOwnedStateHash&&current.storageManifestHash===obs.storageManifestHash,'CLEANUP_OBSERVATION_CAS_CHANGED');
 return db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(18435,55113)');const state=await ownState(tx,pre,obs);need(digest(state.rows)===obs.currentOwnedStateHash,'DB_CLEANUP_CAS_CHANGED');
  await lockOwned(tx,state);await protectedWriteRows(tx,pre,state);
  const versions=await storage(s3,obs.keys);need(digest(versions.own)===obs.storageManifestHash&&versions.originalHash===pre.storageBaseline.hash,'STORAGE_CLEANUP_CAS_CHANGED');
  for(const row of obs.storage){need(obs.keys.includes(row.key)&&row.versionId,'EXACT_VERSION_ONLY_DELETE');await s3.send(new DeleteObjectCommand({Bucket:'pero-crm-staging',Key:row.key,VersionId:row.versionId}));}
  need((await storage(s3,obs.keys)).own.length===0,'OWN_VERSIONS_REMAIN');
  need(await tx.stockPurchase.count({where:{paymentId:{in:[p.ids.income,p.ids.expense]}}})===0&&await tx.payout.count({where:{cashAccountId:p.ids.cashAccount}})===0,'UNOWNED_FINANCIAL_FK_STOP');
  await tx.product.updateMany({where:{id:p.ids.product,sketchFileId:obs.rows.Product[0].sketchFileId},data:{sketchFileId:null}});await tx.project.updateMany({where:{id:p.ids.project,coverFileId:obs.rows.Project[0].coverFileId},data:{coverFileId:null}});
  for(const row of obs.rows.Payment)need((await tx.payment.updateMany({where:{id:row.id,projectId:p.ids.project,reportDocumentId:row.reportDocumentId},data:{reportDocumentId:null}})).count===1,'OWN_FINANCE_UNLINK_CAS');
  const counts=await deleteOwnedRows(tx,state);
  return signed({namespace:NS,version:2,kind:'cleaned',runId:p.runId,revision:input.revision,preSha256:digest(pre),observationSha256:digest(obs),counts,commitAck:true,storageVersionsRemoved:true,lateOriginalVerificationRequired:true},secret);
 },{isolationLevel:'Serializable',maxWait:10000,timeout:120000});
}
export async function main(){
 let db,s3,result;
 try{
  const encoded=process.env.CRM_STAGING_BROWSER_INPUT;need(typeof encoded==='string'&&encoded.length>0&&encoded.length<=96*1024,'BOUNDED_PRIVATE_INPUT');const input=JSON.parse(Buffer.from(encoded,'base64').toString('utf8')),guard=fixtureStageGuard(input,process.env,{host:hostname(),docker:existsSync('/.dockerenv')});need(['prepare','inspect','restore'].includes(input.operation),'EXACT_ROOT_OPERATION');
  db=new PrismaClient({log:[],errorFormat:'minimal'});s3=client();phase=input.mode;
  if(input.operation==='inspect'&&input.mode==='pre')result={status:'PRE_CAPTURED',pre:await preCapture(db,s3,input,guard.secret)};
  else{const pre=input.pre;preGuard(pre,guard.secret,input);
   if(input.operation==='prepare'&&input.mode==='graph')result={status:'GRAPH_PREPARED',prepared:await prepare(db,s3,pre,input,guard.secret)};
   else if(input.operation==='inspect'&&input.mode==='observe')result={status:'OWN_CAPTURED',observation:await observe(db,s3,pre,input,guard.secret)};
   else if(input.operation==='inspect'&&input.mode==='intent')result={status:'INTENT_CAPTURED',intent:await issueIntent(db,s3,pre,input,guard.secret)};
   else if(input.operation==='prepare'&&input.mode==='upload')result={status:'UPLOAD_ACK',ack:await upload(db,s3,pre,input,guard.secret)};
   else if(input.operation==='prepare'&&input.mode==='finance-link')result={status:'LINK_ACK',ack:await linkFinance(db,s3,pre,input,guard.secret)};
   else if(input.operation==='inspect'&&input.mode==='delete-intent')result={status:'DELETE_INTENT',intent:await deleteIntent(db,s3,pre,input,guard.secret)};
   else if(input.operation==='inspect'&&input.mode==='delete-ack')result={status:'DELETE_ACK',ack:await deleteAck(db,s3,pre,input,guard.secret)};
   else if(input.operation==='inspect'&&input.mode==='final')result={status:'OWN_FINAL_VERIFIED',certificate:await finalState(db,s3,pre,input,guard.secret)};
   else if(input.operation==='inspect'&&input.mode==='verify-handoff')result={status:'CURRENT_HANDOFF_VERIFIED',...await verifyHandoff(db,s3,pre,input,guard.secret)};
   else if(input.operation==='inspect'&&input.mode==='handoff')result={status:'OWN_HANDOFF',...await handoff(db,s3,pre,input,guard.secret)};
   else if(input.operation==='inspect'&&input.mode==='cleanup-intent'){const observation=await observe(db,s3,pre,input,guard.secret);result={status:'CLEANUP_INTENT',observation,intent:signed(cleanupIntent(pre,observation,input.revision),guard.secret)};}
   else if(input.operation==='inspect'&&input.mode==='closed'){const actual=await readonly(db,tx=>original(tx)),verification=compareOriginal(pre.baseline,actual),versions=await storage(s3);need(versions.originalHash===pre.storageBaseline.hash&&versions.originalCount===pre.storageBaseline.count,'POST_CLEANUP_STORAGE_CHANGED');result={status:'OWN_CLOSED',verification,storageOriginalMatch:true,actorRowsGone:true};}
   else if(input.operation==='restore'&&input.mode==='cleanup')result={status:'OWN_CLEANED',ack:await cleanup(db,s3,pre,input,guard.secret)};
   else throw Error('MODE_NOT_ALLOWED');
  }
  need(Buffer.byteLength(JSON.stringify(result))<=MAX_OUTPUT,'PRIVATE_OUTPUT_CAP');
 }catch(error){result={status:'STOP',phase,code:/^[A-Z0-9_]{1,100}$/.test(error?.message??'')?error.message:'FIXTURE113_STOP_PRESERVE_STATE'};process.exitCode=1;}
 finally{await db?.$disconnect();s3?.destroy();}
 console.log(JSON.stringify(result));
}
const entry=process.argv[1];if((!entry||path.resolve(entry)===fileURLToPath(import.meta.url))&&process.env.CRM_STAGING_BROWSER_INPUT&&process.env.CRM_MODERNIZATION_TARGET==='staging')void main();
