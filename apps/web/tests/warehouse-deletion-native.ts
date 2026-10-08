import assert from 'node:assert/strict';import {PrismaClient} from '@prisma/client';
import {runWarehouseDeletionNative} from './warehouse-deletion-native-scenarios';
import {runWarehouseDeletionConcurrent} from './warehouse-deletion-concurrency-scenarios';
process.loadEnvFile('.env');const target=new URL(process.env.DATABASE_URL!);
assert.ok(['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='5433'&&target.pathname==='/pero_crm');
const db=new PrismaClient();void (async()=>{console.log(await runWarehouseDeletionNative(db));console.log(await runWarehouseDeletionConcurrent(db,true));})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.$disconnect());
