// Frozen library и signed PRE сохраняются для действующего task115 writer.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md: STOP при mismatch.
import {readFileSync,existsSync,lstatSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {acceptanceWeb} from './crm-acceptance-transport.mjs';
import {need,canonical,FIXTURE_NAMESPACE} from './file-fixture113-protocol.mjs';
import {FROZEN_SOURCES,derivedFrozenLibrary,bytesHash} from './file-fixture113-context-smoke.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),results=path.resolve(acceptanceWeb,'test-results');
const SHA=/^[a-f0-9]{64}$/;
export function frozenLibraryPlugin(readFrozen=name=>readFileSync(path.join(here,name))){
 return {name:'task113-explicit-frozen-library-adapter',setup(builder){
  builder.onResolve({filter:/^task113:frozen-library$/},()=>({path:path.join(here,'file-fixture113-entry.mjs'),namespace:'task113-frozen-library'}));
  builder.onLoad({filter:/.*/,namespace:'task113-frozen-library'},async args=>({contents:derivedFrozenLibrary(readFrozen('file-fixture113-entry.mjs')),loader:'js',resolveDir:here}));
 }};
}
function privateResultsPath(file){
 need(path.isAbsolute(file??''),'ABSOLUTE_PRIVATE_RESULTS_PATH_REQUIRED');
 const absolute=path.resolve(file),relative=path.relative(results,absolute);
 need(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'PRIVATE_RESULTS_SCOPE_REQUIRED');
 need(existsSync(results)&&!lstatSync(results).isSymbolicLink()&&realpathSync(results).toLowerCase()===results.toLowerCase(),'PRIVATE_RESULTS_ROOT_REQUIRED');
 let current=absolute;while(current.toLowerCase()!==results.toLowerCase()){if(existsSync(current))need(!lstatSync(current).isSymbolicLink(),'REPARSE_CONTEXT_PATH_FORBIDDEN');current=path.dirname(current);}
 return absolute;
}
export function loadSignedParentPre(options){
 need(SHA.test(options?.preFileSha256??''),'HASHED_DURABLE_PARENT_PRE_REQUIRED');
 const bytes=readFileSync(privateResultsPath(options.preFile));need(bytesHash(bytes)===options.preFileSha256,'DURABLE_PARENT_PRE_BYTES_CHANGED');
 let stored;try{stored=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}catch{throw Error('DURABLE_PARENT_PRE_JSON_REQUIRED');}
 const pre=stored.pre;
 need(stored.kind==='private-pre-receipt'&&pre?.namespace===FIXTURE_NAMESPACE&&pre.kind==='pre'&&pre.version===2&&pre.runId===options.runId&&pre.revision===options.revision&&SHA.test(pre.signature??''),'FRESH_SIGNED_PARENT13_PRE_REQUIRED');
 need(canonical(stored.sources)===canonical(FROZEN_SOURCES)&&canonical(pre.sources)===canonical(FROZEN_SOURCES),'FROZEN_PARENT13_PRE_SOURCES_REQUIRED');
 return pre;
}
