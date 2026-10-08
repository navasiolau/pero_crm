import assert from 'node:assert/strict';import {PrismaClient} from '@prisma/client';import {runCalendarAnalyticsNative} from './calendar-analytics-native-scenarios';
process.loadEnvFile('.env');const target=new URL(process.env.DATABASE_URL!);assert.ok(['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='5433'&&target.pathname==='/pero_crm','LOCAL_TARGET_GUARD');
const db=new PrismaClient();void runCalendarAnalyticsNative(db).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>db.$disconnect());
