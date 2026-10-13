import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
test('native entrypoints cold import has zero client construction, Docker, network or implicit execution',()=>{
 const code=[
 "const {createRequire}=await import('node:module');const req=createRequire(import.meta.url);",
 "const Module=req('node:module');const original=Module._load;let clients=0,docker=0,network=0;",
 "Module._load=function(name,...args){if(name==='@prisma/client')return{PrismaClient:class{constructor(){clients++;throw Error('CLIENT_FORBIDDEN')}}};if(name==='node:child_process')return{execFileSync(){docker++;throw Error('DOCKER_FORBIDDEN')}};return original.call(this,name,...args);};",
 "globalThis.fetch=async()=>{network++;throw Error('NETWORK_FORBIDDEN')};",
 "const a=await import('./tests/product-percentage-adjustments-native.ts'),b=await import('./tests/warehouse-concurrency-native.ts');",
 "if(typeof a.runPercentageAdjustmentsAcceptance!=='function'||typeof b.runWarehouseConcurrencyAcceptance!=='function')throw Error('ENTRY_EXPORT_MISSING');",
 "console.log(JSON.stringify({clients,docker,network}));"
 ].join('\n');
 const environment={...process.env};
 for(const key of ['DATABASE_URL','AUTH_SECRET','NEXTAUTH_SECRET','CRM_LOCAL_CONTAINER_ID','CRM_MODERNIZATION_TARGET','CRM_MODERNIZATION_STAGE_PROOF','CRM_STAGING_BROWSER_INPUT','NODE_V8_COVERAGE'])delete environment[key];
 const child=spawnSync(process.execPath,['--import',pathToFileURL(require.resolve('tsx')).href,'--input-type=module','-'],{input:code,encoding:'utf8',windowsHide:true,env:environment,timeout:15000});
 assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),{clients:0,docker:0,network:0});
});

test('bundled native imports do not execute either CLI footer in a local qa-hash style entry',async()=>{
 const {mkdtemp,mkdir,writeFile,realpath,rm,lstat}=await import('node:fs/promises'),path=await import('node:path');
 const fixtureParent=path.join(process.cwd(),'test-results');await mkdir(fixtureParent,{recursive:true});
 assert.ok(!(await lstat(fixtureParent)).isSymbolicLink());
 const directory=await mkdtemp(path.join(fixtureParent,'pero-native-cold-bundle-'));
 try {
  const {build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
  const source="import {runPercentageAdjustmentsAcceptance as a} from './tests/product-percentage-adjustments-native.ts';import {runWarehouseConcurrencyAcceptance as b} from './tests/warehouse-concurrency-native.ts';console.log(JSON.stringify({a:typeof a,b:typeof b}));";
  const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'cold-producer.mjs'},bundle:true,write:false,packages:'external',platform:'node',format:'esm',target:'node22',tsconfig:path.join(process.cwd(),'tsconfig.json'),logLevel:'silent'});
  const file=path.join(directory,'qa-cold-import.mjs');await writeFile(file,bundle.outputFiles[0].contents);
  const environment={...process.env};
  for(const key of ['DATABASE_URL','AUTH_SECRET','NEXTAUTH_SECRET','CRM_LOCAL_CONTAINER_ID','CRM_MODERNIZATION_TARGET','CRM_MODERNIZATION_STAGE_PROOF','CRM_STAGING_BROWSER_INPUT','NODE_V8_COVERAGE'])delete environment[key];
  const child=spawnSync(process.execPath,[file],{encoding:'utf8',windowsHide:true,env:environment,timeout:15000});
  assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),{a:'function',b:'function'});
 }finally {
  const actual=await realpath(directory),parent=await realpath(fixtureParent);
  assert.equal(actual,path.resolve(directory));assert.ok(actual.startsWith(parent+path.sep)&&path.basename(actual).startsWith('pero-native-cold-bundle-'));
  await rm(actual,{recursive:true,force:false});
 }
});
