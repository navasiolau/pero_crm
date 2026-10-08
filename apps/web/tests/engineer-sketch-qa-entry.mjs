// Root-only task112 acceptance. No DB, HTTP or S3 action occurs on import.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP on guard mismatch.

import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {hostname} from 'node:os';
import {existsSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {encode,decode} from '@auth/core/jwt';
import sharp from 'sharp';
import {S3Client,ListObjectVersionsCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';

const NS='PERO_ENGINEER_SKETCH_QA_112_V1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{40}$/;
const requireThat=(ok,code)=>{if(!ok)throw Error(code)};
function canonical(value){const normalized=JSON.parse(JSON.stringify(value));const stable=item=>Array.isArray(item)?`[${item.map(stable).join(',')}]`:item!==null&&typeof item==='object'?`{${Object.keys(item).sort().map(key=>`${JSON.stringify(key)}:${stable(item[key])}`).join(',')}}`:JSON.stringify(item);return stable(normalized)}
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export function stageGuard(input,env=process.env,container={host:hostname(),docker:existsSync('/.dockerenv')}){
 requireThat(input&&input.authorized===true&&UUID.test(input.runId??'')&&SHA.test(input.revision??''),'AUTHORIZED_RUN_REVISION_REQUIRED');
 requireThat(env.CRM_MODERNIZATION_TARGET==='staging'&&container.docker,'STAGING_ONLY_REQUIRED');
 const url=new URL(env.DATABASE_URL??''),endpoint=new URL(env.S3_ENDPOINT??'');
 requireThat(['postgres:','postgresql:'].includes(url.protocol)&&url.hostname==='db'&&(url.port||'5432')==='5432'&&url.pathname==='/crm'&&!url.hash,'STAGING_DATABASE_MISMATCH');
 const options=new Set(['schema','connection_limit','pool_timeout','connect_timeout','socket_timeout','sslmode']);
 requireThat([...url.searchParams.keys()].every(key=>options.has(key)&&url.searchParams.getAll(key).length===1)&&(!url.searchParams.has('schema')||url.searchParams.get('schema')==='public'),'DATABASE_OPTIONS_MISMATCH');
 requireThat(env.CRM_FILE_STORAGE==='s3'&&env.S3_BUCKET==='pero-crm-staging'&&endpoint.protocol==='http:'&&endpoint.hostname==='192.168.0.33'&&endpoint.port==='9000'&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash,'STAGING_STORAGE_MISMATCH');
 const proof=JSON.parse(env.CRM_MODERNIZATION_STAGE_PROOF??'');
 requireThat(proof.hostname==='crm-staging'&&proof.revision===input.revision&&proof.databaseVolume==='crm-staging_pgdata'&&/^[a-f0-9]{64}$/.test(proof.outerW07Sha256??'')&&/^[a-f0-9]{64}$/.test(proof.web??'')&&proof.web.startsWith(container.host)&&/^[a-f0-9]{64}$/.test(proof.database??''),'VERIFIED_OUTER_PROOF_REQUIRED');
 const secret=env.AUTH_SECRET??env.NEXTAUTH_SECRET;
 requireThat(typeof secret==='string'&&secret.length>0&&env.S3_ACCESS_KEY&&env.S3_SECRET_KEY,'PRIVATE_RUNTIME_CREDENTIALS_REQUIRED');
 return {secret,proof};
}
function signed(value,secret){return {...value,signature:createHmac('sha256',secret).update(NS+'\0'+canonical(value)).digest('hex')}}
export function verifySigned(value,secret,kind,input){requireThat(value?.namespace===NS&&value.kind===kind&&value.runId===input.runId&&value.revision===input.revision&&/^[a-f0-9]{64}$/.test(value.signature??''),'SIGNED_SCOPE_REQUIRED');const{signature,...body}=value;const expected=signed(body,secret).signature;requireThat(timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')),'SIGNED_SCOPE_MISMATCH');return body}
async function dbIdentity(db){const[row]=await db.$queryRaw`SELECT current_database() AS name,current_schema() AS schema`;requireThat(row.name==='crm'&&row.schema==='public','INNER_DATABASE_MISMATCH')}
async function snapshot(db,exclusions={}){
 const tables=await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
 requireThat(tables.length>30&&tables.length<150,'UNEXPECTED_SCHEMA_TABLE_COUNT');
 const rows={};for(const{tablename:table}of tables){requireThat(/^[A-Za-z_][A-Za-z0-9_]*$/.test(table),'UNSUPPORTED_TABLE_IDENTIFIER');const value=table==='ApiToken'?"(to_jsonb(t)-'lastUsedAt')::text":'row_to_json(t)::text',ids=exclusions[table]??[];const[row]=await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(${value},'' ORDER BY ${value}),'')) AS hash FROM "${table}" t${ids.length?' WHERE NOT (id=ANY($1::text[]))':''}`,...(ids.length?[ids]:[]));rows[table]=row;}
 const columns=await db.$queryRaw`SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`;
 const constraints=await db.$queryRaw`SELECT c.conname,pg_get_constraintdef(c.oid) AS definition,t.relname AS table_name FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' ORDER BY t.relname,c.conname`;
 const indexes=await db.$queryRaw`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`;
 return {rows,schema:digest({columns,constraints,indexes})};
}
function s3Client(){return new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION??'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY,secretAccessKey:process.env.S3_SECRET_KEY}})}
async function storageState(s3,projectId){
 const rows=[];let KeyMarker,VersionIdMarker;do{const page=await s3.send(new ListObjectVersionsCommand({Bucket:'pero-crm-staging',KeyMarker,VersionIdMarker}));for(const item of page.Versions??[])rows.push({key:item.Key,versionId:item.VersionId??null,deleteMarker:false,latest:item.IsLatest??false,etag:item.ETag,size:item.Size});for(const item of page.DeleteMarkers??[])rows.push({key:item.Key,versionId:item.VersionId??null,deleteMarker:true,latest:item.IsLatest??false});requireThat(rows.length<100000,'S3_INVENTORY_LIMIT');if(!page.IsTruncated)break;requireThat(page.NextKeyMarker&&page.NextKeyMarker!==KeyMarker,'S3_PAGINATION_UNKNOWN');KeyMarker=page.NextKeyMarker;VersionIdMarker=page.NextVersionIdMarker;}while(true);
 rows.sort((a,b)=>canonical(a).localeCompare(canonical(b)));
 return {original:digest(rows.filter(row=>!projectId||!row.key.startsWith(projectId+'/'))),own:projectId?rows.filter(row=>row.key.startsWith(projectId+'/')):[]};
}
function fileKeys(cp,file){requireThat(file.projectId===cp.ids.project&&file.productId===cp.ids.product&&file.taskId===null&&file.fileName.startsWith(`qa112-${cp.runId}-`)&&file.mimeType==='image/png'&&UUID.test(file.storedName.slice(0,36))&&file.storedName.endsWith('-'+file.fileName),'OWN_FILE_BINDING_MISMATCH');return [`${cp.ids.project}/${file.storedName}`,...(file.hasThumb?[`${cp.ids.project}/thumbs/${file.storedName}.jpg`]:[])]}
export function ownStorageKey(cp,key){if(typeof key!=='string')return false;const prefix=cp.ids.project+'/';if(!key.startsWith(prefix))return false;let name=key.slice(prefix.length);if(name.startsWith('thumbs/')){if(!name.endsWith('.jpg'))return false;name=name.slice(7,-4);}return UUID.test(name.slice(0,36))&&new RegExp(`^qa112-${cp.runId}-[a-z]+\\.png$`).test(name.slice(37))}
const PARTIAL_RUN='ae9ce4bb-b574-400b-8fff-30c22f9eec58';
const PARTIAL_FILES=['cmuzv9uu50001o201hnax4t82','cmuzv9vaz000do201ppwk4pht'];
export function validatePartialRecovery(cp,policy){
 requireThat(cp.runId===PARTIAL_RUN&&policy&&Object.keys(policy).sort().join('|')==='acknowledgement|expectedOrgSetting|ownFileIds','PARTIAL_RECOVERY_EXACT_SCOPE_REQUIRED');
 requireThat(policy.acknowledgement==='PRESERVE_CURRENT_ORGSETTING_UNKNOWN_PRIOR_VALUE'&&policy.expectedOrgSetting&&Object.keys(policy.expectedOrgSetting).sort().join('|')==='count|hash'&&policy.expectedOrgSetting.count==='2'&&/^[a-f0-9]{32}$/.test(policy.expectedOrgSetting.hash??''),'PARTIAL_OUTSIDE_CHANGE_ACK_REQUIRED');
 requireThat(Array.isArray(policy.ownFileIds)&&canonical([...policy.ownFileIds].sort())===canonical([...PARTIAL_FILES].sort()),'PARTIAL_FILE_ALLOWLIST_MISMATCH');
 return policy;
}
export function originalExceptOrgSettingMatches(actual,baseline){return actual.schema===baseline.schema&&Object.keys(actual.rows).length===Object.keys(baseline.rows).length&&Object.entries(baseline.rows).every(([table,row])=>table==='OrgSetting'||canonical(actual.rows[table])===canonical(row))}
export function describeOrgSettingEvidence(rows){
 const sorted=[...rows].sort((a,b)=>a.key.localeCompare(b.key)),bot=sorted.find(row=>row.key==='telegram.botUsername');
 if(!bot)return {key:'telegram.botUsername',count:rows.length,bot:null,otherRowsHash:digest(sorted)};
 const {updatedAt,...stableFields}=bot;
 return {key:'telegram.botUsername',count:rows.length,bot:{key:bot.key,valueHash:digest(bot.value),stableFieldsHash:digest(stableFields),updatedAt:new Date(updatedAt).toISOString()},otherRowsHash:digest(sorted.filter(row=>row.key!==bot.key))};
}
export function verifyOperationalClockEvidence(before,after){
 if(!before||!after||before.key!=='telegram.botUsername'||after.key!==before.key||before.count!==after.count||before.otherRowsHash!==after.otherRowsHash)return {valid:false};
 if(!before.bot||!after.bot)return {valid:before.bot===after.bot,changed:false};
 if(before.bot.key!==before.key||after.bot.key!==before.key||before.bot.valueHash!==after.bot.valueHash||before.bot.stableFieldsHash!==after.bot.stableFieldsHash)return {valid:false};
 const previous=Date.parse(before.bot.updatedAt),current=Date.parse(after.bot.updatedAt);
 return {valid:Number.isFinite(previous)&&Number.isFinite(current)&&current>=previous,changed:current!==previous};
}
async function readOrgSettingEvidence(db){return describeOrgSettingEvidence(await db.orgSetting.findMany({orderBy:{key:'asc'}}))}
async function classifyOriginal(db,actual,cp){
 const rawMatches=canonical(actual)===canonical(cp.baseline);
 if(!cp.operationalOrgSettingBefore){requireThat(rawMatches,'ORIGINAL_DATABASE_CHANGED');return {originalDatabase:'MATCH'};}
 const operationalOrgSettingCurrent=await readOrgSettingEvidence(db),check=verifyOperationalClockEvidence(cp.operationalOrgSettingBefore,operationalOrgSettingCurrent);
 requireThat(check.valid,'OPERATIONAL_ORGSETTING_FIELDS_CHANGED');
 requireThat(rawMatches||(check.changed&&originalExceptOrgSettingMatches(actual,cp.baseline)),'ORIGINAL_DATABASE_CHANGED');
 return {originalDatabase:rawMatches?'MATCH':'MATCH_EXCEPT_VERIFIED_BOT_REGISTRATION_TIMESTAMP',operationalOrgSettingCurrent};
}
async function withReadOnlySnapshot(db,operation){
 return db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');await dbIdentity(tx);return operation(tx);},{isolationLevel:'RepeatableRead',maxWait:10000,timeout:120000});
}
export async function readOriginalReadOnly(db,cp,readSnapshot=snapshot){return withReadOnlySnapshot(db,async tx=>classifyOriginal(tx,await readSnapshot(tx),cp));}
function replayFingerprint(observation){return digest({checkpointHash:observation.checkpointHash,rows:observation.rows,storage:observation.storage})}
async function capture(db,s3,cp,secret){return withReadOnlySnapshot(db,tx=>captureWithinTransaction(tx,s3,cp,secret));}
async function captureWithinTransaction(db,s3,cp,secret,partialPolicy){
 await dbIdentity(db);
 const actors=Object.values(cp.actors).map(row=>row.id),files=await db.file.findMany({where:{projectId:cp.ids.project},orderBy:{id:'asc'}});
 requireThat(files.length<=10,'OWN_FILE_LIMIT');files.forEach(file=>fileKeys(cp,file));
 const logs=await db.changeLog.findMany({where:{actorId:{in:actors}},orderBy:{id:'asc'}});
 const subjects=new Set([cp.ids.product,...files.map(row=>row.id)]);
 requireThat(logs.every(row=>subjects.has(row.entityId)&&row.actorType==='user'&&['create','cover.change','cover.upload'].includes(row.action)),'UNEXPECTED_OWN_AUDIT');
 const notifications=await db.notification.findMany({where:{type:'file.added',title:`Файл к проекту ${cp.number}`,body:{startsWith:`qa112-${cp.runId}-`},link:`/products/${cp.productNumber}`,createdAt:{gte:new Date(cp.createdAt)}},orderBy:{id:'asc'}});
 requireThat(notifications.every(row=>files.some(file=>file.fileName===row.body)),'UNEXPECTED_OWN_NOTIFICATION');
 const rows={User:await db.user.findMany({where:{id:{in:actors}},orderBy:{id:'asc'}}),Client:await db.client.findMany({where:{id:cp.ids.client}}),Project:await db.project.findMany({where:{id:cp.ids.project}}),Product:await db.product.findMany({where:{id:cp.ids.product}}),ProductPercentageConfig:await db.productPercentageConfig.findMany({where:{productId:cp.ids.product}}),ProductPercentageParticipant:await db.productPercentageParticipant.findMany({where:{configId:cp.ids.config}}),File:files,ChangeLog:logs,Notification:notifications};
 requireThat(rows.User.length===3&&rows.User.every(row=>Object.values(cp.actors).some(actor=>actor.id===row.id&&canonical(actor.roles)===canonical(row.roles))&&row.active&&row.passwordHash==='QA112_DISABLED_NOT_A_PASSWORD_HASH')&&rows.Client.length===1&&rows.Project.length===1&&rows.Product.length===1&&rows.Project[0].clientId===cp.ids.client&&rows.Product[0].projectId===cp.ids.project,'OWN_FIXTURE_GRAPH_MISMATCH');
 requireThat(rows.ProductPercentageConfig.length===1&&rows.ProductPercentageConfig[0].id===cp.ids.config&&rows.ProductPercentageConfig[0].kind==='ENGINEERING'&&rows.ProductPercentageParticipant.length===1&&rows.ProductPercentageParticipant[0].id===cp.ids.participation&&rows.ProductPercentageParticipant[0].userId===cp.actors.participant.id,'OWN_PARTICIPANT_GRAPH_MISMATCH');
 const exclusions=Object.fromEntries(Object.entries(rows).map(([table,list])=>[table,list.map(row=>row.id)]));
 const actual=await snapshot(db,exclusions);let preservedOrgSetting,originalVerification;
 if(partialPolicy){
  validatePartialRecovery(cp,partialPolicy);
  requireThat(originalExceptOrgSettingMatches(actual,cp.baseline),'PARTIAL_UNEXPECTED_ORIGINAL_CHANGE');
  requireThat(canonical(actual.rows.OrgSetting)===canonical(partialPolicy.expectedOrgSetting),'PARTIAL_ORGSETTING_CAS_CHANGED');
  requireThat(canonical(files.map(row=>row.id).sort())===canonical([...partialPolicy.ownFileIds].sort()),'PARTIAL_OWN_FILE_SET_CHANGED');
  const settingRows=await db.orgSetting.findMany({orderBy:{key:'asc'}});
  requireThat(canonical(settingRows.map(row=>row.key))===canonical(['productPercentageDefaults','telegram.botUsername']),'PARTIAL_ORGSETTING_KEY_SET_CHANGED');
  preservedOrgSetting={fingerprint:actual.rows.OrgSetting,rows:settingRows,priorValueKnown:false};
 }else originalVerification=await classifyOriginal(db,actual,cp);
 const storage=await storageState(s3,cp.ids.project);requireThat(storage.original===cp.storageBaseline&&storage.own.every(row=>ownStorageKey(cp,row.key)),'ORIGINAL_STORAGE_CHANGED_OR_UNKNOWN_OWN_KEY');
 if(partialPolicy){const allowedKeys=files.flatMap(file=>fileKeys(cp,file));requireThat(storage.own.every(row=>allowedKeys.includes(row.key))&&canonical(storage.own.filter(row=>row.latest&&!row.deleteMarker).map(row=>row.key).sort())===canonical([...allowedKeys].sort()),'PARTIAL_UNEXPECTED_OWN_STORAGE_KEY_OR_STATE');}
 return signed({namespace:NS,kind:partialPolicy?'partial-observation':'observation',runId:cp.runId,revision:cp.revision,checkpointHash:digest(cp),rows,storage,...(partialPolicy?{partialPolicy,preservedOrgSetting,originalDatabase:'MATCH_EXCEPT_ACKNOWLEDGED_ORGSETTING_DRIFT',runtimePass:false}:originalVerification)},secret);
}
async function prepare(db,s3,input,secret){
 const storage=await storageState(s3);return db.$transaction(async tx=>{await dbIdentity(tx);await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(18435,55001)`;requireThat(await tx.project.count({where:{title:`QA112 ${input.runId}`}})===0,'RUN_ALREADY_PREPARED');const baseline=await snapshot(tx),operationalOrgSettingBefore=await readOrgSettingEvidence(tx);const ids=Object.fromEntries(['client','project','product','config','participation'].map(key=>[key,randomUUID()])),actors={};for(const[key,role]of [['manager','MANAGER'],['engineer','ENGINEER'],['participant','ENGINEER']])actors[key]=await tx.user.create({data:{id:randomUUID(),name:`QA112 ${key} ${input.runId}`,email:randomUUID()+'@invalid.test',passwordHash:'QA112_DISABLED_NOT_A_PASSWORD_HASH',roles:[role],active:true},select:{id:true,roles:true,sessionVersion:true}});
 await tx.client.create({data:{id:ids.client,name:`QA112 ${input.runId}`,phone:'100'}});const max=await tx.project.aggregate({_max:{numberInt:true}}),numberInt=(max._max.numberInt??0)+1,number=String(numberInt),productNumber=number+'.1';await tx.project.create({data:{id:ids.project,number,numberInt,title:`QA112 ${input.runId}`,stage:'CONTRACT',clientId:ids.client,managerId:actors.manager.id,currency:'BYN'}});await tx.product.create({data:{id:ids.product,projectId:ids.project,number:productNumber,suffixInt:1,title:`QA112 ${input.runId}`,status:'DESIGN',engineerId:actors.engineer.id,quantity:1,expectedPrice:'0'}});await tx.productPercentageConfig.create({data:{id:ids.config,productId:ids.product,kind:'ENGINEERING',ratePercent:null}});await tx.productPercentageParticipant.create({data:{id:ids.participation,configId:ids.config,userId:actors.participant.id,shareUnits:1}});
 return signed({namespace:NS,kind:'checkpoint',runId:input.runId,revision:input.revision,createdAt:new Date().toISOString(),ids,actors,number,productNumber,baseline,operationalOrgSettingBefore,storageBaseline:storage.original},secret);
 },{isolationLevel:'Serializable',maxWait:10000,timeout:120000});
}
async function runtime(db,s3,input,cp,secret){
 const checks=[],origin='http://127.0.0.1:3000',cookies={};for(const[key,actor]of Object.entries(cp.actors)){const parts=[];for(const name of ['authjs.session-token','__Secure-authjs.session-token'])parts.push(name+'='+await encode({secret,salt:name,token:{id:actor.id,roles:actor.roles,sessionVersion:actor.sessionVersion},maxAge:15*60}));cookies[key]=parts.join('; ');const response=await fetch(origin+'/api/auth/session',{headers:{cookie:cookies[key]},redirect:'manual',signal:AbortSignal.timeout(30000)});requireThat(response.status===200,'COMPILED_SESSION_HTTP_FAILED');const session=await response.json();requireThat(session.user?.id===actor.id&&canonical(session.user.roles)===canonical(actor.roles),'COMPILED_SESSION_IDENTITY_FAILED')}
 let pointer=null;
 const bytes=await sharp({create:{width:3,height:4,channels:3,background:'#224466'}}).png().toBuffer();
 async function upload(actor,label,baseline,mutation=randomUUID(),extra={}){const form=new FormData();form.append('file',new File([new Uint8Array(bytes)],`qa112-${cp.runId}-${label}.png`,{type:'image/png'}));for(const[key,value]of Object.entries({projectId:cp.ids.project,productId:cp.ids.product,category:'PHOTO',assignCover:'1',expectedSketchFileId:baseline??'null',clientMutationId:mutation,...extra}))form.append(key,value);const response=await fetch(origin+'/api/files/upload',{method:'POST',headers:{cookie:cookies[actor]},body:form,redirect:'manual',signal:AbortSignal.timeout(30000)});const result=await response.json();return {status:response.status,result,mutation};}
 const accept=entry=>{requireThat(entry.status===200&&entry.result.ok===true&&entry.result.id&&entry.result.id===entry.result.sketchFileId&&entry.result.clientMutationId===entry.mutation&&entry.result.sketch?.id===entry.result.id,'COMPILED_UPLOAD_ACK_REQUIRED');pointer=entry.result.id;return pointer};
 const first=upload('manager','initial',null);const old=accept(await first);checks.push('compiled_MANAGER_initial_original_and_thumb');
 const page=await fetch(origin+'/products/'+cp.productNumber,{headers:{cookie:cookies.engineer},redirect:'manual',signal:AbortSignal.timeout(30000)});requireThat(page.status===200&&(await page.text()).includes('Заменить изображение'),'COMPILED_ENGINEER_REPLACEMENT_CONTROL_REQUIRED');checks.push('compiled_ENGINEER_server_page_replace_without_delete');
 const mutation=randomUUID(),replacement=await upload('engineer','assigned',pointer,mutation),assigned=accept(replacement);requireThat(await db.file.count({where:{id:old,uploadedById:cp.actors.manager.id}})===1,'OLD_MANAGER_FILE_CHANGED');const beforeRetry=replayFingerprint(await capture(db,s3,cp,secret));const replay=await upload('engineer','assigned',old,mutation);requireThat(replay.status===200&&replay.result.repeated===true&&replay.result.id===assigned,'COMPILED_REPLAY_NOT_IDEMPOTENT');requireThat(replayFingerprint(await capture(db,s3,cp,secret))===beforeRetry,'COMPILED_REPLAY_SIDE_EFFECT');checks.push('compiled_assigned_ENGINEER_manager_replacement_and_exact_replay');
 const stale=await upload('engineer','stale',old);requireThat(stale.status===409&&stale.result.kind==='conflict','STALE_BASELINE_NOT_REFUSED');const fake=await upload('engineer','fake',pointer,randomUUID(),{projectId:randomUUID()});requireThat(fake.status===404,'FOREIGN_PROJECT_NOT_REFUSED');checks.push('compiled_stale_and_foreign_context_refused');
 await db.product.update({where:{id:cp.ids.product},data:{engineerId:null}});const denied=await upload('engineer','unassigned',pointer);requireThat(denied.status===404,'UNASSIGNED_ENGINEER_NOT_REFUSED');accept(await upload('participant','participant',pointer));await db.product.update({where:{id:cp.ids.product},data:{engineerId:cp.actors.engineer.id}});checks.push('compiled_ENGINEERING_participant_independent_of_primary_engineer');
 await db.file.update({where:{id:pointer},data:{uploadedById:null}});const legacy=pointer;accept(await upload('engineer','legacy',pointer));requireThat(await db.file.count({where:{id:legacy,uploadedById:null}})===1,'LEGACY_FILE_NOT_PRESERVED');checks.push('compiled_ENGINEER_legacy_null_author_replacement');
 await db.product.update({where:{id:cp.ids.product},data:{status:'PRODUCTION'}});const deniedStatus=await upload('engineer','status',pointer);requireThat(deniedStatus.status===404,'STALE_STATUS_NOT_REFUSED');await db.product.update({where:{id:cp.ids.product},data:{status:'DESIGN'}});checks.push('compiled_ENGINEER_current_DESIGN_scope_rechecked');
 let baseline=pointer;const competing=await Promise.all([upload('engineer','racea',baseline),upload('participant','raceb',baseline)]);requireThat(competing.filter(entry=>entry.status===200).length===1&&competing.filter(entry=>entry.status===409).length===1,'CONCURRENT_BASELINE_DID_NOT_CONFLICT');accept(competing.find(entry=>entry.status===200));checks.push('compiled_two_replacements_exactly_one_winner');
 baseline=pointer;const duplicateMutation=randomUUID(),duplicate=await Promise.all([upload('engineer','duplicate',baseline,duplicateMutation),upload('engineer','duplicate',baseline,duplicateMutation)]);duplicate.forEach(accept);requireThat(duplicate[0].result.id===duplicate[1].result.id&&duplicate.filter(entry=>entry.result.repeated===true).length===1,'CONCURRENT_DUPLICATE_RECEIPT_REQUIRED');checks.push('compiled_concurrent_duplicate_one_file_receipt');
 const observation=await capture(db,s3,cp,secret),expectedKeys=observation.rows.File.flatMap(file=>fileKeys(cp,file)),liveKeys=observation.storage.own.filter(row=>row.latest&&!row.deleteMarker).map(row=>row.key);requireThat(canonical([...expectedKeys].sort())===canonical(liveKeys.sort()),'DUPLICATE_ACTIVE_STORAGE_ORPHAN');
 for(const file of observation.rows.File){const object=await s3.send(new GetObjectCommand({Bucket:'pero-crm-staging',Key:fileKeys(cp,file)[0]}));requireThat(Buffer.from(await object.Body.transformToByteArray()).equals(bytes),'ORIGINAL_BYTES_CHANGED')}
 requireThat((await db.product.findUnique({where:{id:cp.ids.product}})).sketchFileId===pointer&&observation.rows.ChangeLog.filter(row=>row.action==='cover.upload').length===observation.rows.File.length,'POINTER_OR_RECEIPT_GRAPH_MISMATCH');checks.push('real_S3_originalbytes_oldfiles_and_no_active_orphans');
 return {status:'PASS',runId:cp.runId,revision:cp.revision,checks,observation};
}
async function restore(db,s3,input,cp,observation,secret){
 verifySigned(observation,secret,'observation',input);requireThat(observation.checkpointHash===digest(cp),'OBSERVATION_CHECKPOINT_MISMATCH');
 const atCommit=await db.$transaction(async tx=>{
  await dbIdentity(tx);await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(18435,55001)`;
  if(cp.operationalOrgSettingBefore?.bot)await tx.$queryRaw`SELECT "key" FROM "OrgSetting" WHERE "key"='telegram.botUsername' FOR UPDATE`;
  const current=await captureWithinTransaction(tx,s3,cp,secret);requireThat(canonical(current)===canonical(observation),'OWN_STATE_CHANGED_BEFORE_CLEANUP');
  for(const row of observation.storage.own){requireThat(ownStorageKey(cp,row.key),'KEY_OUTSIDE_OWN_SCOPE');await s3.send(new DeleteObjectCommand({Bucket:'pero-crm-staging',Key:row.key,...(row.versionId===null?{}:{VersionId:row.versionId})}))}
  requireThat((await storageState(s3,cp.ids.project)).own.length===0,'OWN_KEYS_RETAINED');
  const counts={},remove=async(table,ids)=>{const model=table[0].toLowerCase()+table.slice(1),result=await tx[model].deleteMany({where:{id:{in:ids}}});requireThat(result.count===ids.length,'EXACT_CLEANUP_COUNT_MISMATCH');counts[table]=result.count};
  await tx.product.update({where:{id:cp.ids.product},data:{sketchFileId:null}});
  for(const table of ['Notification','ChangeLog','File','ProductPercentageParticipant','ProductPercentageConfig','Product','Project','Client','User'])await remove(table,observation.rows[table].map(row=>row.id));
  const original=await classifyOriginal(tx,await snapshot(tx),cp);
  if(cp.operationalOrgSettingBefore)requireThat(canonical(original.operationalOrgSettingCurrent)===canonical(observation.operationalOrgSettingCurrent),'CLEANUP_OPERATIONAL_CLOCK_CAS_CHANGED');
  return {counts,originalDatabase:original.originalDatabase};
 },{isolationLevel:'Serializable',maxWait:10000,timeout:120000});
 const storage=await storageState(s3,cp.ids.project);requireThat(storage.original===cp.storageBaseline&&storage.own.length===0,'POST_CLEANUP_STORAGE_MISMATCH');
 let afterCommit;
 try{afterCommit=await readOriginalReadOnly(db,cp);}catch{return {status:'CLEANED_WITH_LATER_EXTERNAL_CHANGE',runId:cp.runId,revision:cp.revision,counts:atCommit.counts,cleanupCommitted:true,originalDatabaseAtCommit:atCommit.originalDatabase,afterCommitVerification:'UNEXPECTED_EXTERNAL_CHANGE',fullOriginalMatch:false,originalStorage:'MATCH'};}
 return {status:'CLEANED',runId:cp.runId,revision:cp.revision,counts:atCommit.counts,cleanupCommitted:true,originalDatabase:afterCommit.originalDatabase,originalDatabaseAtCommit:atCommit.originalDatabase,fullOriginalMatch:afterCommit.originalDatabase==='MATCH',originalStorage:'MATCH'};
}
async function capturePartial(db,s3,input,cp,secret){
 const policy=validatePartialRecovery(cp,input.partialPolicy);
 return db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return {status:'PARTIAL_CAPTURED',runId:cp.runId,revision:cp.revision,runtimePass:false,originalDatabase:'MATCH_EXCEPT_ACKNOWLEDGED_ORGSETTING_DRIFT',observation:await captureWithinTransaction(tx,s3,cp,secret,policy)};},{isolationLevel:'RepeatableRead',maxWait:10000,timeout:120000});
}
async function restorePartial(db,s3,input,cp,observation,secret){
 verifySigned(observation,secret,'partial-observation',input);validatePartialRecovery(cp,observation.partialPolicy);
 requireThat(observation.checkpointHash===digest(cp)&&observation.runtimePass===false&&observation.preservedOrgSetting?.priorValueKnown===false,'PARTIAL_SIGNED_OBSERVATION_REQUIRED');
 const policy=observation.partialPolicy;
 const counts=await db.$transaction(async tx=>{
  await dbIdentity(tx);await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(18435,55001)`;
  // Protect both current setting rows while disposing owned state; NEVER write them.
  await tx.$queryRaw`SELECT "key" FROM "OrgSetting" WHERE "key" IN ('productPercentageDefaults','telegram.botUsername') ORDER BY "key" FOR UPDATE`;
  const current=await captureWithinTransaction(tx,s3,cp,secret,policy);requireThat(canonical(current)===canonical(observation),'PARTIAL_STATE_CAS_CHANGED');
  for(const row of observation.storage.own){requireThat(ownStorageKey(cp,row.key)&&observation.rows.File.some(file=>fileKeys(cp,file).includes(row.key)),'PARTIAL_KEY_OUTSIDE_EXACT_FILE_SCOPE');await s3.send(new DeleteObjectCommand({Bucket:'pero-crm-staging',Key:row.key,...(row.versionId===null?{}:{VersionId:row.versionId})}))}
  requireThat((await storageState(s3,cp.ids.project)).own.length===0,'PARTIAL_OWN_KEYS_RETAINED');
  const counts={},remove=async(table,ids)=>{const model=table[0].toLowerCase()+table.slice(1),result=await tx[model].deleteMany({where:{id:{in:ids}}});requireThat(result.count===ids.length,'PARTIAL_EXACT_DELETE_COUNT_MISMATCH');counts[table]=result.count};
  await tx.product.update({where:{id:cp.ids.product},data:{sketchFileId:null}});
  for(const table of ['Notification','ChangeLog','File','ProductPercentageParticipant','ProductPercentageConfig','Product','Project','Client','User'])await remove(table,observation.rows[table].map(row=>row.id));
  const after=await snapshot(tx);requireThat(originalExceptOrgSettingMatches(after,cp.baseline),'PARTIAL_POST_CLEANUP_OTHER_ORIGINAL_CHANGED');
  requireThat(canonical(after.rows.OrgSetting)===canonical(policy.expectedOrgSetting)&&canonical(await tx.orgSetting.findMany({orderBy:{key:'asc'}}))===canonical(observation.preservedOrgSetting.rows),'PARTIAL_CURRENT_ORGSETTING_NOT_PRESERVED');
  return counts;
 },{isolationLevel:'Serializable',maxWait:10000,timeout:120000});
 const storage=await storageState(s3,cp.ids.project);requireThat(storage.original===cp.storageBaseline&&storage.own.length===0,'PARTIAL_POST_CLEANUP_STORAGE_MISMATCH');
 const afterCommit=await withReadOnlySnapshot(db,tx=>snapshot(tx)),otherOriginalMatchesAfterCommit=originalExceptOrgSettingMatches(afterCommit,cp.baseline),laterOrgSettingChange=canonical(afterCommit.rows.OrgSetting)!==canonical(policy.expectedOrgSetting);
 return {status:!otherOriginalMatchesAfterCommit?'PARTIAL_CLEANED_WITH_LATER_EXTERNAL_CHANGE':laterOrgSettingChange?'PARTIAL_CLEANED_WITH_LATER_ORGSETTING_CHANGE':'PARTIAL_CLEANED',runId:cp.runId,revision:cp.revision,counts,cleanupCommitted:true,runtimePass:false,fullOriginalMatch:false,originalDatabase:'MATCH_EXCEPT_ACKNOWLEDGED_ORGSETTING_DRIFT',currentOrgSettingPreservedAtCommit:true,preservedOrgSettingFingerprint:policy.expectedOrgSetting,afterCommitOrgSettingFingerprint:afterCommit.rows.OrgSetting,laterOrgSettingChange,otherOriginalMatchesAtCommit:true,otherOriginalMatchesAfterCommit,originalStorage:'MATCH'};
}
export function validateOwnedBrowserState(cp,manager,project,product,sketch,projectCover){
 const expected=cp.actors?.manager;
 requireThat(expected&&manager?.id===expected.id&&manager.active===true&&canonical(manager.roles)===canonical(expected.roles)&&manager.roles.includes('MANAGER')&&manager.sessionVersion===expected.sessionVersion,'HANDOFF_CURRENT_OWN_MANAGER_MISMATCH');
 requireThat(project?.id===cp.ids.project&&project.number===cp.number&&project.title===`QA112 ${cp.runId}`&&project.deletedAt===null&&product?.id===cp.ids.product&&product.projectId===project.id&&product.number===cp.productNumber&&product.title===`QA112 ${cp.runId}`&&product.deletedAt===null,'HANDOFF_CURRENT_OWN_SUBJECT_MISMATCH');
 requireThat(product.sketchFileId&&sketch?.id===product.sketchFileId,'HANDOFF_CURRENT_OWN_SKETCH_REQUIRED');fileKeys(cp,sketch);
 if(project.coverFileId){requireThat(projectCover?.id===project.coverFileId&&projectCover.projectId===project.id&&projectCover.fileName.startsWith(`qa112-${cp.runId}-`)&&projectCover.mimeType.startsWith('image/'),'HANDOFF_PROJECT_COVER_OUTSIDE_OWN_SCOPE')}
 return {origin:'https://staging-crm.peromebel.by',runId:cp.runId,revision:cp.revision,ids:{project:project.id,product:product.id},projectNumber:project.number,productNumber:product.number,ownedPaths:{project:`/projects/${encodeURIComponent(project.id)}`,product:`/products/${encodeURIComponent(product.number)}`},currentSketchFileId:sketch.id,currentProjectCoverFileId:project.coverFileId??null,manager:{id:manager.id,roles:[...manager.roles],sessionVersion:manager.sessionVersion}};
}
async function browserHandoff(db,cp,secret){
 return withReadOnlySnapshot(db,async tx=>{
  const manager=await tx.user.findUnique({where:{id:cp.actors.manager.id},select:{id:true,roles:true,active:true,sessionVersion:true}});
  const project=await tx.project.findUnique({where:{id:cp.ids.project},select:{id:true,number:true,title:true,deletedAt:true,coverFileId:true}});
  const product=await tx.product.findUnique({where:{id:cp.ids.product},select:{id:true,projectId:true,number:true,title:true,deletedAt:true,sketchFileId:true}});
  const sketch=product?.sketchFileId?await tx.file.findUnique({where:{id:product.sketchFileId}}):null;
  const projectCover=project?.coverFileId?await tx.file.findUnique({where:{id:project.coverFileId}}):null;
  const binding=validateOwnedBrowserState(cp,manager,project,product,sketch,projectCover),cookies=[];
  for(const name of ['authjs.session-token','__Secure-authjs.session-token'])cookies.push({name,value:await encode({secret,salt:name,token:{id:binding.manager.id,roles:binding.manager.roles,sessionVersion:binding.manager.sessionVersion},maxAge:15*60})});
  return {status:'PRIVATE_BROWSER_HANDOFF',...binding,profile:{id:binding.manager.id,roles:binding.manager.roles,cookies}};
 });
}
export async function main(){let db,s3,phase='guard';try{const raw=process.env.CRM_STAGING_BROWSER_INPUT;requireThat(typeof raw==='string'&&raw.length<=128*1024,'PRIVATE_INPUT_REQUIRED');delete process.env.CRM_STAGING_BROWSER_INPUT;const input=JSON.parse(Buffer.from(raw,'base64').toString('utf8')),scope=stageGuard(input);requireThat(['prepare','inspect','restore'].includes(input.operation),'OPERATION_INVALID');db=new PrismaClient({log:[],errorFormat:'minimal'});s3=s3Client();phase=input.operation;let result;if(input.operation==='prepare')result={status:'PREPARED',checkpoint:await prepare(db,s3,input,scope.secret)};else{verifySigned(input.checkpoint,scope.secret,'checkpoint',input);const cp=input.checkpoint;if(input.operation==='restore')result=input.mode==='partial-cleanup'?await restorePartial(db,s3,input,cp,input.observation,scope.secret):await restore(db,s3,input,cp,input.observation,scope.secret);else if(input.mode==='partial-capture')result=await capturePartial(db,s3,input,cp,scope.secret);else if(input.mode==='handoff')result=await browserHandoff(db,cp,scope.secret);else if(input.mode==='runtime')result=await runtime(db,s3,input,cp,scope.secret);else if(input.mode==='capture')result={status:'CAPTURED',observation:await capture(db,s3,cp,scope.secret)};else throw Error('INSPECT_MODE_REQUIRED')}console.log(JSON.stringify(result));}catch(error){console.log(JSON.stringify({status:'STOP',phase,code:/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'TASK112_STOP_PRESERVE_STATE'}));process.exitCode=1;}finally{if(db)await db.$disconnect();if(s3)s3.destroy()}}
// Load-only probe encrypts a dummy token; it never touches app data or real credentials.
export async function qaJwtDependencyProbe(){
 const secret='QA112_DEPENDENCY_PROBE_ONLY',salt='authjs.session-token',id='qa112-dependency-probe';
 const token=await encode({secret,salt,token:{id},maxAge:60});
 const decoded=await decode({secret,salt,token});
 requireThat(decoded?.id===id,'QA_JWT_ROUNDTRIP_FAILED');
 return {status:'QA_BUNDLE_PREFLIGHT_PASS',cryptoRoundTrip:true,dbInstantiated:false,s3Instantiated:false};
}
if(process.env.CRM_TASK112_DEPENDENCY_PROBE==='1')console.log(JSON.stringify(await qaJwtDependencyProbe()));
else if(process.env.CRM_STAGING_BROWSER_INPUT)await main();
