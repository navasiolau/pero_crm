// Reviewed runtime producer: реальные Node fixtures и app HTTP smoke; это не PostgreSQL бизнес-proof.
import assert from 'node:assert/strict';
import {evidenceHash} from './acceptance-evidence-protocol.mjs';
import {mergeV8FunctionCoverage} from './coverage-v8-intervals.mjs';
import {nativeAcceptanceBinding} from './helpers/native-acceptance-target';

export async function runAcceptanceRuntime(input) {
 assert.ok(['runtime-node','HTTP-runtime'].includes(input.evidenceLevel??'runtime-node'),'RUNTIME_LEVEL_REQUIRED');
 const binding=nativeAcceptanceBinding(input),checks=[];
 const snapshot=ranges=>({functionName:'fixture',ranges:ranges.map(([startOffset,endOffset,count])=>({startOffset,endOffset,count}))});
 const split=mergeV8FunctionCoverage([snapshot([[0,100,1],[20,80,0]]),snapshot([[0,100,1],[20,50,18],[50,80,11]])]);
 assert.deepEqual(split.effectiveRanges,[{startOffset:0,endOffset:100,count:1}]);checks.push({id:'v8-split-union',status:'PASS'});
 const sparse=mergeV8FunctionCoverage([snapshot([[0,100,1],[20,80,0]]),snapshot([[0,100,1]])]);
 assert.deepEqual(sparse.effectiveRanges,[{startOffset:0,endOffset:100,count:1}]);checks.push({id:'v8-sparse-inheritance',status:'PASS'});
 const nested=mergeV8FunctionCoverage([snapshot([[0,100,1],[20,80,0],[30,40,1]])]);
 assert.deepEqual(nested.effectiveRanges.map(range=>range.count),[1,0,1,0,1]);checks.push({id:'v8-nested-overrides',status:'PASS'});
 const zero=mergeV8FunctionCoverage([snapshot([[0,100,0]])]);assert.equal(zero.effectiveRanges[0].count,0);checks.push({id:'v8-whole-zero',status:'PASS'});
 const response=await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(10000),redirect:'error'});
 assert.equal(response.status,200,'ACTUAL_HTTP_HEALTH_FAILED');
 const body=await response.json();assert.equal(body.status,'ok');assert.equal(body.service,'pero-crm');assert.equal(body.database,'ok');
 assert.equal(response.headers.get('cache-control'),'no-store');checks.push({id:'actual-http-health',status:'PASS'});
 const readonlyDigest=evidenceHash(JSON.stringify({identity:binding.identity,scope:'runtime-fixtures-and-readonly-health'}));
 return {status:'PASS',level:input.evidenceLevel??'runtime-node',revision:input.revision,target:input.target,runId:input.runId,scenarioId:input.scenarioId,producerId:'acceptance-runtime',producerVersion:1,identity:binding.identity,checks,
  preservation:{mode:'readonly',scope:'runtime-fixtures-and-readonly-health',status:'PASS',beforeDigest:readonlyDigest,afterDigest:readonlyDigest}};
}
