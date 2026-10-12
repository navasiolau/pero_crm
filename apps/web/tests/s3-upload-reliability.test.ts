import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s3Enabled} from '../src/lib/s3';
import {uploadFailure} from '../src/server/files/upload-result';

const keys=['CRM_FILE_STORAGE','S3_ENDPOINT','S3_BUCKET','S3_ACCESS_KEY','S3_SECRET_KEY'];
function env(values:Record<string,string>,fn:()=>void){const old=keys.map(key=>process.env[key]);try{for(const key of keys)delete process.env[key];Object.assign(process.env,values);fn();}finally{keys.forEach((key,index)=>{if(old[index]===undefined)delete process.env[key];else process.env[key]=old[index];});}}
test('storage is explicitly declared; incomplete S3 never falls back to filesystem',()=>{
 env({},()=>assert.throws(()=>s3Enabled(),/STORAGE_CONFIG_INVALID/));
 env({CRM_FILE_STORAGE:'s3',S3_ENDPOINT:'http://minio:9000'},()=>assert.throws(()=>s3Enabled(),/STORAGE_CONFIG_INVALID/));
 env({CRM_FILE_STORAGE:'local'},()=>assert.equal(s3Enabled(),false));
 env({CRM_FILE_STORAGE:'local',S3_BUCKET:'unexpected'},()=>assert.throws(()=>s3Enabled(),/STORAGE_CONFIG_INVALID/));
});
test('explicit local accepts blank S3 placeholders but refuses an actual target',()=>{
 env({CRM_FILE_STORAGE:'local',S3_ENDPOINT:'',S3_BUCKET:' ',S3_ACCESS_KEY:'',S3_SECRET_KEY:''},()=>assert.equal(s3Enabled(),false));
 env({CRM_FILE_STORAGE:'local',S3_ENDPOINT:'http://minio:9000',S3_BUCKET:'',S3_ACCESS_KEY:'',S3_SECRET_KEY:''},()=>assert.throws(()=>s3Enabled(),/STORAGE_CONFIG_INVALID/));
});
test('known failures have distinct safe details while preserving short public error',()=>{
 const cases=[['AccessDenied','STORAGE_ACCESS_DENIED'],['InvalidAccessKeyId','STORAGE_AUTH_FAILED'],['NoSuchBucket','STORAGE_BUCKET_MISSING'],['TimeoutError','STORAGE_TIMEOUT'],['ENOTFOUND','STORAGE_UNAVAILABLE'],['config','STORAGE_CONFIG_INVALID']];
 const messages=new Set<string>();
 for(const [name,code]of cases){const error=new Error(name==='config'?'STORAGE_CONFIG_INVALID':'PRIVATE_KEY_ENDPOINT');error.name=name;const result=uploadFailure('request','storage-original',error);assert.equal(result.body.code,code);assert.equal(result.body.error,'Не удалось загрузить файл. Повторите тот же запрос.');assert.equal(result.body.details.message.includes('PRIVATE'),false);messages.add(result.body.details.message);}
 assert.equal(messages.size,cases.length);
});
test('S3 validates endpoint credentials without leaking input',()=>{
 const valid={CRM_FILE_STORAGE:'s3',S3_ENDPOINT:'http://minio:9000',S3_BUCKET:'crm-staging',S3_ACCESS_KEY:'private-key',S3_SECRET_KEY:'private-secret'};
 env(valid,()=>assert.equal(s3Enabled(),true));
 for(const endpoint of ['file:///tmp','http://private-key:private-secret@minio','http://minio?secret=private-secret'])env({...valid,S3_ENDPOINT:endpoint},()=>assert.throws(()=>s3Enabled(),error=>error instanceof Error&&error.message==='STORAGE_CONFIG_INVALID'));
});

test("stream Put uses known length/precomputed SHA and one attempt; Buffer callers remain separate",async()=>{
 const [{S3Client,PutObjectCommand},{Readable},{createHash},{s3Put,s3PutStream}]=await Promise.all([import("@aws-sdk/client-s3"),import("node:stream"),import("node:crypto"),import("../src/lib/s3")]);
 const oldEnv=keys.map(key=>process.env[key]),originalSend=S3Client.prototype.send;
 const sourceBytes=Buffer.from("PERO synthetic streamed original"),contentHash=createHash("sha256").update(sourceBytes).digest("hex");
 let opens=0,calls=0;const seen:{stream:boolean;maxAttempts:number}[]=[];
 const mock=async function(this:InstanceType<typeof S3Client>,command:InstanceType<typeof PutObjectCommand>){
  assert.ok(command instanceof PutObjectCommand);calls++;const input=command.input;
  seen.push({stream:!Buffer.isBuffer(input.Body),maxAttempts:await this.config.maxAttempts()});
  if(Buffer.isBuffer(input.Body)){assert.equal(input.Body,sourceBytes);return {};}
  assert.equal(input.ContentLength,sourceBytes.length);assert.equal(input.ChecksumSHA256,Buffer.from(contentHash,"hex").toString("base64"));assert.equal(input.ContentType,"application/pdf");
  const chunks:Buffer[]=[];for await(const chunk of input.Body as NodeJS.ReadableStream)chunks.push(Buffer.from(chunk));assert.deepEqual(Buffer.concat(chunks),sourceBytes);
  return {};
 };
 try{
  Object.assign(process.env,{CRM_FILE_STORAGE:"s3",S3_ENDPOINT:"http://unit.invalid:9000",S3_BUCKET:"crm-unit",S3_ACCESS_KEY:"synthetic-key",S3_SECRET_KEY:"synthetic-secret"});
  S3Client.prototype.send=mock as unknown as typeof originalSend;
  await s3Put("unit/buffer",sourceBytes,"application/pdf");
  await s3PutStream("unit/stream",{size:sourceBytes.length,contentHash,openRead:async()=>{opens++;return Readable.from([sourceBytes]);}},"application/pdf");
  assert.equal(calls,2);assert.equal(opens,1);assert.equal(seen[0].stream,false);assert.deepEqual(seen[1],{stream:true,maxAttempts:1});
  calls=opens=0;
  S3Client.prototype.send=(async()=>{calls++;throw Error("SYNTHETIC_UNKNOWN_ACK");}) as unknown as typeof originalSend;
  await assert.rejects(s3PutStream("unit/uncertain",{size:sourceBytes.length,contentHash,openRead:async()=>{opens++;return Readable.from([sourceBytes]);}}),/SYNTHETIC_UNKNOWN_ACK/);
  assert.equal(calls,1);assert.equal(opens,1);
 }finally{
  S3Client.prototype.send=originalSend;
  keys.forEach((key,index)=>{if(oldEnv[index]===undefined)delete process.env[key];else process.env[key]=oldEnv[index];});
 }
});

test("only one-attempt explicit service rejection proves no-write; network or prior attempt stays unknown",async()=>{
 const {knownStorageRejection}=await import("../src/server/files/upload-storage");
 for(const name of ["AccessDenied","InvalidAccessKeyId","SignatureDoesNotMatch","NoSuchBucket"]){
  assert.equal(knownStorageRejection({name,$metadata:{httpStatusCode:403,attempts:1}}),true);
  for(const metadata of [{httpStatusCode:403,attempts:2},{httpStatusCode:200,attempts:1},{httpStatusCode:503,attempts:1},{httpStatusCode:403}])assert.equal(knownStorageRejection({name,$metadata:metadata}),false);
  assert.equal(knownStorageRejection({name}),false);
 }
 assert.equal(knownStorageRejection({name:"TimeoutError",$metadata:{httpStatusCode:503,attempts:1}}),false);
});
