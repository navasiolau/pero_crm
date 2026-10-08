import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {encode} from '@auth/core/jwt';import {PrismaClient} from '@prisma/client';
import {runWarehouseDeletionHttp,deletionActionIds} from './warehouse-deletion-http-scenarios';
process.loadEnvFile('.env');const target=new URL(process.env.DATABASE_URL!);assert.ok(['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='5433'&&target.pathname==='/pero_crm');
const db=new PrismaClient(),base='http://localhost:3097',ids=deletionActionIds(JSON.parse(readFileSync('.next/server/server-reference-manifest.json','utf8')));
void runWarehouseDeletionHttp(db,ids,async(path,id,options={})=>{
 const secret=process.env.AUTH_SECRET;assert.ok(secret);const user=await db.user.findUniqueOrThrow({where:{id},select:{sessionVersion:true}});
 const token=await encode({secret,salt:'authjs.session-token',maxAge:180,token:{id,sub:id,sessionVersion:user.sessionVersion}});
 return fetch(base+path,{...options,redirect:'manual',headers:{...options.headers,cookie:'authjs.session-token='+token,origin:base},signal:AbortSignal.timeout(25000)});
},true).then(console.log).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.$disconnect());
