import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {authoredObservations,unchangedInputs} from './coverage-baseline-core.mjs';

function fixture() {
  const file=path.resolve('authored-example.ts');
  const text='export function branch(value:boolean){\n if(value) return 1;\n return 0;\n}\n';
  const helper='const getter=function branch(){return branch};\n';
  const generated=helper+'function branch(value){\n if(value) return 1;\n return 0;\n}\n';
  const lengths=generated.split('\n').map(line=>line.length), start=helper.length;
  const untouched=start+'function branch(value){\n if(value) return 1;\n'.length;
  const cache={lineLengths:lengths,data:{version:3,sources:[pathToFileURL(file).href],sourcesContent:[text],names:[],mappings:';AAAO;AACP;AACA;AACA'}};
  const script={url:pathToFileURL(file).href,functions:[
    {functionName:'branch',ranges:[{startOffset:helper.indexOf('function'),endOffset:helper.length-2,count:1}]},
    {functionName:'branch',ranges:[{startOffset:start,endOffset:generated.length-1,count:1},{startOffset:untouched,endOffset:untouched+' return 0;'.length,count:0}]},
  ]};
  return {file,text,cache,script};
}

test('authored source-map observations retain unexecuted body and exclude generated same-name getter',()=>{
  const f=fixture(), result=authoredObservations(f.script,f.cache,f.text,f.file);
  assert.equal(result.status,'MEASURED');
  assert.equal(result.functions.length,1);
  assert.equal(result.functions[0].name,'branch');
  assert.equal(result.functions[0].executed,true);
  assert.equal(result.functions[0].ranges.length,2);
  assert.equal(result.functions[0].ranges.filter(range=>!range.executed).length,1);
  assert.equal(Object.hasOwn(result,'coveredLinePercent'),false);
});

test('missing or altered source maps remain BLOCKED without a fabricated percentage',()=>{
  const f=fixture();
  assert.equal(authoredObservations(f.script,null,f.text,f.file).reason,'SOURCE_MAP_UNAVAILABLE');
  assert.equal(authoredObservations(f.script,f.cache,f.text+'\n',f.file).reason,'SOURCE_MAP_CONTENT_MISMATCH');
  assert.equal(authoredObservations(f.script,f.cache,f.text+'\n',f.file).functions.length,0);
});

test('a source change during measurement cannot reuse a successful baseline',()=>{
  assert.doesNotThrow(()=>unchangedInputs({digest:'same'},{digest:'same'}));
  assert.throws(()=>unchangedInputs({digest:'before'},{digest:'after'}),/SOURCE_INPUT_CHANGED_DURING_RUN/);
});

test('a modified matrix cannot read an owner document before checking the path',async()=>{
  const {validateMatrix}=await import('./coverage-baseline-core.mjs');
  const matrix={schemaVersion:1,contracts:[{id:'bad-path',domain:'acl',requirement:'guard',productionModules:[],tests:[{file:'../../owner.txt',block:'private',evidenceLevel:'DI'}],acceptance:[],gapTasks:[]}],dispositions:[]};
  await assert.rejects(validateMatrix(path.resolve('.'),matrix),/MATRIX_PATH_OUTSIDE_ROOT/);
});

function snapshot(ranges) {return {functionName:'POST',isBlockCoverage:true,ranges:ranges.map(([startOffset,endOffset,count])=>({startOffset,endOffset,count}))};}

test('different V8 split shapes remove a false unexecuted range before source mapping',async()=>{
  const {mergeV8FunctionCoverage}=await import('./coverage-baseline-core.mjs');
  const snapshots=[snapshot([[4716,5995,1],[5487,5994,0]]),snapshot([[4716,5995,1],[5487,5607,18],[5607,5994,11]])];
  const original=JSON.stringify(snapshots),merged=mergeV8FunctionCoverage(snapshots);
  assert.deepEqual(merged.effectiveRanges,[{startOffset:4716,endOffset:5995,count:1}]);
  assert.equal(JSON.stringify(snapshots),original);
});

test('a sparse positive snapshot inherits outer execution for a formerly zero child',async()=>{
  const {mergeV8FunctionCoverage}=await import('./coverage-baseline-core.mjs');
  const merged=mergeV8FunctionCoverage([snapshot([[0,100,1],[20,80,0]]),snapshot([[0,100,1]])]);
  assert.deepEqual(merged.effectiveRanges,[{startOffset:0,endOffset:100,count:1}]);
  const f=fixture(),raw=f.script.functions[1];
  const sourceMerged=mergeV8FunctionCoverage([raw,{...raw,ranges:[raw.ranges[0]]}]);
  const observed=authoredObservations({functions:[sourceMerged]},f.cache,f.text,f.file);
  assert.equal(observed.functions.length,1);assert.ok(observed.functions[0].ranges.every(range=>range.executed));
});

test('nested zero overrides a positive parent and nested positive overrides a zero parent',async()=>{
  const {mergeV8FunctionCoverage}=await import('./coverage-baseline-core.mjs');
  const merged=mergeV8FunctionCoverage([snapshot([[0,100,1],[20,80,0],[30,40,5]])]);
  assert.deepEqual(merged.effectiveRanges,[[0,20,1],[20,30,0],[30,40,1],[40,80,0],[80,100,1]].map(([startOffset,endOffset,count])=>({startOffset,endOffset,count})));
});

test('whole-function zero stays unexecuted and incompatible function offsets cannot be merged',async()=>{
  const {mergeV8FunctionCoverage}=await import('./coverage-baseline-core.mjs');
  const merged=mergeV8FunctionCoverage([snapshot([[0,100,0]])]);
  assert.equal(merged.ranges[0].count,0);
  assert.deepEqual(merged.effectiveRanges,[{startOffset:0,endOffset:100,count:0}]);
  assert.throws(()=>mergeV8FunctionCoverage([snapshot([[0,100,1]]),snapshot([[1,100,1]])]),/V8_VARIANT_FUNCTION_START_MISMATCH/);
});
