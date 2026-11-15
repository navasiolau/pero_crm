import {PrismaClient,Prisma} from '@prisma/client';
import {z} from 'zod';
import {journalBackfillTarget} from '../src/server/changelog/backfill-target';
import {backfillJournalBatch} from '../src/server/changelog/backfill';

const inputSchema=z.object({mode:z.enum(['check','apply']),batchSize:z.number().int().min(1).max(500).default(100),maxBatches:z.number().int().min(1).max(1000).default(100),afterId:z.string().max(200).nullable().default(null)}).strict();

async function main(){
 const target=journalBackfillTarget(process.env);
 const input=inputSchema.parse(JSON.parse(process.env.PERO_JOURNAL_BACKFILL_INPUT??'{"mode":"check"}'));
 const db=new PrismaClient();
 let afterId=input.afterId,scanned=0,updated=0,rawVerified=0,remaining:number|null=null;
 try{
  for(let batch=0;batch<input.maxBatches;batch++){
   const result=await db.$transaction(async tx=>{
    if(input.mode==='check')await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return backfillJournalBatch(tx,{target,mode:input.mode,batchSize:input.batchSize,afterId});
   },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10_000,timeout:60_000});
   scanned+=result.scanned;updated+=result.updated;rawVerified+=result.rawVerified;remaining=result.remaining;afterId=result.nextAfterId;
   console.log(JSON.stringify({status:'PASS',target:target.kind,revision:target.revision,mode:input.mode,batch:batch+1,...result}));
   if(result.scanned<input.batchSize||input.mode==='apply'&&result.remaining===0)break;
  }
  console.log(JSON.stringify({status:'PASS',target:target.kind,mode:input.mode,scanned,updated,rawVerified,remaining,nextAfterId:afterId,complete:remaining===0}));
 }finally{await db.$disconnect();}
}

main().catch(error=>{
 const message=error instanceof Error?error.message:'';
 console.error(JSON.stringify({status:'STOP',code:/^[A-Z0-9_]{1,120}$/.test(message)?message:'JOURNAL_BACKFILL_FAILED'}));process.exitCode=1;
});
