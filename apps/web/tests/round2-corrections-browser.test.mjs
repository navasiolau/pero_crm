import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {assertRound2Boundary,assertRound2CoverCase,assertRound2DraftSum,createRound2CorrectionsExtension} from './round2-corrections-browser.mjs';
const fixture={checkpoint:{target:'local',runId:'owned-run'},ids:{productA:'a'},paths:{productA:'/products/1.1',productB:'/products/1.2'}},baselineProof={status:'VERIFIED',fixtureRunId:'owned-run',conversionCompletedAt:'2026-10-02T10:00:00Z',fixturePreparedAt:'2026-10-02T10:01:00Z'},options={authorized:true,guardedTransportInstalled:true,origin:'http://127.0.0.1:3019',fixture,baselineProof};
test('round2 cannot accept production, unguarded transport or pre-conversion baseline',()=>{
 assert.doesNotThrow(()=>assertRound2Boundary(options));for(const change of [{authorized:false},{guardedTransportInstalled:false},{origin:'https://crm.peromebel.by'},{baselineProof:{...baselineProof,fixtureRunId:'foreign'}},{baselineProof:{...baselineProof,fixturePreparedAt:'2026-10-02T09:59:00Z'}}])assert.throws(()=>assertRound2Boundary({...options,...change}),/ROUND2_/);assert.throws(()=>createRound2CorrectionsExtension({}),/ROOT_AUTH_REQUIRED/);
});
test('cover extension accepts only existing original known bytes, never foreign/new upload scope',()=>{
 const buffer=Buffer.from('original-known-case'),item={key:'cover',cover:true,productId:'a',mimeType:'image/png',buffer,hash:createHash('sha256').update(buffer).digest('hex')};assert.doesNotThrow(()=>assertRound2CoverCase(item,fixture));for(const change of [{productId:'foreign'},{key:'new-image'},{buffer:Buffer.from('changed')},{mimeType:'application/pdf'}])assert.throws(()=>assertRound2CoverCase({...item,...change},fixture),/ROUND2_/);
});
test('read-only sum oracle preserves exact draft money and unknown NULL without a fake zero',()=>{
 assert.doesNotThrow(()=>assertRound2DraftSum('12.34','3','Сумма: 37,02 BYN'));assert.doesNotThrow(()=>assertRound2DraftSum('0','3','Сумма: 0 BYN'));assert.doesNotThrow(()=>assertRound2DraftSum('','3','Сумма: —'));assert.throws(()=>assertRound2DraftSum('','3','Сумма: 0 BYN'),/NULL_SUM/);assert.throws(()=>assertRound2DraftSum('12.34','3','Сумма: 37,03 BYN'),/SUM_MATH/);
});
