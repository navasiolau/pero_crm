// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при guard mismatch.
// Импорт инертен. Только один Root ONE на существующей local5433; никаких внешних эффектов.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {Prisma, PrismaClient} from "@prisma/client";
import {nativeAcceptanceBinding, nativeDatabaseIdentity, type NativeDeclaration} from "./helpers/native-acceptance-target";
import {nativeSnapshot, lockExactOwnedRows, assertNoForeignReferences, type OwnedRowKeys} from "./helpers/native-acceptance-snapshot";
import {nativeJournal} from "./helpers/native-acceptance-journal";
import {guardedModuleCache} from "./helpers/guarded-module-cache";

export type SharedTransactionNativeApproval = NativeDeclaration & {target:"local"; scenarioId:"shared-transaction150";
  source:"root-reviewed"; sourceHash:string; baselineDigest:string; exclusiveLocalWindow:true; localOutboxInactive:true};
const ids = {
  manager:"8a403f01-8ff6-417f-852b-4b11224ca8ed", accountant:"c9349cfb-32c6-4bbf-8db4-855368eeae79", worker:"0126b609-719c-4207-a55f-52614caee736",
  cash:"5d507363-32b0-4584-82df-725b13d57454", article:"ec504bb6-b7b0-4fcc-9199-8ed6e09bd4f1", document:"af2d4d2a-8937-46b3-8c2b-4ba6ced11304",
  cashFunding:"f212a3af-cd16-43f7-823d-c5466465f9bc", orgFunding:"f57736d6-9368-4e29-9863-ea114a5a00d3", probe:"abd12e86-47fe-495b-965b-7a4e4bb95535",
  expenseIntent:"a5f37885-3909-45ec-841d-b3b4cd431c72", advanceIntent:"b3055a84-7bda-4bee-9844-4e2c95bb2bd8",
};
export const sharedTransactionNativeRunId="afb6e5bb-d309-4658-9bac-0314f4d4cce2";
const sourceFiles=["src/server/transactions/coordinator.ts","src/server/tasks/transaction.ts","src/server/operations/confirmation.ts","src/server/payments/core.ts"];
export function sharedTransactionNativeSourceHash() {
  const digest=createHash("sha256");for(const file of sourceFiles){digest.update("apps/web/"+file+"\0");digest.update(readFileSync(file));}return digest.digest("hex");
}

export async function executeSharedTransactionNative(approval:SharedTransactionNativeApproval) {
  assert.equal(approval.source,"root-reviewed","ROOT_ONE_REQUIRED");assert.equal(approval.target,"local");assert.equal(approval.scenarioId,"shared-transaction150");
  assert.equal(approval.runId,sharedTransactionNativeRunId,"ONE_RUN_REQUIRED");assert.equal(approval.exclusiveLocalWindow,true);assert.equal(approval.localOutboxInactive,true);
  assert.notEqual(process.env.CRM_EVENT_DISPATCHER_ENABLED,"true","GLOBAL_WORKER_HOLD");
  assert.equal(execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8",windowsHide:true}).trim(),approval.revision,"SOURCE_REVISION_HOLD");
  assert.equal(sharedTransactionNativeSourceHash(),approval.sourceHash,"SOURCE_HOLD");
  const binding=nativeAcceptanceBinding(approval),write=await nativeJournal(approval);
  const owned:OwnedRowKeys={User:{column:"id",ids:[ids.manager,ids.accountant,ids.worker]},CashAccount:{column:"id",ids:[ids.cash]},
    ExpenseArticle:{column:"id",ids:[ids.article]},FinanceDocument:{column:"id",ids:[ids.document]},
    Payment:{column:"id",ids:[ids.cashFunding,ids.orgFunding,ids.probe]},
    ChangeLog:{column:"id",ids:["payment-request:"+ids.expenseIntent,"payout-issue:"+ids.advanceIntent]}};
  await write("intent",{approval,identity:binding.identity,owned,ids,fixture:"own actors/cash1000/article/READY document; optional org-only funding; actual expense500 vs advance600; probe abort"});
  const url=new URL(binding.url);url.searchParams.set("connection_limit","1");
  const clients:PrismaClient[]=[];let scope:ReturnType<typeof guardedModuleCache>|undefined,receipt:Record<string,unknown>|undefined,sequence=0;
  let release=()=>{},phase="constructors";const pending:Promise<unknown>[]=[];
  async function observe(table:string,id:string){owned[table]??={column:"id",ids:[]};if(!owned[table].ids.includes(id))owned[table].ids.push(id);await write("owned-"+(++sequence),{table,id});}
  async function currentOwned(tx:Prisma.TransactionClient) {
    const live:OwnedRowKeys={};for(const [table,keys]of Object.entries(owned)){
      assert.match(table,/^[A-Za-z]+$/);const rows=await tx.$queryRawUnsafe<{id:string}[]>('SELECT id FROM public."'+table+'" WHERE id = ANY($1::text[]) ORDER BY id',keys.ids);
      if(rows.length)live[table]={column:"id",ids:rows.map(row=>row.id)};
    }return live;
  }
  function observed(tx:Prisma.TransactionClient):Prisma.TransactionClient {
    return new Proxy(tx,{get(target,key,receiver){
      if(key==="payment")return {...target.payment,create:async(args:Parameters<typeof target.payment.create>[0])=>{
        assert.equal(args.data.cashAccountId,ids.cash,"FOREIGN_CASH_HOLD");assert.ok([ids.accountant,ids.manager].includes(args.data.createdById??""),"FOREIGN_ACTOR_HOLD");
        assert.equal(args.data.projectId??null,null);assert.equal(args.data.logisticsAllocationId??null,null);assert.equal(args.data.currency,"BYN");
        assert.ok(!args.data.reportDocumentId||args.data.reportDocumentId===ids.document);assert.ok(!args.data.expenseArticleId||args.data.expenseArticleId===ids.article);
        const row=await target.payment.create(args);await observe("Payment",row.id);return row;
      }};
      if(key==="payout")return {...target.payout,create:async(args:Parameters<typeof target.payout.create>[0])=>{
        assert.equal(args.data.userId,ids.worker);assert.equal(args.data.createdById,ids.accountant);assert.equal(args.data.cashAccountId,ids.cash);assert.equal(args.data.kind,"ADVANCE");
        const row=await target.payout.create(args);await observe("Payout",row.id);return row;
      }};
      if(key==="changeLog")return {...target.changeLog,create:async(args:Parameters<typeof target.changeLog.create>[0])=>{
        assert.ok([ids.accountant,ids.manager].includes(args.data.actorId??""));assert.ok(["payment","payout"].includes(args.data.entity));
        assert.ok(owned[args.data.entity==="payment"?"Payment":"Payout"]?.ids.includes(args.data.entityId));
        const row=await target.changeLog.create(args);await observe("ChangeLog",row.id);return row;
      }};
      if(key==="domainEvent")return {...target.domainEvent,create:async(args:Parameters<typeof target.domainEvent.create>[0])=>{
        assert.ok([ids.accountant,ids.manager].includes(args.data.actor??""));assert.ok(["expense.created","payroll.payout"].includes(args.data.type));
        const row=await target.domainEvent.create(args);await observe("DomainEvent",row.id);return row;
      }};
      return Reflect.get(target,key,receiver);
    }});
  }
  try {
    clients.push(new PrismaClient({datasourceUrl:url.toString(),log:[],errorFormat:"minimal"}));
    nativeAcceptanceBinding(approval);assert.equal(sharedTransactionNativeSourceHash(),approval.sourceHash,"SOURCE_HOLD");
    clients.push(new PrismaClient({datasourceUrl:url.toString(),log:[],errorFormat:"minimal"}));
    const [first,second]=clients;phase="identity";await nativeDatabaseIdentity(first,approval);await nativeDatabaseIdentity(second,approval);
    const [pidA]=await first.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`,[pidB]=await second.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;
    assert.notEqual(pidA.pid,pidB.pid,"TWO_CONNECTIONS_REQUIRED");
    phase="baseline";const before=await nativeSnapshot(first);assert.equal(before.digest,approval.baselineDigest,"QUALIFIED_BASELINE_HOLD");await write("baseline",before);
    assert.deepEqual(await first.$transaction(currentOwned),{},"PLANNED_ID_COLLISION_HOLD");
    phase="scope";scope=guardedModuleCache(import.meta.url,{targets:["../src/server/transactions/coordinator","../src/server/tasks/transaction","../src/server/payments/transaction","../src/server/payroll/cash-core","../src/server/operations/confirmation"],allowedOverrides:[],overrides:{},prisma:first});
    phase="load-neutral";
    const neutral=scope.load<typeof import("../src/server/transactions/coordinator")>("../src/server/transactions/coordinator");
    phase="load-aliases";const legacy=scope.load<typeof import("../src/server/tasks/transaction")>("../src/server/tasks/transaction");assert.equal(neutral.createMutationTransaction,legacy.createTaskTransaction);assert.equal(neutral.withMutationTransaction,legacy.withTaskTransaction);
    phase="load-cash";
    const {issuePayoutCore,readCashBalance,readOrgBalance}=scope.load<typeof import("../src/server/payroll/cash-core")>("../src/server/payroll/cash-core");
    phase="load-payment";const {createPaymentInTransaction}=scope.load<typeof import("../src/server/payments/transaction")>("../src/server/payments/transaction");
    phase="load-confirmation";
    const {confirmMutation}=scope.load<typeof import("../src/server/operations/confirmation")>("../src/server/operations/confirmation");
    const transactionA=neutral.createMutationTransaction(first),transactionB=neutral.createMutationTransaction(second);
    phase="setup";await transactionA(async tx=>{
      for(const [id,role]of [[ids.manager,"MANAGER"],[ids.accountant,"ACCOUNTANT"],[ids.worker,"WORKER"]]as const)
        await tx.user.create({data:{id,email:id+"@example.invalid",name:"QA150 "+role,passwordHash:"QA-no-login",roles:[role],payScheme:"NONE"}});
      await tx.cashAccount.create({data:{id:ids.cash,name:"QA150 isolated cash",currency:"BYN"}});
      const maximum=await tx.expenseArticle.aggregate({_max:{code:true}});await tx.expenseArticle.create({data:{id:ids.article,code:(maximum._max.code??0)+1,name:"QA150 owned article"}});
      await tx.financeDocument.create({data:{id:ids.document,clientMutationId:ids.document,uploadedById:ids.accountant,state:"READY",readyAt:new Date(),fileName:"qa150.pdf",mimeType:"application/pdf",size:1,contentHash:"0".repeat(64),requestFingerprint:sharedTransactionNativeRunId,storageKey:"qa150/"+ids.document,storageMode:"local"}});
      const orgFunding=Prisma.Decimal.max(1,(await readOrgBalance(tx,"1.000000")).negated());assert.ok(orgFunding.lte("9999999999.99"),"ORG_FUNDING_LIMIT_HOLD");
      await tx.payment.create({data:{id:ids.cashFunding,direction:"INCOME",amount:1000,bynAmount:1000,currency:"BYN",rate:1,cashAccountId:ids.cash,createdById:ids.accountant}});
      await tx.payment.create({data:{id:ids.orgFunding,direction:"INCOME",amount:orgFunding,bynAmount:orgFunding,currency:"BYN",rate:1,createdById:ids.accountant}});
    });
    assert.equal((await nativeSnapshot(first,owned)).digest,before.digest,"PROTECTED_ROWS_HOLD");
    const date=new Date().toISOString().slice(0,10),accountant={id:ids.accountant,name:"QA150 ACCOUNTANT",roles:["ACCOUNTANT"] as const,source:"web" as const};
    const expense={clientMutationId:ids.expenseIntent,direction:"EXPENSE" as const,amount:500,currency:"BYN",cashAccountId:ids.cash,expenseArticleId:ids.article,reportDocumentId:ids.document};
    const prepared={project:null,account:{id:ids.cash,name:"QA150 isolated cash"},articleId:ids.article,paidAt:new Date(),rate:1,rateDate:null,amount:500,bynAmount:500};
    phase="race";let holder!:Prisma.TransactionClient,entered!:()=>void,proceed=false;const holding=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{release=resolve});
    const expenseWrite=transactionA(async tx=>{holder=tx;entered();await gate;assert.equal(proceed,true,"PROTOCOL_ABORT_BEFORE_WRITE");return createPaymentInTransaction({...accountant,roles:["ACCOUNTANT"]},expense,prepared,observed(tx));});pending.push(expenseWrite);void expenseWrite.catch(()=>{});
    await Promise.race([holding,expenseWrite.then(()=>{throw Error("HOLDER_REQUIRED")})]);
    const waitStarted=performance.now();
    const advanceWrite=transactionB(tx=>issuePayoutCore({id:ids.accountant,name:"QA150 ACCOUNTANT",roles:["ACCOUNTANT"],source:"web"},
      {kind:"ADVANCE",userId:ids.worker,cashAccountId:ids.cash,cashAmount:"600.00",expectedCashCurrency:"BYN",description:"QA150 isolated advance",requestId:ids.advanceIntent},
      {asOf:date,cash:{currency:"BYN",rate:"1.000000",date},payroll:{currency:"BYN",rate:"1.000000",date}},observed(tx)));pending.push(advanceWrite);void advanceWrite.catch(()=>{});
    let lockWaitObserved=false,lockWaitMs=0;
    try {const deadline=performance.now()+3000;while(performance.now()<deadline){
      const locks=await holder.$queryRaw<{waiting:boolean}[]>`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pidB.pid} AND locktype='advisory' AND classid=18435 AND objid=55001 AND NOT granted) AS waiting`;
      if(locks[0]?.waiting){lockWaitObserved=true;lockWaitMs=Math.round((performance.now()-waitStarted)*100)/100;break;}await new Promise(resolve=>setTimeout(resolve,10));
    }assert.equal(lockWaitObserved,true,"REAL_ADVISORY_WAIT_REQUIRED");proceed=true;}finally{release();}
    const results=await Promise.allSettled([expenseWrite,advanceWrite]);const advanceError:unknown=results[1].status==="rejected"?results[1].reason:undefined;
    const advanceErrorCategory=advanceError instanceof Error?(advanceError.message==="Недостаточно средств в выбранной кассе"?"CASH_CAP":advanceError.message==="Недостаточно прав"?"ROLE_DENIED":"OTHER_ERROR"):"NO_KNOWN_ERROR";
    await write("race-result",{expenseOutcome:results[0].status,advanceOutcome:results[1].status,advanceErrorCategory,
      advanceErrorName:advanceError instanceof Error&&["Error","AssertionError","TypeError","AggregateError","PrismaClientKnownRequestError","PrismaClientInitializationError","PrismaClientValidationError"].includes(advanceError.name)?advanceError.name:"Unknown",
      ormCode:typeof advanceError==="object"&&advanceError!==null&&"code" in advanceError&&typeof advanceError.code==="string"&&/^P\d{4}$/.test(advanceError.code)?advanceError.code:undefined,
      pids:[pidA.pid,pidB.pid],lockWaitObserved,lockWaitMs});assert.equal(results[0].status,"fulfilled");assert.equal(results[1].status,"rejected");
    assert.ok(results[1].status==="rejected"&&results[1].reason instanceof Error&&results[1].reason.message==="Недостаточно средств в выбранной кассе","CASH_CAP_REJECTION_REQUIRED");
    assert.ok(results[0].status==="fulfilled");const paymentId=results[0].value.payment.id;
    phase="replay";const replay=await transactionB(tx=>createPaymentInTransaction({...accountant,roles:["ACCOUNTANT"]},expense,prepared,observed(tx)));assert.equal(replay.repeated,true);assert.equal(replay.payment.id,paymentId);
    assert.equal(await first.payment.count({where:{cashAccountId:ids.cash,direction:"EXPENSE"}}),1);assert.equal(await first.payout.count({where:{cashAccountId:ids.cash}}),0);
    assert.equal(await first.changeLog.count({where:{actorId:ids.accountant}}),2);assert.equal(await first.domainEvent.count({where:{actor:ids.accountant}}),1);
    assert.equal((await transactionA(tx=>readCashBalance(tx,ids.cash))).toFixed(2),"500.00");
    phase="rollback-fence";let fenceConnection=0;const fence=await confirmMutation(callback=>(fenceConnection++===0?transactionA:transactionB)(callback),async tx=>{
      await observed(tx).payment.create({data:{id:ids.probe,direction:"INCOME",amount:1,bynAmount:1,currency:"BYN",rate:1,cashAccountId:ids.cash,createdById:ids.manager}});throw Error("OWN_CALLBACK_ABORT");
    },async tx=>await tx.payment.findUnique({where:{id:ids.probe}}));
    assert.equal(fence.outcome,"ROLLED_BACK");assert.equal(fenceConnection,2);assert.equal(await first.payment.count({where:{id:ids.probe}}),0);
    phase="cleanup";assert.equal((await nativeSnapshot(first,owned)).digest,before.digest,"PROTECTED_ROWS_HOLD");await write("cleanup-intent",{owned});
    await first.$transaction(async tx=>{
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
      const live=await currentOwned(tx);await lockExactOwnedRows(tx,live);await assertNoForeignReferences(tx,live);assert.equal((await nativeSnapshot(tx,live)).digest,before.digest,"CLEANUP_ORIGINALS_HOLD");
      if(live.DomainEvent)await tx.domainEvent.deleteMany({where:{id:{in:live.DomainEvent.ids}}});if(live.ChangeLog)await tx.changeLog.deleteMany({where:{id:{in:live.ChangeLog.ids}}});
      if(live.Payout)await tx.payout.deleteMany({where:{id:{in:live.Payout.ids}}});await tx.payment.deleteMany({where:{id:{in:live.Payment.ids}}});
      await tx.financeDocument.delete({where:{id:ids.document}});await tx.expenseArticle.delete({where:{id:ids.article}});await tx.cashAccount.delete({where:{id:ids.cash}});await tx.user.deleteMany({where:{id:{in:live.User.ids}}});
      assert.equal((await nativeSnapshot(tx)).digest,before.digest,"CLEANUP_INSIDE_HOLD");
    },{maxWait:5000,timeout:30000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
    const after=await nativeSnapshot(first);assert.equal(after.digest,before.digest,"CLEANUP_AFTER_HOLD");assert.deepEqual(await first.$transaction(currentOwned),{},"OWNED_ROWS_REMAINING_HOLD");
    receipt={status:"NATIVE_PASS",sourceHash:approval.sourceHash,baselineDigest:before.digest,afterDigest:after.digest,pids:[pidA.pid,pidB.pid],lockWaitObserved,lockWaitMs,
      expense:"500.00",advance:"600.00",cashBefore:"1000.00",cashAfter:"500.00",expenseCount:1,payoutCount:0,replaySameId:true,rollbackFence:"ROLLED_BACK",ownedRowsRemaining:0,
      seams:["explicit owned native actors, not HTTP auth","READY document metadata, no blob","raw own funding"],staging:"NOT_RUN"};
  }catch(error){await write("hold",{status:"HOLD",owned,phase,errorName:error instanceof Error&&["Error","AssertionError","TypeError","AggregateError","PrismaClientKnownRequestError","PrismaClientInitializationError","PrismaClientValidationError"].includes(error.name)?error.name:"Unknown",
    ormCode:typeof error==="object"&&error!==null&&"code" in error&&typeof error.code==="string"&&/^P\d{4}$/.test(error.code)?error.code:undefined,
    code:error instanceof Error&&/^[A-Z][A-Z0-9_]{0,95}$/.test(error.message)?error.message:"SHARED_TRANSACTION_NATIVE_HOLD"});throw error;}
  finally{
    release();await Promise.allSettled(pending);
    try{scope?.restore();}catch(error){await write("module-restore-hold",{status:"HOLD"});throw error;}finally{
      const disconnected=await Promise.allSettled(clients.map(client=>client.$disconnect()));if(disconnected.some(row=>row.status==="rejected")){await write("disconnect-hold",{status:"HOLD"});throw Error("DB_DISCONNECT_HOLD");}
    }
  }
  try{assert.equal(sharedTransactionNativeSourceHash(),approval.sourceHash,"SOURCE_CHANGED_DURING_NATIVE_HOLD");}catch(error){await write("source-hold",{status:"HOLD"});throw error;}
  assert.ok(receipt);await write("closed",{...receipt,clientsClosed:true});return {...receipt,clientsClosed:true};
}
