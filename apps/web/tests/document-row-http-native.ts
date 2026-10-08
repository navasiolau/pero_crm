import assert from 'node:assert/strict';import path from 'node:path';import {readFile,realpath,unlink} from 'node:fs/promises';import {PrismaClient} from '@prisma/client';import {encode} from '@auth/core/jwt';import {runDocumentRowHttp} from './document-row-http-scenarios';
process.loadEnvFile('.env');const target=new URL(process.env.DATABASE_URL!);assert.ok(['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='5433'&&target.pathname==='/pero_crm','LOCAL_TARGET_GUARD');assert.equal(process.env.CRM_FILE_STORAGE,'local');
const db=new PrismaClient();void runDocumentRowHttp(db,async(url,id,options={})=>{
 const user=await db.user.findUniqueOrThrow({where:{id},select:{sessionVersion:true}}),salt='authjs.session-token';
 const token=await encode({secret:process.env.AUTH_SECRET!,salt,maxAge:180,token:{id,sub:id,sessionVersion:user.sessionVersion}});
 return fetch('http://localhost:3097'+url,{...options,redirect:'manual',headers:{...options.headers,cookie:salt+'='+token},signal:AbortSignal.timeout(20000)});
},async(document,bytes)=>{
 assert.equal(document.storageMode,'local');assert.match(document.storageKey,/^finance-documents\/[0-9a-f-]{36}\/[0-9a-f]{64}$/);
 const root=await realpath(path.resolve('uploads')),file=await realpath(path.join(root,...document.storageKey.split('/'))),relative=path.relative(root,file);
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'OWN_OBJECT_GUARD');assert.deepEqual(await readFile(file),bytes);await unlink(file);
}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>db.$disconnect());
