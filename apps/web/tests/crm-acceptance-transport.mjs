// Общий закрытый транспорт QA. Секреты prepare остаются в памяти координатора.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),web=path.resolve(here,'..'),root=path.resolve(web,'../..');
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
export const acceptanceRoot=root;
export const acceptanceWeb=web;
export const bundleHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function qaProcess(command,args,{input,env=process.env,cwd=web}={}){
 const proc=spawn(command,args,{windowsHide:true,cwd,env,stdio:['pipe','pipe','pipe']});
 const out=[],err=[];let size=0,errorSize=0;
 proc.stdout.on('data',chunk=>{size+=chunk.length;if(size<1024*1024)out.push(chunk);});
 proc.stderr.on('data',chunk=>{errorSize+=chunk.length;if(errorSize<1024*1024)err.push(chunk);});
 proc.stdin.on('error',()=>{});
 const completion=new Promise((resolve,reject)=>{proc.on('error',()=>reject(new Error('QA_PROCESS_START_FAILED')));proc.on('close',resolve);});
 proc.stdin.end(input);const code=await completion;
 if(size>=1024*1024)throw new Error('QA_OUTPUT_LIMIT');
 return{code,stdout:Buffer.concat(out).toString('utf8'),privateStderr:Buffer.concat(err)};
}
export async function qaBundle(entry){
 const result=await build({entryPoints:[path.resolve(here,entry)],bundle:true,write:false,platform:'node',format:'esm',target:'node22',external:['@prisma/client'],minify:true,tsconfig:path.join(web,'tsconfig.json'),logLevel:'silent'});
 return Buffer.from(result.outputFiles[0].contents);
}
export function qaTransport({target,revision,outputDir}){
 if(!['local','staging'].includes(target)||!/^[a-f0-9]{40}$/.test(revision??''))throw new Error('QA_TARGET_REVISION_REQUIRED');
 let remote;
 async function remoteWrapper(){
  if(remote)return remote;
  const local=path.join(root,'deploy/acceptance/crm-modernization-staging.py'),digest=bundleHash(await readFile(local));
  const destination=`/root/pero-crm-modernization-${digest}.py`;
  const copied=await qaProcess('scp',['-q','-o','BatchMode=yes',local,`crm-staging:${destination}`]);
  if(copied.code!==0)throw new Error('QA_WRAPPER_COPY_FAILED');
  const checked=await qaProcess('ssh',['-T','-o','BatchMode=yes','crm-staging','sha256sum',destination]);
  if(checked.code!==0||checked.stdout.split(/\s/)[0]!==digest)throw new Error('QA_WRAPPER_CHECKSUM_MISMATCH');
  remote=destination;return remote;
 }
 return{async execute(bytes,operation,input){
  if(!['native','prepare','inspect','restore','readonly'].includes(operation))throw new Error('QA_OPERATION_REQUIRED');
  let execution;
  if(target==='staging'){
   const packet={revision,operation,bundle:bytes.toString('base64'),bundleSha256:bundleHash(bytes),...(input?{input}:{})};
   execution=await qaProcess('ssh',['-T','-o','BatchMode=yes','crm-staging','python3',await remoteWrapper()],{input:JSON.stringify(packet)});
  }else{
   const url=new URL(process.env.DATABASE_URL??'');
   if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5433'||url.pathname!=='/pero_crm')throw new Error('QA_LOCAL_BINDING_MISMATCH');
   const file=path.join(web,'test-results',`qa-${bundleHash(bytes)}.mjs`);
   await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);
   execution=await qaProcess(process.execPath,[file],{env:{...process.env,CRM_MODERNIZATION_TARGET:'local',CRM_BYN_NATIVE_TARGET:'local',...(input?{CRM_STAGING_BROWSER_INPUT:Buffer.from(JSON.stringify(input)).toString('base64')}:{})}});
  }
  let decoded;try{decoded=JSON.parse(execution.stdout);}catch{
   await writeFile(path.join(outputDir,`transport-${operation}-decode.stderr.private.log`),execution.privateStderr,{mode:0o600});
   throw new Error('QA_JSON_REQUIRED');
  }
  const body=target==='staging'?decoded.result:decoded;
  if(execution.code!==0){const phase=body?.diagnosticStage??body?.phase??decoded.phase??'unknown';const safePhase=typeof phase==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(phase)?phase:'unknown';await writeFile(path.join(outputDir,`transport-${operation}-${safePhase}.stderr.private.log`),execution.privateStderr,{mode:0o600});const code=decoded.code??body?.code??'QA_EXECUTION_FAILED';throw new Error(/^[A-Z0-9_]+$/.test(code)?code:'QA_EXECUTION_FAILED');}
  if(target==='staging'&&(decoded.identity?.revision!==revision||decoded.identity?.hostname!=='crm-staging'))throw new Error('QA_STAGE_IDENTITY_MISMATCH');
  return{body,receipt:decoded};
 }};
}
export async function qaBasicAuth(){
 const text=await readFile('D:/Projects/pero_crm_v2/HANDOVER-NEXT-AGENT.md','utf8');
 const line=text.split(/\r?\n/).find(line=>line.startsWith('- Basic auth staging:'));
 const fields=[...(line??'').matchAll(/`([^`]*)`/g)].map(match=>match[1]);
 if(fields.length!==3||!fields[0]||!fields[1])throw new Error('QA_BASIC_SOURCE_INVALID');
 return{username:fields[0],password:fields[1]};
}
