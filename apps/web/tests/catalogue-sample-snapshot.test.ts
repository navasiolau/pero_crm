import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {patchProductFinishCore} from '../src/server/product-finishes/core';
import {productFinishRow} from '../src/server/product-finishes/contracts';
import {snapshotFixture} from './helpers/product-finish-sample-fixture';
const actor={id:'manager',name:'Manager',roles:['MANAGER' as const],source:'web' as const};
test('new assignment copies exact actual sample and catalogue edits never change existing snapshot',async()=>{const f=snapshotFixture(),result=await patchProductFinishCore(actor,f.input,f.transaction);assert.equal(result.kind,'saved');if(result.kind!=='saved')return;assert.equal(result.row?.sampleAssetId,f.asset.id);assert.equal(result.row?.sampleAsset?.fileName,'sample.png');f.finish.sampleAssetId=randomUUID();f.finish.name='Changed';assert.equal(f.rows[0].sampleAssetId,f.asset.id);assert.equal(f.rows[0].finishName,'Stored');});
test('old absent/null image maps to null, never live catalogue image or inferred backfill',()=>{const f=snapshotFixture(),old={id:'old',productId:'p',element:'Корпус',finishId:f.finish.id,finishKind:'ENAMEL',finishName:'Old',finishCode:'Old',finishColor:'White',catalogRevision:0,sampleAssetId:null};assert.equal(productFinishRow(old as never).sampleAssetId,null);assert.equal(productFinishRow({...old,sampleAssetId:undefined} as never).sampleAssetId,null);assert.equal(productFinishRow(old as never).sampleAsset,null);});

 test('uppercase entity UUIDs normalize before storage/fingerprint; noncanonical CID rejected before write',async()=>{
 const {sampleTargetSchema}=await import('../src/server/catalogue-media/contracts');const{catalogueMediaKey}=await import('../src/lib/catalogue-media-url');const finishId=randomUUID(),assetId=randomUUID(),cid=randomUUID();const parsed=sampleTargetSchema.parse({finishId:finishId.toUpperCase(),expectedSampleAssetId:assetId.toUpperCase(),expectedRevision:0,clientMutationId:cid});assert.equal(parsed.finishId,finishId);assert.equal(parsed.expectedSampleAssetId,assetId);assert.equal(catalogueMediaKey(finishId.toUpperCase(),assetId.toUpperCase()),catalogueMediaKey(finishId,assetId));assert.equal(sampleTargetSchema.safeParse({...parsed,clientMutationId:cid.toUpperCase()}).success,false);
 });
