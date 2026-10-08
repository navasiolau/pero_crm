// Root coordinator112. build is dry; runtime requires explicit --authorized.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {qaTransport,bundleHash} from './crm-acceptance-transport.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
export async function sketchQaBundle(){const result=await build({entryPoints:[path.join(here,'engineer-sketch-qa-entry.mjs')],bundle:true,write:false,platform:'node',format:'esm',target:'node22',external:['@prisma/client','@aws-sdk/client-s3','@auth/core/jwt','sharp'],minify:true,logLevel:'silent'});const bytes=Buffer.from(result.outputFiles[0].contents);if(bytes.length>256*1024)throw Error('REVIEWED_BUNDLE_SIZE_LIMIT');return bytes;}
export async function runSketchQa({operation,revision,runId,outputDir,authorized=false}){
 if(!authorized||!['prepare','runtime','capture','cleanup'].includes(operation)||!/^[a-f0-9]{40}$/.test(revision??'')||!/^[a-f0-9-]{36}$/.test(runId??'')||!path.isAbsolute(outputDir))throw Error('AUTHORIZED_EXPLICIT_SCOPE_REQUIRED');
 await mkdir(outputDir,{recursive:true});
 // Exclusive intent prevents silent duplicate mutation after a lost response.
 await writeFile(path.join(outputDir,`intent-${operation}.json`),JSON.stringify({operation,revision,runId}),{flag:'wx',mode:0o600});
 const wire=operation==='prepare'?'prepare':operation==='cleanup'?'restore':'inspect';
 const input={operation:wire,revision,runId,authorized:true};
 if(operation!=='prepare')input.checkpoint=JSON.parse(await readFile(path.join(outputDir,'checkpoint.json'),'utf8'));
 if(operation==='runtime'||operation==='capture')input.mode=operation;
 if(operation==='cleanup')input.observation=JSON.parse(await readFile(path.join(outputDir,'observation.json'),'utf8'));
 const bytes=await sketchQaBundle(),transport=qaTransport({target:'staging',revision,outputDir});
 const result=await transport.execute(bytes,wire,input);
 await writeFile(path.join(outputDir,`receipt-${operation}.json`),JSON.stringify(result.receipt,null,2),{flag:'wx',mode:0o600});
 if(operation==='prepare')await writeFile(path.join(outputDir,'checkpoint.json'),JSON.stringify(result.body.checkpoint),{flag:'wx',mode:0o600});
 if(operation==='runtime'||operation==='capture')await writeFile(path.join(outputDir,'observation.json'),JSON.stringify(result.body.observation),{flag:'wx',mode:0o600});
 return {status:result.body.status,operation,revision,runId,checks:result.body.checks?.length??0,counts:result.body.counts,outputDir};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const[operation,...args]=process.argv.slice(2);
 if(operation==='build'){if(!args[0])throw Error('EXPLICIT_BUNDLE_OUTPUT_REQUIRED');const bytes=await sketchQaBundle(),out=path.resolve(args[0]);await mkdir(path.dirname(out),{recursive:true});await writeFile(out,bytes,{mode:0o600});console.log(JSON.stringify({kind:'engineer-sketch-112-bundle',out,size:bytes.length,sha256:bundleHash(bytes),dbExecuted:false,httpExecuted:false,storageExecuted:false}));}
 else{const[revision,runId,out,permission]=args;if(permission!=='--authorized')throw Error('EXPLICIT_ROOT_REVIEW_REQUIRED');try{console.log(JSON.stringify(await runSketchQa({operation,revision,runId,outputDir:path.resolve(out),authorized:true})));}catch(error){console.log(JSON.stringify({status:'STOP',code:/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'TASK112_STOP_PRESERVE_STATE',operation,outputDir:path.resolve(out)}));process.exitCode=1;}}
}
