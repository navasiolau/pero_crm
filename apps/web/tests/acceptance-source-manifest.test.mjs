import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm,lstat} from 'node:fs/promises';
import path from 'node:path';
import {evidenceHash} from './acceptance-evidence-protocol.mjs';
import os from 'node:os';
import {pinSources,assertSourcePins,reviewedBundle} from './acceptance-source-manifest.mjs';
const required=['pnpm-lock.yaml','package.json','pnpm-workspace.yaml','apps/web/package.json','apps/web/tsconfig.json','apps/web/prisma/schema.prisma','apps/web/next.config.ts','apps/web/Dockerfile'];
async function fixture(run) {
 const root=await mkdtemp(path.join(os.tmpdir(),'pero-acceptance-source-'));
 const git=(args)=>execFileSync('git',['-c','safe.directory='+root,'-C',root,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
 try {
  for(const file of [...required,'apps/web/src/value.ts']) {
   await mkdir(path.dirname(path.join(root,file)),{recursive:true});
   await writeFile(path.join(root,file),file.endsWith('.ts')?'export const value=1;\n':file.endsWith('.json')?'{}\n':'fixture\n');
  }
  git(['init','--quiet']);git(['config','user.name','QA']);git(['config','user.email','qa@example.invalid']);
  git(['add','.']);git(['commit','--quiet','--no-gpg-sign','-m','Fixture']);
  const revision=git(['rev-parse','HEAD']);await run({root,revision,git});
 } finally {
  // Удаляется только собственный mkdtemp после проверки physical path/parent, без workspace cleanup.
  const physical=await realpath(root),parent=await realpath(os.tmpdir());
  assert.equal(physical,path.resolve(root));assert.ok(physical.startsWith(parent+path.sep));
  assert.ok(path.basename(physical).startsWith('pero-acceptance-source-'));assert.ok(!(await lstat(root)).isSymbolicLink());
  await rm(physical,{recursive:true,force:false});
 }
}
test('accepted sources are pinned and a WIP production change fails despite unchanged HEAD',()=>fixture(async({root,revision})=>{
 const manifest=await pinSources({revision,sourceRoot:root,productionFiles:['apps/web/src/value.ts']});
 assert.equal(await assertSourcePins(manifest),manifest.digest);
 await writeFile(path.join(root,'apps/web/src/value.ts'),'export const value=2;\n');
 await assert.rejects(pinSources({revision,sourceRoot:root,productionFiles:['apps/web/src/value.ts']}),/PRODUCTION_SOURCE_NOT_ACCEPTED/);
 await assert.rejects(assertSourcePins(manifest),/SOURCE_CHANGED/);
}));
test('Git-clean CRLF checkout is accepted while later physical drift remains rejected',()=>fixture(async({root,revision,git})=>{
 git(['config','core.autocrlf','true']);
 await writeFile(path.join(root,'apps/web/src/value.ts'),'export const value=1;\r\n');
 const manifest=await pinSources({revision,sourceRoot:root,productionFiles:['apps/web/src/value.ts']});
 assert.equal(await assertSourcePins(manifest),manifest.digest);
 await writeFile(path.join(root,'apps/web/src/value.ts'),'export const value=1;\n');
 await assert.rejects(assertSourcePins(manifest),/SOURCE_CHANGED/);
}));
test('unreviewed producer, traversal and altered manifest cannot establish provenance',()=>fixture(async({root,revision})=>{
 const producer=path.join(root,'producer.mjs');await writeFile(producer,'export const ok=true;\n');
 await assert.rejects(pinSources({revision,sourceRoot:root,producerFiles:[{file:producer,sha256:'a'.repeat(64)}]}),/PRODUCER_SOURCE_NOT_REVIEWED/);
 await assert.rejects(pinSources({revision,sourceRoot:root,productionFiles:['apps/web/src/../../private.txt']}),/SOURCE_RELATIVE_PATH_REQUIRED/);
 const manifest=await pinSources({revision,sourceRoot:root,productionFiles:['apps/web/src/value.ts']});
 manifest.pins[0].sha256='a'.repeat(64);
 await assert.rejects(assertSourcePins(manifest),/SOURCE_MANIFEST_CHANGED/);
 assert.equal((await readFile(path.join(root,'apps/web/src/value.ts'),'utf8')).trim(),'export const value=1;');
}));


async function prepareEntry(root,sourceFile) {
 const entry=path.join(root,'producer.mjs');
 await writeFile(entry,'export {value} from '+JSON.stringify(sourceFile)+';\n');
 return {entry,reviewedProducers:[{file:entry,sha256:evidenceHash(await readFile(entry))}]};
}
test('actual bundle rejects even unchanged production imported from another physical worktree',()=>fixture(async({root,revision})=>{
 const wip=path.join(root,'other-worktree'),source=path.join(wip,'apps/web/src/value.ts');
 await mkdir(path.dirname(source),{recursive:true});await writeFile(source,'export const value=1;\n');
 const approved=await prepareEntry(root,source);
 await assert.rejects(reviewedBundle({...approved,revision,sourceRoot:root,producerRoots:[root,wip]}),/PRODUCTION_IMPORT_OUTSIDE_ACCEPTED_ROOT/);
}));
test('actual production bytes changed during compile are rejected before load, even if restored after build',()=>fixture(async({root,revision})=>{
 const source=path.join(root,'apps/web/src/value.ts'),approved=await prepareEntry(root,source);
 const plugin={name:'fault',setup(builder){
  builder.onStart(async()=>{await writeFile(source,'export const value=999;\n');});
  builder.onEnd(async()=>{await writeFile(source,'export const value=1;\n');});
 }};
 await assert.rejects(reviewedBundle({...approved,revision,sourceRoot:root,producerRoots:[root],plugins:[plugin]}),/PRODUCTION_CHANGED_BEFORE_LOAD/);
 assert.equal((await readFile(source,'utf8')).trim(),'export const value=1;');
}));
test('declared virtual byte owner pins original blob and transformer and cannot be overridden by another onLoad',()=>fixture(async({root,revision})=>{
 const approved=await prepareEntry(root,'qa:projection');
 const transformer=path.join(root,'transformer.mjs');await writeFile(transformer,'export const reviewed=true;\n');
 const sha256=evidenceHash(await readFile(transformer));approved.reviewedProducers.push({file:transformer,sha256});
 const contents='export const value=7;',adapter={namespace:'qa-projection',path:'value',contents,sha256:evidenceHash(Buffer.from(contents)),loader:'js',originals:['apps/web/src/value.ts'],transformer:{file:transformer,sha256},boundary:{kind:'static-projection',effects:['pure-values']}};
 let overrides=0;
 const plugin={name:'projection-resolver',setup(builder){
  builder.onResolve({filter:/^qa:projection$/},()=>({namespace:adapter.namespace,path:adapter.path}));
  builder.onLoad({filter:/.*/,namespace:adapter.namespace},()=>{overrides++;return{contents:'export const value=999;',loader:'js'};});
 }};
 const result=await reviewedBundle({...approved,revision,sourceRoot:root,producerRoots:[root],plugins:[plugin],virtualAdapters:[adapter]});
 const loaded=await import('data:text/javascript;base64,'+result.bytes.toString('base64'));
 assert.equal(loaded.value,7);assert.equal(overrides,0);
 assert.equal(Object.keys(result.metafile.inputs).filter(input=>input.startsWith(adapter.namespace+':')).length,1);
 assert.ok(result.manifest.pins.some(pin=>pin.scope==='virtual'&&pin.sha256===adapter.sha256));
 assert.equal(await assertSourcePins(result.manifest),result.manifest.digest);
 await assert.rejects(reviewedBundle({...approved,revision,sourceRoot:root,producerRoots:[root],plugins:[plugin],virtualAdapters:[{...adapter,sha256:'a'.repeat(64)}]}),/VIRTUAL_TRANSFORMED_BYTES_CHANGED/);
}));
test('unlisted virtual inputs stop before a compiled result can be accepted',()=>fixture(async({root,revision})=>{
 const approved=await prepareEntry(root,'qa:unknown');
 const plugin={name:'unknown',setup(builder){
  builder.onResolve({filter:/^qa:unknown$/},()=>({namespace:'qa-unknown',path:'value'}));
  builder.onLoad({filter:/.*/,namespace:'qa-unknown'},()=>({contents:'export const value=1;',loader:'js'}));
 }};
 await assert.rejects(reviewedBundle({...approved,revision,sourceRoot:root,producerRoots:[root],plugins:[plugin]}),/VIRTUAL_SOURCE_MANIFEST_REQUIRED/);
}));

test('unknown accepted Git revision and unreviewed clean filter fail closed before source/bundle acceptance',()=>fixture(async({root,revision,git})=>{
 await assert.rejects(pinSources({revision:'a'.repeat(40),sourceRoot:root,productionFiles:['apps/web/src/value.ts']}));
 await writeFile(path.join(root,'.gitattributes'),'apps/web/src/value.ts filter=denied\n');
 git(['config','filter.denied.clean','this-command-must-never-run']);
 await assert.rejects(pinSources({revision,sourceRoot:root,productionFiles:['apps/web/src/value.ts']}),/SOURCE_FILTER_REVIEW_REQUIRED/);
}));

test('two exact standalone config inputs are required and both drift guards reject before transport',()=>fixture(async({root,revision})=>{
 for(const file of ['apps/web/next.config.ts','apps/web/Dockerfile']){
  const original=await readFile(path.join(root,file));
  const before=await pinSources({revision,sourceRoot:root});
  assert.ok(before.pins.some(pin=>pin.scope==='production'&&pin.relative===file),'EXACT_CONFIG_PIN_REQUIRED');
  await writeFile(path.join(root,file),'unaccepted packaging change\n');
  await assert.rejects(assertSourcePins(before),/SOURCE_CHANGED/);
  await assert.rejects(pinSources({revision,sourceRoot:root}),/PRODUCTION_SOURCE_NOT_ACCEPTED/);
  await writeFile(path.join(root,file),original);
 }
}));
test('standalone config allowlist does not permit sibling, env or private app paths',()=>fixture(async({root,revision})=>{
 for(const file of ['apps/web/next.extra.ts','apps/web/Dockerfile.debug','apps/web/.env','apps/web/private-config.json'])
  await assert.rejects(pinSources({revision,sourceRoot:root,productionFiles:[file]}),/PRODUCTION_PATH_NOT_ALLOWED/);
}));