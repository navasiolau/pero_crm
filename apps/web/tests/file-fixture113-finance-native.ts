// Source-only native prerequisite for113/115/116 financial fixtures.
// Root executes only after review; all writes belong to fresh UUIDs and are rolled back.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP on guard mismatch.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {PrismaClient,type Prisma} from '@prisma/client';
type Tx=Prisma.TransactionClient;
const marker='PERO113_DISABLED_NOT_A_PASSWORD_HASH';
let phase='guard';
function guard(){
 const url=new URL(process.env.DATABASE_URL??'');
 assert.equal(process.env.CRM_MODERNIZATION_TARGET,'local');assert.equal(process.platform,'win32');
 assert.equal(url.protocol,'postgresql:');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.port,'5433');assert.equal(url.pathname,'/pero_crm');assert.equal(url.hash,'');
 const allowed=new Set(['schema','connection_limit','pool_timeout','connect_timeout','socket_timeout','sslmode']);assert.ok([...url.searchParams.keys()].every(key=>allowed.has(key)&&url.searchParams.getAll(key).length===1));assert.ok(!url.searchParams.has('schema')||url.searchParams.get('schema')==='public');
}
async function snapshots(tx:Tx){
 const names=await tx.$queryRawUnsafe<{name:string}[]>("SELECT tablename::text name FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
 const result:Record<string,{count:string;hash:string}>={};
 for(const{name}of names){assert.match(name,/^[A-Za-z_][A-Za-z0-9_]{0,62}$/);const[fp]=await tx.$queryRawUnsafe<{count:string;hash:string}[]>('SELECT count(*)::text count,encode(sha256(convert_to(COALESCE(string_agg(h,\'\' ORDER BY h),\'\'),\'UTF8\')),\'hex\') hash FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,\'UTF8\')),\'hex\') h FROM "'+name+'" t) q');result[name]=fp;}
 return result;
}
async function rejectedFk(tx:Tx,operation:()=>Promise<unknown>){
 await tx.$executeRawUnsafe('SAVEPOINT fixture113_fk');
 let rejected=false;
 try{await operation();}catch(error){const value=error as {code?:string;meta?:{code?:string}};assert.ok(value.code==='P2003'||value.meta?.code==='23503'||value.code==='23503');rejected=true;}
 finally{await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT fixture113_fk');await tx.$executeRawUnsafe('RELEASE SAVEPOINT fixture113_fk');}
 assert.equal(rejected,true,'REFERENCED_OWN_FIXTURE_MUST_BE_RESTRICTED');
}
export async function financeFixtureRollback(db:PrismaClient){
 const abort=Error('EXPECTED_FIXTURE113_FINANCE_ROLLBACK'),checks:string[]=[];
 phase='baseline-readonly';
 const before=await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return snapshots(tx);},{isolationLevel:'RepeatableRead',timeout:120000});
 await assert.rejects(db.$transaction(async tx=>{
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");phase='advisory-lock';await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(18435,55113)');
  phase='database-identity';const[identity]=await tx.$queryRawUnsafe<{name:string;schema:string}[]>('SELECT current_database()::text name,current_schema()::text schema');assert.equal(identity.name,'pero_crm');assert.equal(identity.schema,'public');
  const ids={admin:randomUUID(),client:randomUUID(),project:randomUUID(),cash:randomUUID(),article:randomUUID(),income:randomUUID(),expense:randomUUID(),pdf:randomUUID(),image:randomUUID(),cad:randomUUID()},run=randomUUID();
  phase='owned-graph';
  await tx.user.create({data:{id:ids.admin,name:'QA113 finance '+run,email:run+'@invalid.test',passwordHash:marker,roles:['ADMIN'],active:true,payScheme:'NONE'}});
  await tx.client.create({data:{id:ids.client,name:'QA113 finance '+run,phone:'100'}});
  const nextProject=await tx.project.aggregate({_max:{numberInt:true}}),numberInt=(nextProject._max.numberInt??0)+1;
  await tx.project.create({data:{id:ids.project,number:String(numberInt),numberInt,title:'QA113 finance '+run,clientId:ids.client,managerId:ids.admin,stage:'CONTRACT',currency:'BYN'}});
  await tx.cashAccount.create({data:{id:ids.cash,name:'QA113 cash '+run,currency:'BYN',active:true}});
  const maxArticle=await tx.expenseArticle.aggregate({_max:{code:true}});
  await tx.expenseArticle.create({data:{id:ids.article,code:(maxArticle._max.code??0)+1,name:'QA113 article '+run,active:true}});
  const contents={pdf:{name:'QA113.pdf',mime:'application/pdf'},image:{name:'QA113.png',mime:'image/png'},cad:{name:'QA113.b3d',mime:'application/octet-stream'}};
  const hash=createHash('sha256').update('QA113_NATIVE_METADATA_ONLY_NO_STORAGE').digest('hex');
  for(const key of ['pdf','image','cad'] as const)await tx.financeDocument.create({data:{id:ids[key],clientMutationId:randomUUID(),requestFingerprint:hash,uploadedById:ids.admin,fileName:contents[key].name,mimeType:contents[key].mime,size:1,contentHash:hash,storageKey:'finance-documents/'+ids[key]+'/'+hash,storageMode:'s3',state:'READY',readyAt:new Date()}});
  await tx.payment.create({data:{id:ids.income,projectId:ids.project,cashAccountId:ids.cash,direction:'INCOME',currency:'BYN',amount:2,rate:1,bynAmount:2,projectAmount:2,reportDocumentId:ids.image,createdById:ids.admin,comment:'QA113 '+run}});
  await tx.payment.create({data:{id:ids.expense,projectId:ids.project,cashAccountId:ids.cash,expenseArticleId:ids.article,direction:'EXPENSE',currency:'BYN',amount:1,rate:1,bynAmount:1,projectAmount:1,reportDocumentId:ids.pdf,createdById:ids.admin,comment:'QA113 '+run}});
  checks.push('fresh_disabled_ADMIN_owned_project_cash_article_IN2_OUT1_rate1_only_metadata_docs');
  phase='fk-restrict';
  await rejectedFk(tx,()=>tx.financeDocument.delete({where:{id:ids.image}}));
  await rejectedFk(tx,()=>tx.user.delete({where:{id:ids.admin}}));
  checks.push('actual_reportDoc_and_uploadedBy_FK_RESTRICT_refuse_early_delete');
  phase='own-link-cas';
  const moneyBefore=await tx.payment.findMany({where:{id:{in:[ids.income,ids.expense]}},orderBy:{id:'asc'}});
  assert.equal((await tx.payment.updateMany({where:{id:ids.income,projectId:ids.project,cashAccountId:ids.cash,reportDocumentId:ids.image},data:{reportDocumentId:ids.cad}})).count,1);
  assert.equal((await tx.payment.updateMany({where:{id:ids.expense,projectId:ids.project,cashAccountId:ids.cash,reportDocumentId:ids.pdf},data:{reportDocumentId:ids.image}})).count,1);
  const switched=await tx.payment.findMany({where:{id:{in:[ids.income,ids.expense]}},orderBy:{id:'asc'}});
  for(let i=0;i<moneyBefore.length;i++){const previous={...moneyBefore[i]},current={...switched[i]};delete (previous as Partial<typeof previous>).reportDocumentId;delete (current as Partial<typeof current>).reportDocumentId;assert.deepEqual(current,previous);}
  checks.push('actual_unique_doc_FK_safe_switch_PDF_image_CAD_on_two_own_operations_money_bytes_unchanged');
  phase='cleanup-guards';
  assert.equal(await tx.stockPurchase.count({where:{paymentId:{in:[ids.income,ids.expense]}}}),0);
  assert.equal(await tx.payment.count({where:{id:{in:[ids.income,ids.expense]},deletionId:{not:null}}}),0);
  assert.equal(await tx.payout.count({where:{cashAccountId:ids.cash}}),0);
  assert.equal((await tx.payment.updateMany({where:{id:ids.income,reportDocumentId:ids.cad,projectId:ids.project},data:{reportDocumentId:null}})).count,1);
  assert.equal((await tx.payment.updateMany({where:{id:ids.expense,reportDocumentId:ids.image,projectId:ids.project},data:{reportDocumentId:null}})).count,1);
  phase='exact-owned-cleanup';
  assert.equal((await tx.payment.deleteMany({where:{id:{in:[ids.income,ids.expense]},projectId:ids.project,cashAccountId:ids.cash}})).count,2);
  assert.equal((await tx.financeDocument.deleteMany({where:{id:{in:[ids.pdf,ids.image,ids.cad]},uploadedById:ids.admin,payment:{is:null}}})).count,3);
  assert.equal((await tx.cashAccount.deleteMany({where:{id:ids.cash}})).count,1);
  assert.equal((await tx.expenseArticle.deleteMany({where:{id:ids.article}})).count,1);
  assert.equal((await tx.project.deleteMany({where:{id:ids.project,clientId:ids.client}})).count,1);
  assert.equal((await tx.client.deleteMany({where:{id:ids.client}})).count,1);
  assert.equal((await tx.userPreference.deleteMany({where:{userId:ids.admin}})).count,0);
  assert.equal((await tx.user.deleteMany({where:{id:ids.admin,passwordHash:marker}})).count,1);
  assert.deepEqual(await snapshots(tx),before);
  checks.push('actual_exact_owned_FK_cleanup_order_restores_all_original_public_table_fingerprints');
  throw abort;
 },{isolationLevel:'Serializable',maxWait:10000,timeout:120000}),error=>error===abort);
 phase='rollback-proof';const after=await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return snapshots(tx);},{isolationLevel:'RepeatableRead',timeout:120000});assert.deepEqual(after,before);
 return {kind:'file-fixture113-finance-native',status:'PASS',checks,rollbackVerified:true,capturedTables:Object.keys(before).length,storageAccessed:false,metadataOnly:true,originalFinancialFactsPreserved:true,noFXOrExternalCalls:true};
}
export function safeNativeDiagnostic(error:unknown){
 const chain:Record<string,unknown>[]=[];let current=error;
 for(let depth=0;depth<4&&current&&typeof current==='object';depth++){const item=current as Record<string,unknown>;chain.push(item);current=item.actual??item.cause;}
 const knownNames=new Set(['AssertionError','Error','TypeError','PrismaClientKnownRequestError','PrismaClientUnknownRequestError','PrismaClientInitializationError','PrismaClientValidationError']);
 const names=chain.map(item=>typeof item.name==='string'&&knownNames.has(item.name)?item.name:null).filter(Boolean);
 const codes=chain.flatMap(item=>[item.code,(item.meta as {code?:unknown}|undefined)?.code]).filter(value=>typeof value==='string'&&/^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(value as string));
 const assertionCode=chain.some(item=>item.code==='ERR_ASSERTION')?'ERR_ASSERTION':undefined;
 return {exceptionTypes:[...new Set(names)],codes:[...new Set(codes)],...(assertionCode?{assertionCode}:{})};
}
async function main(){let db:PrismaClient|undefined;try{guard();phase='client-setup';db=new PrismaClient({log:[],errorFormat:'minimal'});console.log(JSON.stringify(await financeFixtureRollback(db)));}catch(error){console.log(JSON.stringify({kind:'file-fixture113-finance-native',status:'STOP',phase,...safeNativeDiagnostic(error)}));process.exitCode=1;}finally{await db?.$disconnect();}}
if(process.argv[1]?.endsWith('file-fixture113-finance-native.ts'))void main();
