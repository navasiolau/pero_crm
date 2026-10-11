import assert from 'node:assert/strict';
import {test} from 'node:test';
import {signed,digest,FIXTURE_NAMESPACE} from './file-fixture113-protocol.mjs';
import {newFile129Plan,validateFile129Plan,cohort129Scope,assert129Keys,createFile129Cohort,file129HttpCases,checkFile129Http} from './file-fixture129-cohort.mjs';
const runId='6b999999-1111-4111-8111-999999999999',revision='b'.repeat(40),media={png:Buffer.from('fake png only cold'),pdf:Buffer.from('%PDF-1.4 cold')};
test('six fixed tiny files, pure ENGINEER and foreign cohort, no113 scope broadening',()=>{
 const p=newFile129Plan(runId,revision,media);validateFile129Plan(p);
 assert.equal(p.files.length,6);assert.equal(p.files.filter(row=>row.originalExists).length,5);
 assert.deepEqual(p.actors.engineer.roles,['ENGINEER']);assert.notEqual(p.actors.foreignEngineer.id,p.actors.engineer.id);
 assert.equal(p.products.own.status,'PRODUCTION');assert.equal(p.products.foreign.status,'PRODUCTION');
 assert.equal(cohort129Scope(p).File.ids.length,6);
 for(const f of p.files)assert129Keys(p,[f.key]);
 assert.throws(()=>assert129Keys(p,['foreign/project/object']));
 for(const mutate of [q=>q.files.push(q.files[0]),q=>q.actors.engineer.roles.push('ADMIN'),q=>q.files[0].key='foreign/key',q=>q.products.own.engineerId=q.actors.foreignEngineer.id]){
  const q=structuredClone(p);mutate(q);assert.throws(()=>validateFile129Plan(q));
 }
});
test('GET matrix includes raster reencode, SVG/HTML deny even legacy thumb, PDF/download and ACL',()=>{
 const p=newFile129Plan(runId,revision,media),cases=file129HttpCases(p);
 assert.ok(cases.some(c=>c.name==='png-thumb-no-original'&&c.status===200));
 assert.ok(cases.some(c=>c.name==='svg-thumb-inert-legacy'&&c.status===415));
 assert.ok(cases.some(c=>c.name==='pdf-view'&&c.status===200));
 assert.ok(cases.some(c=>c.name==='engineer-production'&&c.status===200));
 assert.ok(cases.some(c=>c.name==='foreign-engineer'&&c.status===404));
 assert.ok(cases.every(c=>c.method==='GET'));
});
test('guard failure precedes DB/storage/media/session operations',async()=>{
 let calls=0;const p=newFile129Plan(runId,revision,media);
 const cohort=createFile129Cohort({guard:async()=>{throw Error('SOURCE_GUARD');},db:{get $transaction(){calls++;throw Error('SQL');}},putOwned:()=>{calls++;}});
 await assert.rejects(cohort.prepare({target:'staging',runId,revision},p,media),/SOURCE_GUARD/);assert.equal(calls,0);
});

test('durable PRE failure including falsy rejection stops before first storage or DB insert',async()=>{
 for(const failure of [Error('write failed'),undefined]){
  const p=newFile129Plan(runId,revision,media),effects=[];
  const db={project:{aggregate:async()=>({_max:{numberInt:100}})},$queryRawUnsafe:async()=>[{count:0}],$transaction:async()=>effects.push('sql')};
  const producer=createFile129Cohort({guard:async()=>{},db,secret:'cold-private-key',captureOriginal:async()=>({hash:'same'}),captureStorage:async()=>({originalHash:'same',originalCount:0,own:[]}),publish:async()=>{effects.push('pre');throw failure;},putOwned:async()=>effects.push('storage')});
  let rejected=false;try{await producer.prepare({target:'staging',runId,revision},p,media);}catch(error){rejected=true;assert.equal(error,failure);}
  assert.equal(rejected,true);assert.deepEqual(effects,['pre']);
 }
});
test('cleanup incoming foreign FK or changed original fingerprint refuses before storage/delete',async()=>{
 for(const failureAt of ['foreign','original']){
  const p=newFile129Plan(runId,revision,media),context={target:'staging',runId,revision},calls=[];
  const rows=Object.fromEntries(Object.entries(cohort129Scope(p)).map(([table,s])=>[table,s.ids.map(id=>({id}))]));
  const storage={originalHash:'same',originalCount:0,own:[]};
  const sign=(kind,body)=>signed({namespace:FIXTURE_NAMESPACE,version:2,kind:'aux129-'+kind,runId,revision,...body},'cold-private-key');
  const pre=sign('pre',{plan:p,original:{hash:'before'},storage});
  const observation=sign('observation',{preHash:digest(pre),rowsHash:digest(rows),storage});
  const tx={$queryRawUnsafe:async query=>{const table=/public."(\w+)"/.exec(query)[1];return rows[table].map(row=>({row}));},$executeRawUnsafe:async()=>calls.push('delete')};
  const producer=createFile129Cohort({guard:async()=>{},db:{$transaction:async fn=>fn(tx)},secret:'cold-private-key',publish:async()=>calls.push('intent'),lockExactOwnedRows:async()=>calls.push('lock'),assertNoForeignReferences:async()=>{calls.push('foreign');if(failureAt==='foreign')throw Error('FOREIGN_REFERENCE');},captureOriginal:async()=>({hash:'changed'}),compareOriginal:()=>{calls.push('original');throw Error('ORIGINAL_CHANGED');},captureStorage:async()=>{calls.push('storage');return storage;},deleteOwnedVersion:async()=>calls.push('storage-delete')});
  await assert.rejects(producer.cleanup(context,pre,observation),failureAt==='foreign'?/FOREIGN_REFERENCE/:/ORIGINAL_CHANGED/);
  assert.ok(!calls.includes('delete')&&!calls.includes('storage')&&!calls.includes('storage-delete'));assert.deepEqual(calls.slice(0,3),['intent','lock','foreign']);
 }
});

test('actual-HTTP checker refuses original bytes as thumb before accepting any scenario',async()=>{
 const plan=newFile129Plan(runId,revision,media),context={target:'staging',runId,revision};let requests=0,published=0;
 const headers={'Content-Type':'image/webp','Content-Disposition':'inline','Cache-Control':'private, max-age=0, must-revalidate','Vary':'Cookie','X-Content-Type-Options':'nosniff','ETag':'"cold"'};
 await assert.rejects(checkFile129Http(context,plan,{guard:async()=>{},request:async()=>{requests++;return new Response(media.png,{status:200,headers});},decodeRaster:async()=>assert.fail('decode forbidden after original fallback'),publish:async()=>published++}),/THUMB_MUST_NOT_BE_ORIGINAL/);
 assert.equal(requests,1);assert.equal(published,0);
});
test('304 body/Content-Length is rejected even after valid bounded reencode',async()=>{
 const plan=newFile129Plan(runId,revision,media),context={target:'staging',runId,revision};let requests=0;
 const headers={'Content-Type':'image/webp','Content-Disposition':'inline','Cache-Control':'private, max-age=0, must-revalidate','Vary':'Cookie','X-Content-Type-Options':'nosniff','ETag':'"cold"'};
 await assert.rejects(checkFile129Http(context,plan,{guard:async()=>{},request:async()=>{requests++;return requests===1?new Response(Buffer.from('cold transformed raster'),{status:200,headers}):new Response(null,{status:304,headers:{...headers,'Content-Length':'0'}});},decodeRaster:async()=>({width:160,height:120}),publish:async()=>assert.fail('not accepted')}));
 assert.equal(requests,2);
});
