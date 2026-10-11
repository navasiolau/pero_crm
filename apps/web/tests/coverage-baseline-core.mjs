// Проверяемая карта и authored V8 observations; это не общий процент TS-покрытия.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {SourceMap} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {mergeV8FunctionCoverage} from './coverage-v8-intervals.mjs';
export {mergeV8FunctionCoverage} from './coverage-v8-intervals.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
const levels = new Set(['unit','DI','SSR','source-guard','Chromium-component','native-PostgreSQL','HTTP-runtime','staging-browser','device']);

function checkedPath(root,file) {
  assert.ok(typeof file==='string' && !path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'),'MATRIX_PATH_OUTSIDE_ROOT');
  assert.ok(file.startsWith('apps/web/src/') || file.startsWith('apps/web/tests/'),'MATRIX_PATH_NOT_SOURCE_OR_TEST');
  return path.join(root,file);
}

export async function validateMatrix(root, matrix) {
  assert.equal(matrix.schemaVersion, 1, 'MATRIX_VERSION_INVALID');
  const domains = new Set(), ids = new Set(), files = new Set();
  for (const row of matrix.contracts) {
    assert.ok(!ids.has(row.id) && row.requirement, 'CONTRACT_ID_REQUIREMENT_INVALID');
    ids.add(row.id); domains.add(row.domain);
    assert.ok(row.tests.length || row.gapTasks.length, 'UNEXPLAINED_TEST_GAP');
    for (const file of row.productionModules) files.add(file);
    for (const test of row.tests) {
      assert.ok(levels.has(test.evidenceLevel), 'EVIDENCE_LEVEL_INVALID');
      files.add(test.file);
      if (test.block) assert.ok((await readFile(checkedPath(root, test.file),'utf8')).includes(test.block), 'TEST_BLOCK_NOT_FOUND: '+row.id);
    }
    for (const proof of row.acceptance) {
      assert.ok(levels.has(proof.evidenceLevel), 'ACCEPTANCE_LEVEL_INVALID');
      assert.ok(['NOT_RUN','BLOCKED'].includes(proof.status), 'STATIC_MAP_CANNOT_ASSERT_RUNTIME_PASS');
      assert.equal(proof.revision,null,'UNEXECUTED_PROOF_REVISION_INVALID');
      for (const file of proof.entrypoints) files.add(file);
    }
  }
  assert.deepEqual([...domains].sort(), ['acl','file','money','queue','timer']);
  for (const item of matrix.dispositions) {
    assert.ok(['KEEP','REWRITE','CONSOLIDATE','RETIRE'].includes(item.decision) && item.block && item.reason && item.remainingProtection.length, 'TEST_DISPOSITION_INVALID');
    files.add(item.file);
  }
  for (const file of files) {
    assert.ok(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'), 'MATRIX_PATH_OUTSIDE_ROOT');
    await readFile(checkedPath(root,file));
  }
  return [...new Set(matrix.contracts.flatMap(row=>row.productionModules))].sort();
}

async function filesBelow(root, relative) {
  const found=[];
  for (const entry of await readdir(path.join(root,relative),{withFileTypes:true})) {
    if (['node_modules','dist','.next','test-results','playwright-report'].includes(entry.name)) continue;
    const file=path.posix.join(relative,entry.name);
    assert.ok(!entry.isSymbolicLink(),'SOURCE_INPUT_SYMLINK: '+file);
    if (entry.isDirectory()) found.push(...await filesBelow(root,file));
    else if (entry.isFile()) found.push(file);
  }
  return found;
}

export async function sourceInputs(root) {
  const files = (await Promise.all(['apps/web/src','apps/web/tests','packages'].map(dir=>filesBelow(root,dir)))).flat();
  files.push('apps/web/package.json','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.github/workflows/ci-cd.yml','docs/testing/contract-matrix.json','docs/testing/README.md','apps/web/tsconfig.json');
  const inputs=[];
  for (const file of [...new Set(files)].sort()) inputs.push({file,sha256:digest(await readFile(path.join(root,file)))});
  return {digest:digest(JSON.stringify(inputs)),inputs};
}

export function unchangedInputs(before,after) {
  assert.equal(after.digest,before.digest,'SOURCE_INPUT_CHANGED_DURING_RUN');
}

function sourceFunctions(text,file) {
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  const functions=[];
  function visit(node) {
    if (ts.isFunctionLike(node) && node.body) {
      functions.push({start:node.getStart(source),end:node.end,name:node.name?.getText(source)??'<anonymous>'});
    }
    ts.forEachChild(node,visit);
  }
  visit(source);
  const lines=source.getLineStarts();
  return {functions,lines};
}
function generatedPosition(offset,lengths) {
  let line=0,previous=0;
  while (line<lengths.length-1 && previous+lengths[line]+1<=offset) {previous+=lengths[line]+1;line++;}
  return {line,column:offset-previous};
}
function sameFile(left,right) {
  const normalize=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
  try {return normalize(fileURLToPath(left))===normalize(right);} catch {return false;}
}
function originalPoint(map,cache,offset,source,file) {
  const generated=generatedPosition(offset,cache.lineLengths);
  const entry=map.findEntry(generated.line,generated.column);
  if (!sameFile(entry.originalSource,file) || !Number.isInteger(entry.originalLine) || !Number.isInteger(entry.originalColumn)) return null;
  const start=source.lines[entry.originalLine];
  if (start===undefined) return null;
  return {line:entry.originalLine+1,column:entry.originalColumn+1,offset:start+entry.originalColumn,generatedExact:entry.generatedLine===generated.line&&entry.generatedColumn===generated.column};
}

export function authoredObservations(script,cache,text,file) {
  if (!cache?.data || !Array.isArray(cache.lineLengths)) return {status:'BLOCKED',reason:'SOURCE_MAP_UNAVAILABLE',functions:[]};
  const original=(cache.data.sources??[]).findIndex(source=>sameFile(source,file));
  if (original<0 || cache.data.sourcesContent?.[original]!==text) return {status:'BLOCKED',reason:'SOURCE_MAP_CONTENT_MISMATCH',functions:[]};
  const map=new SourceMap(cache.data), source=sourceFunctions(text,file), functions=[];
  for (const fn of script.functions??[]) {
    const range=fn.ranges?.[0];
    if (!range) continue;
    const point=originalPoint(map,cache,range.startOffset,source,file);
    if (!point?.generatedExact) continue;
    const authored=source.functions.filter(node=>node.start<=point.offset&&point.offset<node.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
    if (!authored) continue; // Type-only export getters и transpiler helpers не входят.
    const ranges=[];
    for (const item of fn.effectiveRanges??fn.ranges) {
      const start=originalPoint(map,cache,item.startOffset,source,file);
      const end=originalPoint(map,cache,item.endOffset-1,source,file);
      if (!start||!end) continue;
      ranges.push({start:{line:start.line,column:start.column},end:{line:end.line,column:end.column},relativeStart:item.startOffset-range.startOffset,relativeEnd:item.endOffset-range.startOffset,executed:item.count>0});
    }
    functions.push({authoredStart:authored.start,authoredEnd:authored.end,name:authored.name,location:{line:point.line,column:point.column},executed:range.count>0,ranges});
  }
  return {status:functions.length?'MEASURED':'BLOCKED',reason:functions.length?null:'NO_AUTHORED_FUNCTION_MAPPING',functions};
}

export async function collectCoverage(root,targets,rawDirectory) {
  const modules=new Map(),variants=new Map();
  for (const file of targets) modules.set(file,{file,status:'NOT_RUN',reason:'NO_V8_SCRIPT_OBSERVED',functions:new Map(),mappingIssues:new Set()});
  for (const rawFile of (await readdir(rawDirectory)).filter(name=>/^coverage-.*\.json$/.test(name)).sort()) {
    const raw=JSON.parse(await readFile(path.join(rawDirectory,rawFile),'utf8'));
    for (const script of raw.result??[]) {
      const target=targets.find(file=>sameFile(script.url,path.join(root,file)));
      if (!target) continue;
      const cache=raw['source-map-cache']?.[script.url],moduleResult=modules.get(target);
      if (!cache?.data||!Array.isArray(cache.lineLengths)) {moduleResult.mappingIssues.add('SOURCE_MAP_UNAVAILABLE');continue;}
      const variant=digest(JSON.stringify({lineLengths:cache.lineLengths,data:cache.data})),key=target+'\0'+variant;
      let group=variants.get(key);
      if (!group) {group={target,variant,cache,functions:new Map()};variants.set(key,group);}
      for (const fn of script.functions??[]) {
        if (!fn.ranges?.length) continue;
        const span=fn.ranges[0],id=String(span.startOffset)+':'+String(span.endOffset);
        const snapshots=group.functions.get(id)??[];
        snapshots.push(fn);group.functions.set(id,snapshots);
      }
    }
  }
  for (const group of variants.values()) {
    const moduleResult=modules.get(group.target),text=await readFile(path.join(root,group.target),'utf8');
    const functions=[...group.functions.values()].map(mergeV8FunctionCoverage);
    const measured=authoredObservations({functions},group.cache,text,path.join(root,group.target));
    if (measured.status!=='MEASURED') {moduleResult.mappingIssues.add(measured.reason);continue;}
    moduleResult.status='MEASURED';moduleResult.reason=null;
    for (const fn of measured.functions) {
      const key=String(fn.authoredStart)+':'+String(fn.authoredEnd);
      let stored=moduleResult.functions.get(key);
      if (!stored) {stored={...fn,ranges:[]};moduleResult.functions.set(key,stored);}
      stored.executed ||= fn.executed;
      // Только внутри exact generated variant действует interval union. Другой variant явный.
      stored.ranges.push(...fn.ranges.map(range=>({...range,generatedVariant:group.variant})));
    }
  }
  return [...modules.values()].map(moduleResult=>{
    const functions=[...moduleResult.functions.values()].sort((a,b)=>a.authoredStart-b.authoredStart);
    const ranges=functions.flatMap(fn=>fn.ranges);
    return {file:moduleResult.file,status:moduleResult.status==='NOT_RUN'&&moduleResult.mappingIssues.size?'BLOCKED':moduleResult.status,reason:moduleResult.status==='NOT_RUN'&&moduleResult.mappingIssues.size?'SOURCE_MAP_LIMITATION':moduleResult.reason,mappingIssues:[...moduleResult.mappingIssues].sort(),
      authoredFunctionsObserved:functions.length,executedAuthoredFunctions:functions.filter(fn=>fn.executed).length,
      effectiveMappedV8IntervalsObserved:ranges.length,executedEffectiveMappedV8Intervals:ranges.filter(range=>range.executed).length,
      lineCoverage:null,branchCoverage:null,functions};
  });
}
