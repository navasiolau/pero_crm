// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при guard mismatch.
// Inert: импорт не создаёт clients, не выполняет SQL и не запускает приёмку.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";
import { nativeAcceptanceBinding, nativeDatabaseIdentity, type NativeDeclaration } from "./helpers/native-acceptance-target";
import { nativeSnapshot, lockExactOwnedRows, assertNoForeignReferences, type OwnedRowKeys } from "./helpers/native-acceptance-snapshot";
import { nativeJournal } from "./helpers/native-acceptance-journal";
import { guardedModuleCache } from "./helpers/guarded-module-cache";
import type { TaskCreateRequest } from "../src/server/tasks/creation-receipts";

export type TaskCreationNativeApproval = NativeDeclaration & { scenarioId: "task-create165"; sourceHash: string; baselineDigest: string;
  exclusiveLocalWindow: true; localOutboxInactive: true; source: "root-reviewed" };
const sourceFiles = ["src/server/tasks/actions.ts", "src/server/tasks/creation-receipts.ts", "src/server/tasks/transaction.ts",
  "src/server/operations/confirmation.ts", "src/server/operations/post-commit.ts", "src/server/access/visibility.ts",
  "src/server/access/live-entities.ts", "src/server/tasks/share-policy.ts", "src/lib/work-shares.ts", "src/lib/roles.ts",
  "tests/task-creation-native.ts", "tests/helpers/native-acceptance-target.ts", "tests/helpers/local-crm-database.ts",
  "tests/helpers/native-acceptance-snapshot.ts", "tests/helpers/native-acceptance-journal.ts", "tests/helpers/guarded-module-cache.ts", "prisma/schema.prisma"];
export function taskCreationNativeSourceHash(): string {
  return createHash("sha256").update(JSON.stringify(sourceFiles.map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")]))).digest("hex");
}
export async function qualifyTaskCreationNative(input: NativeDeclaration) {
  const binding = nativeAcceptanceBinding(input); // Guard ДО конструктора PrismaClient.
  const db = new PrismaClient({ datasourceUrl: binding.url });
  try {
    await nativeDatabaseIdentity(db, input);
    const baseline = await nativeSnapshot(db);
    const ledger = await db.$queryRaw<{ name: string; checksum: string; finished: boolean; rolledBack: boolean }[]>`
      SELECT migration_name AS name,checksum,finished_at IS NOT NULL AS finished,rolled_back_at IS NOT NULL AS "rolledBack"
      FROM _prisma_migrations ORDER BY started_at`;
    assert.ok(ledger.every(row => row.finished || row.rolledBack), "MIGRATION_LEDGER_HOLD");
    return { identity: binding.identity, sourceHash: taskCreationNativeSourceHash(), baselineDigest: baseline.digest,
      tables: Object.keys(baseline.snapshot.rows).length, ledgerCount: ledger.length,
      ledgerDigest: createHash("sha256").update(JSON.stringify(ledger)).digest("hex") };
  } finally { await db.$disconnect(); }
}

export async function executeTaskCreationNative(approval: TaskCreationNativeApproval) {
  assert.equal(approval.source, "root-reviewed", "ROOT_PROTOCOL_GO_REQUIRED");
  assert.equal(approval.exclusiveLocalWindow, true, "EXCLUSIVE_WINDOW_REQUIRED"); assert.equal(approval.localOutboxInactive, true, "OUTBOX_INACTIVE_REQUIRED");
  assert.equal(approval.sourceHash, taskCreationNativeSourceHash(), "SOURCE_HASH_HOLD");
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], {encoding:"utf8",windowsHide:true}).trim(), approval.revision, "SOURCE_REVISION_HOLD");
  assert.notEqual(process.env.CRM_EVENT_DISPATCHER_ENABLED, "true", "GLOBAL_WORKER_HOLD");
  const binding = nativeAcceptanceBinding(approval); // Guard ДО обоих constructors.
  const ids = Object.fromEntries(["manager","worker","client","project","product","work","predecessor"].map(name=>[name,"qa165-"+approval.runId+"-"+name]));
  const commands = Array.from({length:7},()=>randomUUID());
  const owned: OwnedRowKeys = { User:{column:"id",ids:[ids.manager,ids.worker]},Client:{column:"id",ids:[ids.client]},
    Project:{column:"id",ids:[ids.project]},Product:{column:"id",ids:[ids.product]},Work:{column:"id",ids:[ids.work]},
    Task:{column:"id",ids:[ids.predecessor]},ChangeLog:{column:"id",ids:commands.map(id=>"task-create:"+id)} };
  const write = await nativeJournal(approval);
  await write("manifest",{approval,identity:binding.identity,owned,commands});
  const url=new URL(binding.url);url.searchParams.set("connection_limit","1");
  const first = new PrismaClient({datasourceUrl:url.toString()}), second = new PrismaClient({datasourceUrl:url.toString()});
  const clients=[first,second],pids=new Set<number>(),partials: object[]=[],effects: string[]=[];
  let sequence=0,nextConnection=0,fault="",loseAck=false,scope:ReturnType<typeof guardedModuleCache>|undefined;
  let receipt: Record<string,unknown> | undefined;
  function observe(table:string,id:string){owned[table]??={column:"id",ids:[]};if(!owned[table].ids.includes(id))owned[table].ids.push(id);}
  function withDependencies():OwnedRowKeys {return {...owned,TaskDependency:{column:"taskId",ids:[...owned.Task.ids]}};}
  const currentOwned = async (tx: Prisma.TransactionClient): Promise<OwnedRowKeys> => {
    const live:OwnedRowKeys={};
    for(const [table,keys]of Object.entries(owned)){
      assert.match(table,/^[A-Za-z_]+$/);
      const rows=await tx.$queryRawUnsafe<{id:string}[]>('SELECT id FROM public."'+table+'" WHERE id = ANY($1::text[]) ORDER BY id',keys.ids);
      if(rows.length)live[table]={column:"id",ids:rows.map(row=>row.id)};
    }
    return live;
  };
  const request=(index:number,title:string):TaskCreateRequest=>({clientMutationId:commands[index],expectedActorId:ids.manager,
    projectId:ids.project,productId:ids.product,workId:ids.work,assigneeId:ids.worker,title,type:"Производство",quantity:1,
    dueAt:"2026-10-12",estimateMinutes:10,dependencyIds:[ids.predecessor]});
  async function beforeFault(tx:Prisma.TransactionClient,kind:string,taskId:string){
    const proof={kind,task:await tx.task.count({where:{id:taskId}}),audit:await tx.changeLog.count({where:{entityId:taskId,action:"create"}}),event:await tx.domainEvent.count({where:{payload:{path:["taskId"],equals:taskId}}})};
    assert.equal(proof.task,1,"MANDATORY_FAULT_DID_NOT_FOLLOW_TASK");assert.equal(proof.audit,kind==="audit"?0:1);assert.equal(proof.event,kind==="receipt"?1:0);
    partials.push(proof);await write("fault-"+kind,proof);throw new Error("Injected mandatory write fault");
  }
  const facade = { $transaction: async <T>(callback:(tx:Prisma.TransactionClient)=>Promise<T>,options:{maxWait?:number;timeout?:number;isolationLevel?:Prisma.TransactionIsolationLevel}):Promise<T>=>{
    const db=clients[nextConnection++%2];let taskId="";
    const result=await db.$transaction(async tx=>{
      const [row]=await tx.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;pids.add(row.pid);
      const proxied=new Proxy(tx,{get(target,key,receiver){
        if(key==="task")return {...target.task,create:async(args:Parameters<typeof target.task.create>[0])=>{
          assert.equal(args.data.projectId,ids.project,"FOREIGN_TASK_WRITE_HOLD");assert.equal(args.data.createdById,ids.manager,"FOREIGN_ACTOR_HOLD");
          const row=await target.task.create(args);taskId=row.id;observe("Task",row.id);await write("owned-"+(++sequence),{table:"Task",id:row.id});return row;
        }};
        if(key==="changeLog")return {...target.changeLog,create:async(args:Parameters<typeof target.changeLog.create>[0])=>{
          assert.equal(args.data.actorId,ids.manager,"FOREIGN_AUDIT_HOLD");assert.equal(args.data.entityId,taskId,"FOREIGN_ENTITY_HOLD");
          const kind=args.data.action==="task.create.request"?"receipt":"audit";if(fault===kind)await beforeFault(target,kind,taskId);
          const row=await target.changeLog.create(args);observe("ChangeLog",row.id);await write("owned-"+(++sequence),{table:"ChangeLog",id:row.id});return row;
        }};
        if(key==="domainEvent")return {...target.domainEvent,create:async(args:Parameters<typeof target.domainEvent.create>[0])=>{
          assert.equal(args.data.actor,ids.manager,"FOREIGN_EVENT_HOLD");if(fault==="event")await beforeFault(target,"event",taskId);
          const row=await target.domainEvent.create(args);observe("DomainEvent",row.id);await write("owned-"+(++sequence),{table:"DomainEvent",id:row.id});return row;
        }};
        return Reflect.get(target,key,receiver);
      }});
      return callback(proxied);
    },options);
    if(loseAck){loseAck=false;throw new Error("Injected ACK loss AFTER real SQL commit");}return result;
  }};
  try {
    await nativeDatabaseIdentity(first,approval);await nativeDatabaseIdentity(second,approval);
    const baseline=await nativeSnapshot(first);assert.equal(baseline.digest,approval.baselineDigest,"QUALIFIED_BASELINE_HOLD");await write("baseline",{digest:baseline.digest,snapshot:baseline.snapshot});
    assert.deepEqual(await first.$transaction(currentOwned),{},"PLANNED_ID_COLLISION_HOLD");
    await first.$transaction(async tx=>{
      for(const id of [ids.manager,ids.worker])await tx.user.create({data:{id,email:id+"@example.invalid",name:id,passwordHash:"QA-only-no-login",roles:[id===ids.manager?"MANAGER":"WORKER"]}});
      await tx.client.create({data:{id:ids.client,name:ids.client,phone:"qa165"}});
      const number=String(2000000000+parseInt(approval.runId.slice(0,5),16));
      await tx.project.create({data:{id:ids.project,number,numberInt:Number(number),title:ids.project,clientId:ids.client,currency:"BYN",managerId:ids.manager}});
      await tx.product.create({data:{id:ids.product,number:number+".1",suffixInt:1,title:ids.product,projectId:ids.project,status:"PRODUCTION"}});
      await tx.work.create({data:{id:ids.work,title:ids.work,projectId:ids.project,productId:ids.product,quantity:"10",priceSnapshot:"100",total:"1000",paymentKind:"LEGACY"}});
      await tx.task.create({data:{id:ids.predecessor,title:ids.predecessor,projectId:ids.project,productId:ids.product,status:"DONE",createdById:ids.manager}});
    });
    const optional=(name:string)=>async()=>{effects.push(name);};
    const overrides={"../src/auth":{auth:async()=>({user:{id:ids.manager,name:ids.manager,roles:["MANAGER"]}})},
      "next/cache":{revalidatePath:optional("cache")},"../src/server/products/revalidate":{revalidateProductPaths:optional("product-cache")},
      "../src/server/plugins/changelog":{writeChangeLog:()=>{throw Error("OUTSIDE_AUDIT_HOLD")}},
      "../src/server/plugins/events":{emitDomainEvent:()=>{throw Error("OUTSIDE_EVENT_HOLD")},dispatchEvent:optional("dispatch")},
      "../src/server/notifications/notify":{notifyPerson:optional("person"),notifyOrg:()=>{throw Error("UNEXPECTED_ORG_HOLD")}}};
    scope=guardedModuleCache(import.meta.url,{targets:["../src/server/tasks/actions"],allowedOverrides:Object.keys(overrides),overrides,prisma:facade});
    const {createTask}=scope.load<typeof import("../src/server/tasks/actions")>("../src/server/tasks/actions");
    const one=request(0,"same-intent"),ten=await Promise.all(Array.from({length:10},()=>createTask(one)));
    assert.ok(ten.every(row=>row.ok&&row.resultId===(ten[0].ok&&ten[0].resultId)),"ONE_INTENT_HOLD");assert.equal(pids.size,2,"TWO_CONNECTIONS_REQUIRED");
    assert.equal((await createTask(one)).ok,true);const changed=await createTask({...one,quantity:2});assert.equal(changed.ok,false);
    const independent=await createTask(request(1,"same-intent"));assert.equal(independent.ok,true);
    for(const [index,kind]of ["audit","event","receipt"].entries()){
      fault=kind;const result=await createTask(request(index+2,"fault-"+kind));fault="";assert.equal(result.outcome,"ROLLED_BACK");
      assert.equal(await first.task.count({where:{projectId:ids.project,title:"fault-"+kind}}),0);
      assert.equal((await nativeSnapshot(first,withDependencies())).digest,baseline.digest,"PROTECTED_ROWS_HOLD");
    }
    loseAck=true;const recovered=await createTask(request(5,"lost-ack"));assert.equal(recovered.ok,true);if(recovered.ok)assert.equal(recovered.replayed,true);
    const replay=await createTask(request(5,"lost-ack"));assert.equal(replay.ok,true);if(replay.ok&&recovered.ok)assert.equal(replay.resultId,recovered.resultId);
    const created=await first.task.findMany({where:{projectId:ids.project,workId:ids.work},select:{id:true,quantity:true}});
    assert.equal(created.length,3);assert.equal(created.reduce((sum,row)=>sum+Number(row.quantity),0),3);
    assert.equal(await first.changeLog.count({where:{actorId:ids.manager,action:"create"}}),3);assert.equal(await first.changeLog.count({where:{actorId:ids.manager,action:"task.create.request"}}),3);
    assert.equal(await first.domainEvent.count({where:{actor:ids.manager}}),3);assert.equal(effects.filter(name=>name==="person").length,2);
    assert.equal((await nativeSnapshot(first,withDependencies())).digest,baseline.digest,"PROTECTED_ROWS_HOLD");
    await write("cleanup-intent",{owned});
    await first.$transaction(async tx=>{
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
      const live=await currentOwned(tx);await lockExactOwnedRows(tx,live);const refs={...live,TaskDependency:{column:"taskId",ids:live.Task.ids}};
      await assertNoForeignReferences(tx,refs);assert.equal((await nativeSnapshot(tx,withDependencies())).digest,baseline.digest,"CLEANUP_PROTECTED_ROWS_HOLD");
      await tx.taskDependency.deleteMany({where:{taskId:{in:live.Task.ids},dependsOnId:{in:live.Task.ids}}});
      if(live.DomainEvent)await tx.domainEvent.deleteMany({where:{id:{in:live.DomainEvent.ids}}});await tx.changeLog.deleteMany({where:{id:{in:live.ChangeLog.ids}}});
      await tx.task.deleteMany({where:{id:{in:live.Task.ids}}});await tx.work.delete({where:{id:ids.work}});await tx.product.delete({where:{id:ids.product}});
      await tx.project.delete({where:{id:ids.project}});await tx.client.delete({where:{id:ids.client}});await tx.user.deleteMany({where:{id:{in:[ids.manager,ids.worker]}}});
      assert.equal((await nativeSnapshot(tx)).digest,baseline.digest,"CLEANUP_INSIDE_HOLD");
    },{maxWait:5000,timeout:30000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
    const after=await nativeSnapshot(first);assert.equal(after.digest,baseline.digest,"CLEANUP_AFTER_HOLD");
    assert.equal(taskCreationNativeSourceHash(),approval.sourceHash,"SOURCE_CHANGED_DURING_NATIVE_HOLD");
    receipt={status:"NATIVE_PASS",identity:binding.identity,sourceHash:approval.sourceHash,pids:[...pids],sameIntentCalls:11,createdTasks:3,partials,protectedDigest:baseline.digest,afterDigest:after.digest,ownedRowsRemaining:0,
      seams:["auth session for owned manager","optional network/cache delivery","injected SQL commit ACK loss"],staging:approval.target==="staging"?"NATIVE_PASS":"NOT_RUN"};
  } catch(error){await write("hold",{status:"HOLD",owned,code:"TASK_CREATION_NATIVE_HOLD"});throw error;}
  finally {
    try {scope?.restore();} finally {
      const closed=await Promise.allSettled([first.$disconnect(),second.$disconnect()]);
      if(closed.some(row=>row.status==="rejected")){await write("disconnect-hold",{status:"HOLD",code:"DB_DISCONNECT_HOLD"});throw new Error("DB_DISCONNECT_HOLD");}
    }
  }
  assert.ok(receipt);await write("closed",receipt);return receipt;
}
