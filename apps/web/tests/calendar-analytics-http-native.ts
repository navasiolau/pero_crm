import assert from 'node:assert/strict';import {PrismaClient} from '@prisma/client';import {encode} from '@auth/core/jwt';import {runCalendarAnalyticsHttp} from './calendar-analytics-http-scenarios';
process.loadEnvFile('.env');const target=new URL(process.env.DATABASE_URL!);assert.ok(['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='5433'&&target.pathname==='/pero_crm','LOCAL_TARGET_GUARD');
const db=new PrismaClient();void runCalendarAnalyticsHttp(db,async(path,id)=>{
 const user=await db.user.findUniqueOrThrow({where:{id},select:{sessionVersion:true}});
 const salt='authjs.session-token',token=await encode({secret:process.env.AUTH_SECRET!,salt,maxAge:120,token:{id,sub:id,sessionVersion:user.sessionVersion}});
 return fetch('http://localhost:3098'+path,{redirect:'manual',headers:{cookie:salt+'='+token},signal:AbortSignal.timeout(20000)});
}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>db.$disconnect());
