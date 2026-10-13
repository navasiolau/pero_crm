// Git blobs подтверждают accepted closure; physical hashes охраняют каждую фазу.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFile,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {evidenceHash,declarationHash} from './helpers/qa-private-primitives.mjs';
const REQUIRED=['pnpm-lock.yaml','package.json','pnpm-workspace.yaml','apps/web/package.json','apps/web/tsconfig.json','apps/web/prisma/schema.prisma','apps/web/next.config.ts','apps/web/Dockerfile'];
const REV=/^[a-f0-9]{40}$/,SHA=/^[a-f0-9]{64}$/;
const git=(root,args)=>execFileSync('git',['--no-optional-locks','-c','safe.directory='+root,'-C',root,...args],{encoding:'utf8',windowsHide:true}).trim();
async function checkedFile(root,relative) {
 assert.ok(typeof relative==='string'&&!path.isAbsolute(relative)&&!relative.split(/[\\/]/).includes('..'),'SOURCE_RELATIVE_PATH_REQUIRED');
 const absolute=path.resolve(root,relative);assert.ok(absolute.startsWith(path.resolve(root)+path.sep),'SOURCE_OUTSIDE_ROOT');
 for(let check=absolute;check!==path.resolve(root);check=path.dirname(check))assert.ok(!(await lstat(check)).isSymbolicLink(),'SOURCE_REPARSE_POINT');
 assert.equal(await realpath(absolute),absolute,'SOURCE_PHYSICAL_PATH_CHANGED');return absolute;
}
export function productionPath(relative) {
 return relative.startsWith('apps/web/src/')||relative.startsWith('packages/')&&!relative.includes('/node_modules/')||relative.startsWith('apps/web/prisma/')||REQUIRED.includes(relative);
}
export async function pinSources({revision,sourceRoot,productionFiles=[],producerFiles=[]}) {
 assert.match(revision,REV,'ACCEPTED_REVISION_REQUIRED');
 const root=await realpath(sourceRoot);
 assert.equal(git(root,['rev-parse','--show-toplevel']).split(path.sep).join('/').toLowerCase(),root.split(path.sep).join('/').toLowerCase(),'PRODUCTION_ROOT_REQUIRED');
 git(root,['cat-file','-e',revision+'^{commit}']);
 const pins=[];
 for(const relative of [...new Set([...REQUIRED,...productionFiles])].sort()) {
  assert.ok(productionPath(relative),'PRODUCTION_PATH_NOT_ALLOWED');const file=await checkedFile(root,relative);
  const filter=git(root,['check-attr','filter','--',relative]);assert.ok(filter.endsWith(': unspecified')||filter.endsWith(': unset'),'SOURCE_FILTER_REVIEW_REQUIRED');
  const expectedBlob=git(root,['rev-parse',revision+':'+relative]),actualBlob=git(root,['hash-object','--path='+relative,file]);
  assert.equal(actualBlob,expectedBlob,'PRODUCTION_SOURCE_NOT_ACCEPTED');
  pins.push({scope:'production',root,relative,file,blob:expectedBlob,sha256:evidenceHash(await readFile(file))});
 }
 for(const approved of producerFiles) {
  const file=await realpath(approved.file);assert.equal(file,path.resolve(approved.file),'PRODUCER_REPARSE_POINT');
  const sha256=evidenceHash(await readFile(file));assert.equal(sha256,approved.sha256,'PRODUCER_SOURCE_NOT_REVIEWED');pins.push({scope:'producer',file,sha256});
 }
 pins.sort((a,b)=>a.file.localeCompare(b.file));
 return {version:1,revision,pins,digest:declarationHash({version:1,revision,pins})};
}
export async function assertSourcePins(manifest) {
 assert.match(manifest.revision,REV,'MANIFEST_REVISION_REQUIRED');
 assert.equal(manifest.digest,declarationHash({version:1,revision:manifest.revision,pins:manifest.pins}),'SOURCE_MANIFEST_CHANGED');
 for(const pin of manifest.pins) {
  if(pin.scope==='virtual') {
   assert.match(pin.sha256,SHA,'VIRTUAL_SHA_REQUIRED');
   assert.ok(manifest.pins.some(row=>row.scope==='producer'&&row.file===pin.transformer.file&&row.sha256===pin.transformer.sha256),'VIRTUAL_TRANSFORMER_PIN_MISSING');
   for(const original of pin.originals)assert.ok(manifest.pins.some(row=>row.scope==='production'&&row.relative===original.relative&&row.blob===original.blob),'VIRTUAL_ORIGINAL_PIN_MISSING');
   continue;
  }
  assert.ok(['production','producer'].includes(pin.scope),'UNKNOWN_SOURCE_SCOPE');
  assert.equal(await realpath(pin.file),pin.file,'SOURCE_PATH_CHANGED');
  assert.equal(evidenceHash(await readFile(pin.file)),pin.sha256,'SOURCE_CHANGED');
  if(pin.scope==='production') {
   assert.equal(git(pin.root,['hash-object','--path='+pin.relative,pin.file]),pin.blob,'PRODUCTION_SOURCE_CHANGED');
   assert.equal(git(pin.root,['rev-parse',manifest.revision+':'+pin.relative]),pin.blob,'ACCEPTED_TREE_CHANGED');
  }
 }
 return manifest.digest;
}
export async function reviewedBundle({entry,revision,sourceRoot,producerRoots,reviewedProducers,plugins=[],virtualAdapters=[]}) {
 const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
 const expectedRoot=await realpath(sourceRoot);
 const tracked=git(expectedRoot,['ls-files','-z','--','apps/web/src','packages','apps/web/prisma']).split('\0').filter(file=>file&&productionPath(file));
 const before=await pinSources({revision,sourceRoot:expectedRoot,productionFiles:tracked,producerFiles:reviewedProducers});
 const beforeByFile=new Map(before.pins.map(pin=>[pin.file,pin])),approved=new Map(reviewedProducers.map(item=>[path.resolve(item.file),item]));
 const adapters=new Map();
 for(const adapter of virtualAdapters) {
  assert.match(adapter.namespace,/^qa-[a-z0-9.-]+$/,'VIRTUAL_NAMESPACE_REQUIRED');
  assert.match(adapter.path,/^[a-z0-9][a-z0-9/.-]{0,120}$/,'VIRTUAL_PATH_REQUIRED');
  assert.ok(!adapter.path.split('/').includes('..')&&['js','ts','tsx'].includes(adapter.loader),'VIRTUAL_LOADER_PATH_INVALID');
  assert.equal(evidenceHash(Buffer.from(adapter.contents)),adapter.sha256,'VIRTUAL_TRANSFORMED_BYTES_CHANGED');
  assert.equal(approved.get(path.resolve(adapter.transformer.file))?.sha256,adapter.transformer.sha256,'VIRTUAL_TRANSFORMER_NOT_REVIEWED');
  assert.ok(Array.isArray(adapter.originals)&&adapter.originals.length>0&&adapter.originals.every(productionPath),'VIRTUAL_PRODUCTION_ORIGINALS_REQUIRED');
  assert.ok(typeof adapter.boundary?.kind==='string'&&/^[a-z0-9.-]+$/.test(adapter.boundary.kind)&&Array.isArray(adapter.boundary.effects)&&adapter.boundary.effects.length>0&&adapter.boundary.effects.every(effect=>/^[a-z0-9.-]+$/.test(effect)),'VIRTUAL_EFFECT_BOUNDARY_REQUIRED');
  const key=adapter.namespace+':'+adapter.path;assert.ok(!adapters.has(key),'DUPLICATE_VIRTUAL_INPUT');adapters.set(key,adapter);
 }
 const absoluteEntry=path.resolve(entry),working=path.dirname(absoluteEntry);
 function classify(absolute) {
  const owner=[...producerRoots].sort((a,b)=>path.resolve(b).length-path.resolve(a).length).find(root=>absolute.startsWith(path.resolve(root)+path.sep));assert.ok(owner,'UNDECLARED_BUNDLE_SOURCE_ROOT');
  return {owner,relative:path.relative(owner,absolute).split(path.sep).join('/')};
 }
 // FIRST onLoad owns virtual bytes and rejects physical WIP production BEFORE compilation.
 const sourceGuard={name:'reviewed-source-closure',setup(builder){builder.onLoad({filter:/.*/},async args=>{
  if(args.namespace!=='file') {
   const adapter=adapters.get(args.namespace+':'+args.path);assert.ok(adapter,'VIRTUAL_SOURCE_MANIFEST_REQUIRED');
   return {contents:adapter.contents,loader:adapter.loader,resolveDir:expectedRoot};
  }
  const absolute=path.resolve(args.path);if(absolute.split(path.sep).includes('node_modules'))return;
  const {relative}=classify(absolute);
  if(!productionPath(relative)) {
   assert.ok(approved.has(absolute),'UNREVIEWED_PRODUCER_IMPORT');
   assert.equal(evidenceHash(await readFile(absolute)),approved.get(absolute).sha256,'PRODUCER_CHANGED_BEFORE_LOAD');return;
  }
  const file=await realpath(absolute),expected=await checkedFile(expectedRoot,relative);
  assert.equal(file,expected,'PRODUCTION_IMPORT_OUTSIDE_ACCEPTED_ROOT');
  const contents=await readFile(file);assert.equal(evidenceHash(contents),beforeByFile.get(file)?.sha256,'PRODUCTION_CHANGED_BEFORE_LOAD');
  const loader={'.ts':'ts','.tsx':'tsx','.js':'js','.mjs':'js','.cjs':'js','.json':'json'}[path.extname(file)];
  assert.ok(loader,'PRODUCTION_LOADER_REVIEW_REQUIRED');return{contents,loader,resolveDir:path.dirname(file)};
 });}};
 const result=await build({entryPoints:[absoluteEntry],absWorkingDir:working,bundle:true,write:false,metafile:true,platform:'node',format:'esm',target:'node22',external:['@prisma/client'],minify:true,tsconfig:path.join(expectedRoot,'apps/web/tsconfig.json'),plugins:[sourceGuard,...plugins],logLevel:'silent'});
 await assertSourcePins(before);
 const actualProduction=new Set(),actualProducers=new Set(),actualAdapters=[];
 for(const input of Object.keys(result.metafile.inputs)) {
  if(input.includes(':')&&!path.isAbsolute(input)) {
   const adapter=adapters.get(input);assert.ok(adapter,'UNDECLARED_VIRTUAL_METAFILE_INPUT');actualAdapters.push(adapter);
   adapter.originals.forEach(relative=>actualProduction.add(relative));actualProducers.add(path.resolve(adapter.transformer.file));continue;
  }
  const absolute=path.resolve(working,input);if(absolute.split(path.sep).includes('node_modules'))continue;
  const {relative}=classify(absolute);
  if(productionPath(relative)) {
   assert.equal(await realpath(absolute),await checkedFile(expectedRoot,relative),'PRODUCTION_IMPORT_OUTSIDE_ACCEPTED_ROOT');actualProduction.add(relative);
  } else actualProducers.add(absolute);
 }
 for(const file of actualProducers)assert.ok(approved.has(file),'UNREVIEWED_PRODUCER_IMPORT');
 const manifest=await pinSources({revision,sourceRoot:expectedRoot,productionFiles:[...actualProduction],producerFiles:[...actualProducers].map(file=>approved.get(file))});
 for(const adapter of actualAdapters)manifest.pins.push({scope:'virtual',inputId:adapter.namespace+':'+adapter.path,loader:adapter.loader,sha256:adapter.sha256,
  originals:adapter.originals.map(relative=>({relative,blob:git(expectedRoot,['rev-parse',revision+':'+relative])})),transformer:adapter.transformer,boundary:adapter.boundary});
 manifest.digest=declarationHash({version:1,revision,pins:manifest.pins});await assertSourcePins(manifest);await assertSourcePins(before);
 const bytes=Buffer.from(result.outputFiles[0].contents);assert.ok(bytes.length<=256*1024,'REVIEWED_BUNDLE_TOO_LARGE');
 return {bytes,bundleSha256:evidenceHash(bytes),manifest,metafile:result.metafile};
}
