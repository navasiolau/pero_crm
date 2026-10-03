import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readCatalogueSampleAck,latestCatalogueSample} from '../src/components/catalogue-sample-control';
import {getViewableFileSource} from '../src/components/file-viewer';
import {createUploadAttempt,sendFileUpload} from '../src/lib/file-upload-client';
const target={finishId:randomUUID(),expectedSampleAssetId:null,expectedRevision:3,clientMutationId:randomUUID()};
test('catalogue ACK uses confirmed CURRENT pointer, not historical operation id',()=>{
 const currentId=randomUUID(),ack={ok:true,id:randomUUID(),finishId:target.finishId,sampleAssetId:currentId,finishRevision:7,asset:{id:currentId,fileName:'sample.png',mimeType:'image/png',size:42},clientMutationId:target.clientMutationId,repeated:true};
 assert.equal(readCatalogueSampleAck(ack,target).sampleAssetId,currentId);
 for(const value of [{...ack,clientMutationId:randomUUID()},{...ack,finishId:randomUUID()},{...ack,finishRevision:2},{...ack,sampleAssetId:randomUUID()},{...ack,asset:null},{...ack,ok:false}])assert.throws(()=>readCatalogueSampleAck(value,target));
 assert.equal(readCatalogueSampleAck({...ack,sampleAssetId:null,asset:null},target).sampleAssetId,null);
 for(const patch of [{sampleAssetId:'invalid'},{asset:{...ack.asset,mimeType:'image/svg+xml'}},{asset:{...ack.asset,size:0}},{asset:{...ack.asset,size:Infinity}},{asset:{...ack.asset,size:26*1024*1024}}])assert.throws(()=>readCatalogueSampleAck({...ack,...patch},target));
});
test('late confirmed ACK cannot overwrite newer server props observed during pending request',()=>{
 const old={revision:3,sampleAssetId:null,asset:null},props={revision:9,sampleAssetId:randomUUID(),asset:null},ack={revision:7,sampleAssetId:randomUUID(),asset:null};
 assert.equal(latestCatalogueSample(old,props,ack),props);assert.equal(latestCatalogueSample(props,old,ack),props);
 const fresh={...ack,revision:10};assert.equal(latestCatalogueSample(old,props,fresh),fresh);
});
test('trusted catalogue viewer route preserves ordinary file behavior and cannot accept raw source URLs',()=>{
 const file={id:'sample/id',fileName:'sample.png',mimeType:'image/png'};
 assert.equal(getViewableFileSource(file),'/api/files/sample/id');
 assert.equal(getViewableFileSource({...file,scope:'catalogue-media'}),'/api/catalogue-media/sample%2Fid');
});
test('catalogue upload retries original immutable form/CID through the same safe decoder',async()=>{
 const form=new FormData(),bytes=new Uint8Array([1,2,3]);form.set('finishId',target.finishId);form.set('file',new File([bytes],'sample.png',{type:'image/png'}));const attempt=createUploadAttempt(form,target.clientMutationId);let calls=0;const bodies:unknown[]=[];
 const fetcher:typeof fetch=async(url,init)=>{assert.equal(url,'/api/catalogue-media/upload');bodies.push(init!.body);if(++calls===1)throw Error('lost');return new Response(JSON.stringify({ok:true,id:'asset',clientMutationId:target.clientMutationId}),{status:200});};
 const failed=await sendFileUpload(attempt,{endpoint:'/api/catalogue-media/upload',fetcher});assert.equal(failed.ok,false);if(!failed.ok)assert.equal(failed.failure.commitState,'unknown');
 assert.equal((await sendFileUpload(attempt,{endpoint:'/api/catalogue-media/upload',fetcher})).ok,true);assert.equal(bodies[0],bodies[1]);assert.deepEqual(new Uint8Array(await (form.get('file') as File).arrayBuffer()),bytes);assert.equal(calls,2);
});
