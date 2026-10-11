// Отдельный tiny-cohort129 рядом с113. Guard/manifest113 не изменены.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при guard mismatch.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonical,digest,sha,signed,verifySignedFixture,FIXTURE_NAMESPACE,DISABLED_PASSWORD} from './file-fixture113-protocol.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const exactKeys=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),'EXACT_MANIFEST_FIELDS');
const definitions=[['png','image/png','png',false,true],['pdf','application/pdf','pdf',false,true],['html','text/html','html',false,true],['svg','image/svg+xml','svg',true,true],['corrupt','image/png','png',false,true],['missing','image/png','png',false,false]];
function fixtureBytes(kind,media){
 const bytes=kind==='png'||kind==='missing'?media.png:kind==='pdf'?media.pdf:Buffer.from(kind==='html'?'<!doctype html><p>inert QA129</p>':kind==='svg'?'<svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="10">inert QA129</text></svg>':'PERO QA129 corrupt raster');
 assert.ok(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=65536,'TINY_OWNED_BYTES_REQUIRED');return Buffer.from(bytes);
}
export function newFile129Plan(runId,revision,media){
 assert.match(runId,UUID);assert.match(revision,/^[a-f0-9]{40}$/);
 const actors=Object.fromEntries([['admin','ADMIN'],['engineer','ENGINEER'],['foreignEngineer','ENGINEER']].map(([key,role])=>[key,{id:randomUUID(),name:'QA129 '+key+' '+runId,email:randomUUID()+'@invalid.test',roles:[role],passwordHash:DISABLED_PASSWORD,sessionVersion:0}]));
 const clientId=randomUUID(),projects={own:randomUUID(),foreign:randomUUID()};
 const products={own:{id:randomUUID(),projectId:projects.own,engineerId:actors.engineer.id,status:'PRODUCTION'},foreign:{id:randomUUID(),projectId:projects.foreign,engineerId:actors.foreignEngineer.id,status:'PRODUCTION'}};
 const files=definitions.map(([kind,mimeType,extension,hasThumb,originalExists])=>{
  const id=randomUUID(),fileName='qa129-'+runId+'-'+kind+'.'+extension,storedName=randomUUID()+'-'+fileName,bytes=fixtureBytes(kind,media);
  return {id,kind,projectId:projects.own,productId:products.own.id,uploadedById:actors.admin.id,section:'PRODUCTION',fileName,storedName,mimeType,hasThumb,originalExists,key:projects.own+'/'+storedName,contentHash:sha(bytes),size:bytes.length};
 });
 return {namespace:'PERO_FILE_AUX_129_V1',runId,revision,actors,clientId,projects,products,files,numberInt:null,originalActorsReused:false};
}
export function validateFile129Plan(p){
 assert.ok(p?.namespace==='PERO_FILE_AUX_129_V1'&&UUID.test(p.runId)&&/^[a-f0-9]{40}$/.test(p.revision),'AUX129_BINDING');
 exactKeys(p,['namespace','runId','revision','actors','clientId','projects','products','files','numberInt','originalActorsReused']);
 assert.deepEqual(Object.keys(p.actors).sort(),['admin','engineer','foreignEngineer']);assert.equal(p.originalActorsReused,false);
 for(const[key,a]of Object.entries(p.actors)){exactKeys(a,['id','name','email','roles','passwordHash','sessionVersion']);assert.match(a.id,UUID);assert.equal(a.passwordHash,DISABLED_PASSWORD);assert.equal(a.sessionVersion,0);assert.deepEqual(a.roles,[key==='admin'?'ADMIN':'ENGINEER']);assert.equal(a.name,'QA129 '+key+' '+p.runId);assert.match(a.email,/^[a-f0-9-]{36}@invalid\.test$/);}
 assert.match(p.clientId,UUID);assert.deepEqual(Object.keys(p.projects).sort(),['foreign','own']);assert.deepEqual(Object.keys(p.products).sort(),['foreign','own']);
 for(const key of ['own','foreign']){exactKeys(p.products[key],['id','projectId','engineerId','status']);assert.match(p.projects[key],UUID);assert.match(p.products[key].id,UUID);assert.equal(p.products[key].status,'PRODUCTION');assert.equal(p.products[key].projectId,p.projects[key]);assert.equal(p.products[key].engineerId,p.actors[key==='own'?'engineer':'foreignEngineer'].id);}
 assert.equal(p.files.length,6);
 p.files.forEach((f,i)=>{exactKeys(f,['id','kind','projectId','productId','uploadedById','section','fileName','storedName','mimeType','hasThumb','originalExists','key','contentHash','size']);const[kind,mimeType,extension,hasThumb,originalExists]=definitions[i];assert.equal(f.kind,kind);assert.equal(f.mimeType,mimeType);assert.equal(f.hasThumb,hasThumb);assert.equal(f.originalExists,originalExists);assert.match(f.id,UUID);assert.equal(f.projectId,p.projects.own);assert.equal(f.productId,p.products.own.id);assert.equal(f.uploadedById,p.actors.admin.id);assert.equal(f.section,'PRODUCTION');assert.equal(f.fileName,'qa129-'+p.runId+'-'+kind+'.'+extension);assert.match(f.storedName.slice(0,36),UUID);assert.equal(f.storedName.slice(36),'-'+f.fileName);assert.equal(f.key,f.projectId+'/'+f.storedName);assert.match(f.contentHash,/^[a-f0-9]{64}$/);assert.ok(Number.isInteger(f.size)&&f.size>0&&f.size<=65536);});
 const all=[p.clientId,...Object.values(p.projects),...Object.values(p.products).map(x=>x.id),...Object.values(p.actors).map(x=>x.id),...p.files.map(x=>x.id)];assert.equal(new Set(all).size,14,'UNIQUE_14_OWNED_ROWS');
 assert.ok(p.numberInt===null||Number.isSafeInteger(p.numberInt)&&p.numberInt>0&&p.numberInt<2147483646);return p;
}
export function cohort129Scope(p){validateFile129Plan(p);return {User:{column:'id',ids:Object.values(p.actors).map(a=>a.id)},Client:{column:'id',ids:[p.clientId]},Project:{column:'id',ids:Object.values(p.projects)},Product:{column:'id',ids:Object.values(p.products).map(x=>x.id)},File:{column:'id',ids:p.files.map(f=>f.id)}};}
function keys(p){return p.files.flatMap(f=>[f.key,...(f.hasThumb?[f.projectId+'/thumbs/'+f.storedName+'.jpg']:[])]);}
export function assert129Keys(p,input){validateFile129Plan(p);assert.ok(Array.isArray(input)&&new Set(input).size===input.length&&input.every(k=>keys(p).includes(k)),'EXACT_OWNED_STORAGE_KEYS');}
export function file129HttpCases(p){
 validateFile129Plan(p);const f=Object.fromEntries(p.files.map(row=>[row.kind,row]));
 const row=(name,kind,query,status,actor='admin',extra={})=>({name,method:'GET',path:'/api/files/'+f[kind].id+query,status,actor,...extra});
 return [row('png-thumb-no-original','png','?thumb=1',200,'admin',{reencoded:true}),row('png-preview-card','png','?preview=card&thumb=1',200,'admin',{reencoded:true}),row('png-download-original','png','',200,'admin',{sha256:f.png.contentHash,attachment:true}),row('pdf-view','pdf','?view=1',200,'admin',{sha256:f.pdf.contentHash,inlinePdf:true}),row('pdf-download','pdf','',200,'admin',{sha256:f.pdf.contentHash,attachment:true}),row('html-thumb-denied','html','?thumb=1',415),row('html-download','html','',200,'admin',{sha256:f.html.contentHash,attachment:true}),row('svg-thumb-inert-legacy','svg','?thumb=1',415),row('svg-download','svg','',200,'admin',{sha256:f.svg.contentHash,attachment:true}),row('corrupt-thumb-denied','corrupt','?thumb=1',422),row('missing-original','missing','',404),row('engineer-production','png','?thumb=1',200,'engineer',{reencoded:true}),row('foreign-engineer','png','?thumb=1',404,'foreignEngineer'),row('anonymous','png','?thumb=1',401,null)];
}
/** Все handles — reviewed163/113 bindings, не JSON input. Отдельный phase approval до каждого эффекта. */
export function createFile129Cohort(b){
 const {guard,db,publish,captureOriginal,compareOriginal,lockExactOwnedRows,assertNoForeignReferences,captureStorage,putOwned,deleteOwnedVersion,secret}=b;
 const signedPart=(kind,p,body)=>signed({namespace:FIXTURE_NAMESPACE,version:2,kind:'aux129-'+kind,runId:p.runId,revision:p.revision,...body},secret);
 const checked=(part,kind,context)=>{const body=verifySignedFixture(part,secret,'aux129-'+kind,context);assert.equal(body.revision,context.revision);return body;};
 const binding=async(context,p,operation)=>{await guard(context,operation,p);validateFile129Plan(p);assert.equal(context.target,'staging');assert.equal(context.runId,p.runId);assert.equal(context.revision,p.revision);};
 const currentRows=async(tx,p)=>{const out={};for(const[table,value]of Object.entries(cohort129Scope(p)))out[table]=await tx.$queryRawUnsafe('SELECT to_jsonb(t) AS row FROM public."'+table+'" t WHERE id=ANY($1::text[]) ORDER BY id',value.ids).then(rs=>rs.map(r=>r.row));return out;};
 return {
  async prepare(context,p,media){
   await binding(context,p,'prepare');assert.equal(p.numberInt,null);
   const number=(await db.project.aggregate({_max:{numberInt:true}}))._max.numberInt??0;p.numberInt=number+1;validateFile129Plan(p);
   const scope=cohort129Scope(p),original=await captureOriginal(db,scope),storage=await captureStorage(keys(p));assert.equal(storage.own.length,0,'NO_EXISTING_OWNED_OBJECTS');
   for(const[table,value]of Object.entries(scope)){const [{count}]=await db.$queryRawUnsafe('SELECT count(*)::int count FROM public."'+table+'" WHERE id=ANY($1::text[])',value.ids);assert.equal(count,0,'OWNED_ID_COLLISION');}
   const pre=signedPart('pre',p,{plan:p,original,storage});await publish('aux129-pre',pre);
   for(const f of p.files){if(!f.originalExists)continue;const bytes=fixtureBytes(f.kind,media);assert.equal(sha(bytes),f.contentHash,'OWNED_BYTES_CHANGED');assert129Keys(p,[f.key]);const version=await putOwned(f.key,bytes,f.mimeType);assert.equal(version.key,f.key);assert.ok(typeof version.versionId==='string'&&version.versionId.length>0);await publish('aux129-version-'+f.kind,signedPart('version',p,{key:f.key,version}));}
   const svg=p.files.find(f=>f.kind==='svg'),legacyKey=svg.projectId+'/thumbs/'+svg.storedName+'.jpg';assert129Keys(p,[legacyKey]);const legacy=await putOwned(legacyKey,Buffer.from('inert QA129 legacy thumb'),'image/jpeg');assert.equal(legacy.key,legacyKey);assert.ok(typeof legacy.versionId==='string'&&legacy.versionId.length>0);await publish('aux129-version-legacy',signedPart('version',p,{key:legacyKey,version:legacy}));
   await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(18435,55129)');assert.equal(((await tx.project.aggregate({_max:{numberInt:true}}))._max.numberInt??0)+1,p.numberInt,'PROJECT_NUMBER_CHANGED');
    compareOriginal(original,await captureOriginal(tx,scope));
    for(const actor of Object.values(p.actors))await tx.user.create({data:{...actor,active:true,payScheme:'NONE'}});
    await tx.client.create({data:{id:p.clientId,name:'QA129 '+p.runId,phone:'100'}});
    for(const[key,projectId]of Object.entries(p.projects)){const n=p.numberInt+(key==='own'?0:1);await tx.project.create({data:{id:projectId,number:String(n),numberInt:n,title:'QA129 '+p.runId,clientId:p.clientId,currency:'BYN',stage:'CONTRACT'}});const product=p.products[key];await tx.product.create({data:{...product,number:n+'.1',suffixInt:1,title:'QA129 '+p.runId,expectedPrice:'0',quantity:1}});}
    for(const f of p.files){const data=Object.fromEntries(['id','projectId','productId','uploadedById','section','fileName','storedName','mimeType','hasThumb','size'].map(key=>[key,f[key]]));await tx.file.create({data});}
    compareOriginal(original,await captureOriginal(tx,scope));
   },{isolationLevel:'Serializable',timeout:120000});
   const rows=await currentRows(db,p),now=await captureStorage(keys(p));assert.equal(rows.File.length,6);compareOriginal(original,await captureOriginal(db,scope));assert.equal(now.originalHash,storage.originalHash);assert.equal(now.originalCount,storage.originalCount);
   return publish('aux129-prepared',signedPart('prepared',p,{preHash:digest(pre),rowsHash:digest(rows),storage:now,scope}));
  },
  async inspect(context,rawPre){
   const pre=checked(rawPre,'pre',context),p=pre.plan;await binding(context,p,'inspect');compareOriginal(pre.original,await captureOriginal(db,cohort129Scope(p)));
   const rows=await currentRows(db,p),storage=await captureStorage(keys(p));assert.equal(storage.originalHash,pre.storage.originalHash);assert.equal(storage.originalCount,pre.storage.originalCount);
   return publish('aux129-observation',signedPart('observation',p,{preHash:digest(rawPre),rowsHash:digest(rows),rowCounts:Object.fromEntries(Object.entries(rows).map(([t,r])=>[t,r.length])),storage}));
  },
  async cleanup(context,rawPre,rawObservation){
   const pre=checked(rawPre,'pre',context),observation=checked(rawObservation,'observation',context),p=pre.plan;await binding(context,p,'cleanup');assert.equal(observation.preHash,digest(rawPre));assert129Keys(p,observation.storage.own.map(v=>v.key));
   await publish('aux129-cleanup-intent',signedPart('cleanup-intent',p,{observationHash:digest(rawObservation)}));
   await db.$transaction(async tx=>{
    const scope=cohort129Scope(p);await lockExactOwnedRows(tx,scope);await assertNoForeignReferences(tx,scope);
    const rows=await currentRows(tx,p);assert.equal(digest(rows),observation.rowsHash,'CURRENT_OWNED_ROWS_REQUIRED');compareOriginal(pre.original,await captureOriginal(tx,scope));
    const storage=await captureStorage(keys(p));assert.equal(canonical(storage),canonical(observation.storage),'CURRENT_EXACT_VERSIONS_REQUIRED');
    for(const version of storage.own){assert129Keys(p,[version.key]);assert.ok(typeof version.versionId==='string'&&version.versionId.length>0);await deleteOwnedVersion(version);}
    const remaining=await captureStorage(keys(p));assert.equal(remaining.own.length,0);assert.equal(remaining.originalHash,pre.storage.originalHash);assert.equal(remaining.originalCount,pre.storage.originalCount);
    for(const table of ['File','Product','Project','Client','User']){const expected=scope[table].ids;const count=await tx.$executeRawUnsafe('DELETE FROM public."'+table+'" WHERE id=ANY($1::text[])',expected);assert.equal(count,expected.length,'EXACT_OWNED_DELETE_COUNT');}
    compareOriginal(pre.original,await captureOriginal(tx,{}));
   },{isolationLevel:'RepeatableRead',timeout:120000});
   compareOriginal(pre.original,await captureOriginal(db,{}));const after=await captureStorage(keys(p));assert.equal(after.own.length,0);assert.equal(after.originalHash,pre.storage.originalHash);assert.equal(after.originalCount,pre.storage.originalCount);
   return publish('aux129-cleanup-ack',signedPart('cleanup-ack',p,{remainingRows:0,remainingOwnVersions:0}));
  }
 };
}

/** Только GET к actual app через существующий113 транспорт/свежие own-cookie profiles. */
export async function checkFile129Http(context,plan,{guard,request,decodeRaster,publish}){
 await guard(context,'readonly',plan);validateFile129Plan(plan);assert.equal(context.target,'staging');assert.equal(context.revision,plan.revision);assert.equal(context.runId,plan.runId);
 const checks=[];
 const bounded=async response=>{const chunks=[];let size=0;for await(const chunk of response.body??[]){size+=chunk.length;assert.ok(size<=131072,'BOUNDED_OWN_RESPONSE');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);};
 for(const scenario of file129HttpCases(plan)){
  const response=await request(scenario);assert.equal(response.status,scenario.status,scenario.name);const bytes=await bounded(response);
  if(response.status===200||scenario.path.includes('thumb=1')&&response.status!==401){assert.equal(response.headers.get('x-content-type-options'),'nosniff',scenario.name+' nosniff');assert.match(response.headers.get('cache-control')??'',/private/,scenario.name+' private');assert.match(response.headers.get('vary')??'',/Cookie/);}
  if(scenario.sha256)assert.equal(sha(bytes),scenario.sha256,scenario.name+' original bytes');
  if(scenario.attachment)assert.match(response.headers.get('content-disposition')??'',/^attachment/);
  if(scenario.inlinePdf){assert.match(response.headers.get('content-disposition')??'',/^inline/);assert.equal(response.headers.get('content-type'),'application/pdf');}
  if(scenario.reencoded){const original=plan.files.find(f=>f.kind==='png');assert.notEqual(sha(bytes),original.contentHash,'THUMB_MUST_NOT_BE_ORIGINAL');assert.equal(response.headers.get('content-type'),'image/webp');const size=await decodeRaster(bytes);assert.ok(size.width>0&&size.height>0&&size.width<=600&&size.height<=600,'BOUNDED_RASTER');assert.match(response.headers.get('content-disposition')??'',/^inline/);
   const etag=response.headers.get('etag');assert.ok(etag,'PREVIEW_ETAG_REQUIRED');const cached=await request({...scenario,headers:{'If-None-Match':etag}});assert.equal(cached.status,304);assert.equal((await bounded(cached)).length,0);assert.equal(cached.headers.get('content-length'),null);assert.equal(cached.headers.get('etag'),etag);assert.match(cached.headers.get('cache-control')??'',/private/);assert.match(cached.headers.get('vary')??'',/Cookie/);
  }
  checks.push({scenarioId:scenario.name,status:response.status,level:'actual-app-http',originalBytes:scenario.sha256?'PASS':'NOT_APPLICABLE',nativePrint:'NOT_RUN'});
 }
 return publish('aux129-http',{target:context.target,revision:context.revision,runId:context.runId,checks});
}
