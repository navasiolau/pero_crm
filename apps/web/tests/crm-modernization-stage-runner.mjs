// Координатор приёмки: секретные сессии остаются в памяти, записи QA ограничены prefs.
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCrmBynBrowser} from './crm-byn-browser.mjs';
import {runCrmBrowserZoom} from './crm-browser-zoom.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const web=path.resolve(here,'..');
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const [target,revision,operation]=process.argv.slice(2);
if(!['local','staging'].includes(target)||!['native','browser','zoom'].includes(operation)||!/^[a-f0-9]{40}$/.test(revision??''))throw new Error('EXPLICIT_ACCEPTANCE_SCOPE_REQUIRED');
const outputDir=path.join(root,'.playwright-mcp','modernization',`${target}-${operation}-${randomUUID()}`);
await mkdir(outputDir,{recursive:true});
const hash=data=>createHash('sha256').update(data).digest('hex');

async function child(command,args,{input,env=process.env,cwd=web}={}){
 const proc=spawn(command,args,{windowsHide:true,cwd,env,stdio:['pipe','pipe','pipe']});
 const buffers=[],errors=[];let bytes=0,errorBytes=0;
 proc.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes<1024*1024)buffers.push(chunk);});
 proc.stderr.on('data',chunk=>{errorBytes+=chunk.length;if(errorBytes<1024*1024)errors.push(chunk);});
 proc.stdin.on('error',()=>{});
 const done=new Promise((resolve,reject)=>{proc.on('error',()=>reject(new Error('ACCEPTANCE_PROCESS_START_FAILED')));proc.on('close',code=>resolve(code));});
 proc.stdin.end(input);
 const code=await done;
 if(bytes>=1024*1024)throw new Error('ACCEPTANCE_OUTPUT_LIMIT');
 return {code,stdout:Buffer.concat(buffers).toString('utf8'),privateStderr:Buffer.concat(errors)};
}
async function bundle(entry){
 const result=await build({entryPoints:[path.join(here,entry)],bundle:true,write:false,platform:'node',format:'esm',target:'node22',external:['@prisma/client'],minify:true,logLevel:'silent',tsconfig:path.join(web,'tsconfig.json')});
 return Buffer.from(result.outputFiles[0].contents);
}
let remoteWrapper;
async function reviewedWrapper(){
 if(remoteWrapper)return remoteWrapper;
 const file=path.join(root,'deploy/acceptance/crm-modernization-staging.py');
 const checksum=hash(await readFile(file));
 const remote=`/root/pero-crm-modernization-${checksum}.py`;
 const copied=await child('scp',['-q','-o','BatchMode=yes',file,`crm-staging:${remote}`]);
 if(copied.code!==0)throw new Error('STAGING_WRAPPER_COPY_FAILED');
 const checked=await child('ssh',['-T','-o','BatchMode=yes','crm-staging','sha256sum',remote]);
 if(checked.code!==0||checked.stdout.split(/\s/)[0]!==checksum)throw new Error('STAGING_WRAPPER_CHECKSUM_MISMATCH');
 remoteWrapper=remote;return remote;
}
async function execute(code,op,input){
 let execution;
 if(target==='staging'){
  const wrapper=await reviewedWrapper();
  const packet={revision,operation:op,bundle:code.toString('base64'),bundleSha256:hash(code),...(input?{input}:{})};
  execution=await child('ssh',['-T','-o','BatchMode=yes','crm-staging','python3',wrapper],{input:JSON.stringify(packet)});
 }else{
  const url=new URL(process.env.DATABASE_URL??'');
  if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5433'||url.pathname!=='/pero_crm')throw new Error('LOCAL_TARGET_MISMATCH');
  const file=path.join(web,'test-results',`crm-modernization-${hash(code)}.mjs`);
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,code);
  const env={...process.env,CRM_MODERNIZATION_TARGET:'local',CRM_BYN_NATIVE_TARGET:'local',
   ...(input?{CRM_STAGING_BROWSER_INPUT:Buffer.from(JSON.stringify(input)).toString('base64')}:{})};
  execution=await child(process.execPath,[file],{env});
 }
 let decoded;try{decoded=JSON.parse(execution.stdout);}catch{
  await writeFile(path.join(outputDir,'transport.stderr.private.log'),execution.privateStderr,{mode:0o600});
  await writeFile(path.join(outputDir,'transport.stdout.private.log'),execution.stdout,{mode:0o600});
  await writeFile(path.join(outputDir,'transport-diagnostic.json'),JSON.stringify({exitCode:execution.code,stdoutBytes:Buffer.byteLength(execution.stdout),stderrBytes:execution.privateStderr.length}));
  throw new Error('ACCEPTANCE_JSON_REQUIRED');
 }
 const body=target==='staging'?decoded.result:decoded;
 if(execution.code!==0){
  const code=decoded.code??body?.code??'ACCEPTANCE_FAILED';
  throw new Error(/^[A-Z_0-9]+$/.test(code)?code:'ACCEPTANCE_FAILED');
 }
 if(target==='staging'&&(decoded.identity?.hostname!=='crm-staging'||decoded.identity?.revision!==revision))throw new Error('STAGING_IDENTITY_PROOF_REQUIRED');
 return {body,receipt:decoded};
}
async function credentials(){
 const text=await readFile('D:/Projects/pero_crm_v2/HANDOVER-NEXT-AGENT.md','utf8');
 const line=text.split(/\r?\n/).find(line=>line.startsWith('- Basic auth staging:'));
 const fields=[...(line??'').matchAll(/`([^`]*)`/g)].map(match=>match[1]);
 if(fields.length!==3||!fields[0]||!fields[1])throw new Error('STAGING_BASIC_CREDENTIAL_SOURCE_INVALID');
 return {username:fields[0],password:fields[1]};
}
async function main(){
 if(operation==='native'){
  const prepared=await child(process.execPath,[path.join(here,'crm-byn-native-runner.mjs'),path.join(web,'test-results','crm-byn-native.bundle.mjs')]);
  if(prepared.code!==0)throw new Error('NATIVE_BUNDLE_BUILD_FAILED');
  const code=await readFile(path.join(web,'test-results','crm-byn-native.bundle.mjs'));
  const result=await execute(code,'native');
  await writeFile(path.join(outputDir,'native-receipt.json'),JSON.stringify({revision,bundleSha256:hash(code),...result.receipt},null,2));
  console.log(JSON.stringify({status:'PASS',target,operation,revision,checks:result.body.checks.length,rollbackVerified:result.body.rollbackVerified,outputDir}));return;
 }
 const sessionCode=await bundle('crm-modernization-session.mjs');
 const prepared=await execute(sessionCode,'prepare',{operation:'prepare'});
 const session=prepared.body;
 if(session.status!=='PREPARED'||!session.checkpoint||!session.profiles?.admin)throw new Error('MODERNIZATION_SESSION_REQUIRED');
 await writeFile(path.join(outputDir,'checkpoint.json'),JSON.stringify(session.checkpoint),{mode:0o600});
 const origin=target==='staging'?'https://staging-crm.peromebel.by':'http://127.0.0.1:3016';
 const profiles=Object.fromEntries(Object.entries(session.profiles).map(([name,profile])=>[name,{
  id:profile.id,roles:profile.roles,projectPath:name==='engineer'?session.paths.engineerProject:session.paths.project,
  cookies:profile.cookies.filter(cookie=>origin.startsWith('https:')||!cookie.name.startsWith('__Secure-')).map(cookie=>({...cookie,url:origin,secure:origin.startsWith('https:'),httpOnly:true,sameSite:'Lax'})),
 }]));
 let browser,ownWrites=[],restored;
 try{
  browser=operation==='zoom'
   ?await runCrmBrowserZoom({origin,profile:profiles.admin,...(target==='staging'?{basicAuth:await credentials()}:{}),outputDir})
   :await runCrmBynBrowser({origin,profiles,...(target==='staging'?{basicAuth:await credentials()}:{}),outputDir,
    onOwnWrites:async writes=>{ownWrites=writes;await writeFile(path.join(outputDir,'own-writes.json'),JSON.stringify(writes),{mode:0o600});}});
 }finally{
  try{ownWrites=JSON.parse(await readFile(path.join(outputDir,'crm-byn-own-writes.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  restored=await execute(sessionCode,'restore',{operation:'restore',checkpoint:session.checkpoint,ownWrites});
  await writeFile(path.join(outputDir,'restore-receipt.json'),JSON.stringify(restored.receipt,null,2));
 }
 const receipt={revision,target,operation,status:browser?.status??'FAIL',browser,restore:restored.body,
  identity:target==='staging'?prepared.receipt.identity:null,passwordLogin:'NOT_TESTED'};
 await writeFile(path.join(outputDir,'browser-receipt.json'),JSON.stringify(receipt,null,2));
 console.log(JSON.stringify({status:receipt.status,target,operation,revision,checks:browser?.checks?.length??0,failures:browser?.failures??[],
  blocked:browser?.mutationsBlocked?.length??0,restore:restored.body.status,outputDir}));
 if(receipt.status!=='PASS')process.exitCode=1;
}
main().catch(error=>{
 const code=typeof error?.message==='string'&&/^[A-Z_0-9]+$/.test(error.message)?error.message:'MODERNIZATION_ACCEPTANCE_STOP';
 console.error(JSON.stringify({status:'STOP',code,target,operation,outputDir}));process.exitCode=1;
});
