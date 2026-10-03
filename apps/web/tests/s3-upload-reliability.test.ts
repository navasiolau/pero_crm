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
