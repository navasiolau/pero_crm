import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import type {Prisma,PrismaClient,Role} from "@prisma/client";
import {nativeAcceptanceBinding,nativeDatabaseIdentity,type NativeDeclaration} from "./helpers/native-acceptance-target";
import {nativeSnapshot,verifiedRollback,type OwnedRowKeys} from "./helpers/native-acceptance-snapshot";

const ownFile=fileURLToPath(import.meta.url);
const repoRoot=path.resolve(path.dirname(ownFile),"../../..");
const sourcePaths=[
  "apps/web/src/server/tasks/workspace-contract.ts","apps/web/src/server/tasks/queries.ts",
  "apps/web/src/server/projects/queries.ts","apps/web/src/server/products/queries.ts",
  "apps/web/src/app/api/search/route.ts","apps/web/src/app/(app)/page.tsx",
  "apps/web/src/app/(app)/my/page.tsx","apps/web/src/app/(app)/tasks/page.tsx",
  "apps/web/tests/task-workspace-native.ts",
];
export function taskWorkspaceNativeSourceDigest(){
  const source=sourcePaths.map(filename=>[filename,createHash("sha256").update(readFileSync(path.join(repoRoot,filename))).digest("hex")]);
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

type PlanNode={"Node Type"?:string;"Relation Name"?:string;"Index Name"?:string;"Plan Rows"?:number;"Total Cost"?:number;Plans?:PlanNode[]};
function safePlan(node:PlanNode):unknown{
  return {node:node["Node Type"],relation:node["Relation Name"],index:node["Index Name"],estimatedRows:node["Plan Rows"],cost:node["Total Cost"],children:node.Plans?.map(safePlan)};
}

type NativePhase="ORIGINAL_BEFORE"|"FIXTURE_NAMESPACE"|"FIXTURE_CLIENT"|"FIXTURE_USER"|"FIXTURE_PROJECT"|"FIXTURE_PRODUCT"|"FIXTURE_POOL"|"FIXTURE_WORK"|"FIXTURE_GROUP"|"FIXTURE_TASK"|"FIXTURE_FOREIGN"|"PROJECT_SMALL"|"FOREIGN_GROWTH"|"PROJECT_LARGE"|"EXPLAIN_PRODUCT"|"EXPLAIN_TASK"|"OLD_BASELINE"|"MATRIX"|"DASHBOARD"|"ORIGINAL_INSIDE"|"ROLLBACK"|"ORIGINAL_AFTER";
function safeFailure(error:unknown,phase:NativePhase){
  const names=new Set(["PrismaClientValidationError","PrismaClientKnownRequestError","PrismaClientUnknownRequestError","PrismaClientInitializationError","PrismaClientRustPanicError","AssertionError","AggregateError","TypeError","Error"]);
  const value=error as {name?:unknown;code?:unknown;meta?:{code?:unknown};message?:unknown;actual?:unknown;expected?:unknown}|null;
  const labels=["EXPLICIT_OWNED_ROLLBACK_GO_REQUIRED","SOURCE_PIN_MISMATCH","FRESH_FIXTURE_NAMESPACE_REQUIRED","EXPECTED_COORDINATE_AND_FINAL_SQL","FOREIGN_TASKS_CHANGED_SCOPED_RESULT_OR_QUERY_SIZE","EXPLAIN_SELECT_ONLY","EXPLAIN_SCALAR_PARAMETERS_REQUIRED","NATIVE_SCOPE_OR_ACL_MISMATCH","SELECTED_COUNT_MISMATCH","DASHBOARD_COUNT_MISMATCH","EMPTY_SCOPE_DENY_REQUIRED","ORIGINAL_CHANGED_INSIDE_FIXTURE_TX","NATIVE_OUTBOUND_REFUSED","ROLLBACK_SCENARIOS_REQUIRED","ORIGINAL_DATA_OR_SCHEMA_CHANGED_AFTER_ROLLBACK","OWNED_ROWS_AFTER_ROLLBACK","SOURCE_CHANGED_DURING_NATIVE","ROLLBACK_PRESERVATION_HOLD","DATABASE_IDENTITY_MISMATCH"];
  return {phase,actualRows:Array.isArray(value?.actual)?value.actual.length:null,expectedRows:Array.isArray(value?.expected)?value.expected.length:null,errorName:typeof value?.name==="string"&&names.has(value.name)?value.name:"OtherError",prismaCode:typeof value?.code==="string"&&/^P\d{4}$/.test(value.code)?value.code:null,sqlState:typeof value?.meta?.code==="string"&&/^[A-Z0-9]{5}$/.test(value.meta.code)?value.meta.code:null,assertionLabel:labels.find(label=>typeof value?.message==="string"&&(value.message===label||value.message.startsWith(label+"\n")))??null};
}

/** Все fixture IDs принадлежат одному runId; оригинальные строки не изменяются. */
async function ownFixture(tx:Prisma.TransactionClient,tag:string,setPhase:(phase:NativePhase)=>void){
  const id=(label:string)=>`${tag}:${label}`;
  const number=1_000_000_000+parseInt(tag.replaceAll("-","").slice(0,7),16);
  const userIds=[id("user-own"),id("user-foreign")],projectIds=[id("project-own"),id("project-foreign"),id("project-deleted")];
  setPhase("FIXTURE_NAMESPACE");
  assert.equal(await tx.project.count({where:{OR:[{id:{in:projectIds}},{number:{in:[number,number+1,number+2].map(String)}}]}}),0,"FRESH_FIXTURE_NAMESPACE_REQUIRED");
  setPhase("FIXTURE_CLIENT");
  const client=await tx.client.create({data:{id:id("client"),name:"Проверка147",phone:"QA147"}});
  setPhase("FIXTURE_USER");
  await tx.user.createMany({data:userIds.map((key,index)=>({id:key,email:`qa147-${tag}-${index}@example.invalid`,name:"Проверка147",passwordHash:"QA147_NO_LOGIN",roles:["ENGINEER","WORKER"] as Role[]}))});
  setPhase("FIXTURE_PROJECT");
  await tx.project.createMany({data:projectIds.map((key,index)=>({id:key,number:String(number+index),numberInt:number+index,title:"Проверка147",stage:"IN_WORK",clientId:client.id,managerId:userIds[0],deletedAt:index===2?new Date(0):null}))});
  const products=[
    {id:id("product-design"),projectId:projectIds[0],status:"DESIGN" as const,engineerId:userIds[0]},
    {id:id("product-production"),projectId:projectIds[0],status:"PRODUCTION" as const,engineerId:userIds[0]},
    {id:id("product-draft"),projectId:projectIds[0],status:"DRAFT" as const},
    {id:id("product-deleted"),projectId:projectIds[0],status:"PRODUCTION" as const,deletedAt:new Date(0)},
    {id:id("product-foreign"),projectId:projectIds[1],status:"PRODUCTION" as const,engineerId:userIds[1]},
    {id:id("product-deleted-project"),projectId:projectIds[2],status:"PRODUCTION" as const},
  ].map((data,index)=>({...data,number:`${number+(index===4?1:index===5?2:0)}.${index+1}`,suffixInt:index+1,title:"Проверка147",assemblerId:userIds[index===4?1:0]}));
  setPhase("FIXTURE_PRODUCT");
  await tx.product.createMany({data:products});
  setPhase("FIXTURE_POOL");
  const pools=[id("pool-design"),id("pool-production")];
  await tx.productStagePayPool.createMany({data:pools.map((key,index)=>({id:key,productId:products[index].id,kind:"ENGINEERING",state:"DRAFT",createdById:userIds[0]}))});
  const works=products.map((product,index)=>({id:id("work-"+index),projectId:product.projectId,productId:product.id,title:"Проверка147",quantity:"1",priceSnapshot:"0",total:"0",paymentKind:index===0?"ENGINEERING" as const:"LEGACY" as const,stagePayPoolId:index===0?pools[0]:null,poolWeightUnits:index===0?1000000:null}));
  const unpriced={...works[1],id:id("work-unpriced"),priceSnapshot:null,total:null,paymentKind:"ENGINEERING" as const,stagePayPoolId:pools[1],poolWeightUnits:1000000};
  const unbound={...works[0],id:id("work-unbound"),productId:null,paymentKind:"LEGACY" as const,stagePayPoolId:null,poolWeightUnits:null};
  setPhase("FIXTURE_WORK");
  await tx.work.createMany({data:[...works,unpriced,unbound]});
  setPhase("FIXTURE_GROUP");
  const groups=[id("group-fixed"),id("group-orphan"),id("group-preview")];
  await tx.taskAllocationGroup.createMany({data:[
    {id:groups[0],workId:unpriced.id,quantity:"1",budget:"17.89",currency:"BYN",createdById:userIds[0]},
    {id:groups[1],workId:null,quantity:"1",budget:"17.89",currency:"BYN",createdById:userIds[0]},
    {id:groups[2],workId:unpriced.id,quantity:"1",budget:null,currency:null,budgetSource:"STAGE_PREVIEW",createdById:userIds[0]},
  ]});
  const today=new Date();today.setHours(12,0,0,0);
  const task=(label:string,patch:Partial<Prisma.TaskCreateManyInput>={}):Prisma.TaskCreateManyInput=>({id:id(label),projectId:projectIds[0],productId:products[0].id,workId:works[0].id,assigneeId:userIds[0],title:"Поиск147",quantity:"1",dueAt:today,...patch});
  const tasks=[
    task("task-zero"),task("task-production",{productId:products[1].id,workId:works[1].id}),
    task("task-other-assignee",{productId:products[1].id,workId:works[1].id,assigneeId:userIds[1]}),
    task("task-draft",{productId:products[2].id,workId:works[2].id}),
    task("task-frozen",{productId:products[1].id,workId:unpriced.id,allocationGroupId:groups[0],shareUnits:1000000,shareAmount:"17.89"}),
    task("task-done",{status:"DONE"}),task("task-no-date",{dueAt:null}),
    task("task-orphan",{productId:null,workId:null,allocationGroupId:groups[1],shareUnits:1000000,shareAmount:"17.89"}),
    task("task-no-work",{workId:null}),task("task-unbound-work",{workId:unbound.id}),
    task("task-cross-product",{workId:works[1].id}),task("task-cross-project",{workId:works[4].id}),
    task("task-cross-parent",{productId:products[4].id,workId:works[4].id}),
    task("task-deleted-product",{productId:products[3].id,workId:works[3].id}),
    task("task-deleted-project",{projectId:projectIds[2],productId:products[5].id,workId:works[5].id}),
    task("task-no-assignee",{assigneeId:null}),task("task-unknown-price",{productId:products[1].id,workId:unpriced.id}),
    task("task-frozen-no-amount",{productId:products[1].id,workId:unpriced.id,allocationGroupId:groups[2],shareUnits:1000000,stageShareUnits:1000000}),
  ];
  setPhase("FIXTURE_TASK");
  await tx.task.createMany({data:tasks});
  const foreign=(index:number):Prisma.TaskCreateManyInput=>task("foreign-task-"+index,{projectId:projectIds[1],productId:products[4].id,workId:works[4].id,assigneeId:userIds[1],title:"Чужая147"});
  setPhase("FIXTURE_FOREIGN");
  await tx.task.create({data:foreign(0)});
  const owned:OwnedRowKeys={
    Client:{column:"id",ids:[client.id]},User:{column:"id",ids:userIds},Project:{column:"id",ids:projectIds},
    Product:{column:"id",ids:products.map(row=>row.id)},Work:{column:"id",ids:[...works,unpriced,unbound].map(row=>row.id)},
    ProductStagePayPool:{column:"id",ids:pools},TaskAllocationGroup:{column:"id",ids:groups},Task:{column:"id",ids:[...tasks.map(row=>row.id!),id("foreign-task-0")]},
  };
  return {userId:userIds[0],projectId:projectIds[0],projectIds:projectIds.slice(0,2),productId:products[0].id,productNumber:products[0].number,foreign,owned};
}

/** Инертный до нового OWNED_ROLLBACK GO; original rows, деньги, аудит и сеть не затрагиваются. */
export async function runTaskWorkspaceNative(input:NativeDeclaration){
  assert.equal(process.env.CRM_TASK147_GO,"OWNED_ROLLBACK","EXPLICIT_OWNED_ROLLBACK_GO_REQUIRED");
  const sourceDigest=taskWorkspaceNativeSourceDigest();
  assert.equal(sourceDigest,process.env.CRM_TASK147_SOURCE_SHA256,"SOURCE_PIN_MISMATCH");
  const binding=nativeAcceptanceBinding(input);
  const {PrismaClient}=await import("@prisma/client");
  const db=new PrismaClient({datasourceUrl:binding.url,log:[{emit:"event",level:"query"}]});
  const observed:{query:string;params:string}[]=[];
  let capture=false,outbound=0;
  let phase:NativePhase="ORIGINAL_BEFORE",failedPhase:NativePhase|undefined;
  let beforeDigest:string|null=null,afterDigest:string|null=null,originalsMatch:boolean|null=null,sourceMatch:boolean|null=null,ownedRowsAfter:number|null=null;
  let rollbackVerified=false,transactionRejected=false,matrixCasesDone=0,foreignCreated=0;
  db.$on("query",event=>{if(capture)observed.push({query:event.query,params:event.params});});
  const originalFetch=globalThis.fetch,originalPrisma=(globalThis as {prisma?:PrismaClient}).prisma;
  globalThis.fetch=async()=>{outbound++;throw Error("NATIVE_OUTBOUND_REFUSED");};
  try{
    const fingerprint=(checkOwned=false)=>db.$transaction(async tx=>{
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await nativeDatabaseIdentity(tx,input);
      const snapshot=await nativeSnapshot(tx);
      if(checkOwned){
        const where={id:{startsWith:input.runId+":"}};
        const counts=await Promise.all([tx.client.count({where}),tx.user.count({where}),tx.project.count({where}),tx.product.count({where}),tx.work.count({where}),tx.productStagePayPool.count({where}),tx.taskAllocationGroup.count({where}),tx.task.count({where})]);
        ownedRowsAfter=counts.reduce((total,count)=>total+count,0);
      }
      return snapshot;
    },{isolationLevel:"RepeatableRead",timeout:120_000});
    const before=await fingerprint();beforeDigest=before.digest;
    return await verifiedRollback(async()=>{
      const rollback=new Error("TASK147_OWNED_ROLLBACK");
      let evidence:Record<string,unknown>|undefined;
      try{await db.$transaction(async tx=>{
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
        await nativeDatabaseIdentity(tx,input);
        (globalThis as {prisma?:PrismaClient}).prisma=tx as unknown as PrismaClient;
        const {taskWorkspaceWhere}=await import("../src/server/tasks/queries");
        const {taskWorkspaceEligibility,taskWorkspaceBindings}=await import("../src/server/tasks/workspace-contract");
        const {resolveVisibilityActor,taskVisibilityWhere}=await import("../src/server/access/visibility");
        const fixture=await ownFixture(tx,input.runId,value=>{phase=value;});foreignCreated=1;
        const admin={id:fixture.userId,roles:["ADMIN"] as Role[]};
        const projectProbe=async()=>{
          observed.length=0;capture=true;
          const where=await taskWorkspaceWhere(admin,{projectId:fixture.projectId});
          const rows=await tx.task.findMany({where,select:{id:true,projectId:true},orderBy:{id:"asc"}});
          capture=false;
          assert.equal(observed.length,2,"EXPECTED_COORDINATE_AND_FINAL_SQL");
          return {rows,predicateBytes:Buffer.byteLength(JSON.stringify(where)),queryBytes:observed.map(query=>Buffer.byteLength(query.query)),parameterBytes:observed.map(query=>Buffer.byteLength(query.params))};
        };
        phase="PROJECT_SMALL";const small=await projectProbe();
        const foreign=Array.from({length:9999},(_,index)=>fixture.foreign(index+1));
        phase="FOREIGN_GROWTH";await tx.task.createMany({data:foreign});foreignCreated=10000;
        fixture.owned.Task.ids.push(...foreign.map(row=>row.id!));
        phase="PROJECT_LARGE";const large=await projectProbe();
        assert.deepEqual(large,small,"FOREIGN_TASKS_CHANGED_SCOPED_RESULT_OR_QUERY_SIZE");
        const plans=[];
        for(const [index,event] of observed.entries()){
          phase=index===0?"EXPLAIN_PRODUCT":"EXPLAIN_TASK";
          assert.match(event.query,/^SELECT\s/i,"EXPLAIN_SELECT_ONLY");
          const parameters=JSON.parse(event.params) as unknown[];
          assert.ok(parameters.every(value=>value===null||["string","number","boolean"].includes(typeof value)),"EXPLAIN_SCALAR_PARAMETERS_REQUIRED");
          const result=await tx.$queryRawUnsafe<{"QUERY PLAN":{Plan:PlanNode}[]}[]>("EXPLAIN (FORMAT JSON) "+event.query,...parameters);
          plans.push({queryBytes:Buffer.byteLength(event.query),parameters:parameters.length,parameterBytes:Buffer.byteLength(event.params),plan:safePlan(result[0]["QUERY PLAN"][0].Plan)});
        }
        // Независимый baseline — прежний JOIN; используется исключительно внутри приёмки.
        phase="OLD_BASELINE";
        const legacy=await tx.$queryRaw<{id:string}[]>`
          SELECT t.id FROM "Task" t
          JOIN "Work" w ON w.id=t."workId" AND w."projectId"=t."projectId" AND w."productId"=t."productId"
          JOIN "Product" p ON p.id=t."productId" AND p.id=w."productId" AND p."projectId"=t."projectId"
          JOIN "Project" j ON j.id=t."projectId"
          WHERE t."assigneeId" IS NOT NULL AND p."deletedAt" IS NULL AND j."deletedAt" IS NULL
            AND (w."priceSnapshot" IS NOT NULL OR (t."allocationGroupId" IS NOT NULL AND t."shareAmount" IS NOT NULL))
          ORDER BY t.id`;
        const baseline:Prisma.TaskWhereInput={AND:[taskWorkspaceBindings,{id:{in:legacy.map(row=>row.id)}}]};
        const checks:{scope:string;roles:string;rows:number;predicateBytes:number}[]=[];
        const roleSets:Role[][]=[["ADMIN"],["MANAGER"],["PROCUREMENT"],["ENGINEER"],["WORKER"],["WORKER","ACCOUNTANT"],["ENGINEER","ACCOUNTANT"],["ACCOUNTANT"],[]];
        phase="MATRIX";
        for(const roles of roleSets){
          const actor=await resolveVisibilityActor(tx,{id:fixture.userId,roles});
          const scopes:[string,Parameters<typeof taskWorkspaceWhere>[1],Prisma.TaskWhereInput][]=[
            ["project",{projectId:fixture.projectId},{projectId:fixture.projectId}],
            ["product",{productKey:fixture.productId},{productId:fixture.productId}],
            ["selected-projects",{projectIds:fixture.projectIds},{projectId:{in:fixture.projectIds}}],
          ];
          if(roles[0]==="ADMIN"){
            const search={title:{contains:"Поиск147",mode:"insensitive" as const}};
            scopes.push(["product-number",{productKey:fixture.productNumber},{productId:fixture.productId}],
              ["search",{tasks:search},search],["my",{tasks:{assigneeId:fixture.userId}},{assigneeId:fixture.userId}],["global",{tasks:{}},{}]);
          }
          for(const [name,scope,limit] of scopes){
            const where=await taskWorkspaceWhere(actor,scope);
            const expected=await tx.task.findMany({where:{AND:[baseline,limit,taskVisibilityWhere(actor)]},select:{id:true,projectId:true},orderBy:{id:"asc"}});
            const actual=await tx.task.findMany({where,select:{id:true,projectId:true},orderBy:{id:"asc"}});
            assert.deepEqual(actual,expected,"NATIVE_SCOPE_OR_ACL_MISMATCH");
            if(name==="selected-projects"){
              const counts=await tx.task.groupBy({by:["projectId"],where,_count:{_all:true}});
              for(const projectId of fixture.projectIds)assert.equal(counts.find(row=>row.projectId===projectId)?._count._all??0,expected.filter(row=>row.projectId===projectId).length,"SELECTED_COUNT_MISMATCH");
            }
            checks.push({scope:name,roles:roles.join("+")||"EMPTY",rows:actual.length,predicateBytes:Buffer.byteLength(JSON.stringify(where))});matrixCasesDone=checks.length;
          }
        }
        phase="DASHBOARD";
        const todayEnd=new Date();todayEnd.setHours(23,59,59,999);
        const dashboard={status:{not:"DONE" as const},dueAt:{lte:todayEnd},project:{deletedAt:null}};
        const todayWhere=await taskWorkspaceEligibility(tx,{tasks:dashboard});
        const dashboardCount=await tx.task.count({where:todayWhere});
        assert.equal(dashboardCount,await tx.task.count({where:{AND:[baseline,dashboard]}}),"DASHBOARD_COUNT_MISMATCH");
        assert.equal(await tx.task.count({where:await taskWorkspaceEligibility(tx,{projectIds:[]})}),0,"EMPTY_SCOPE_DENY_REQUIRED");
        phase="ORIGINAL_INSIDE";
        assert.deepEqual(await nativeSnapshot(tx,fixture.owned),before,"ORIGINAL_CHANGED_INSIDE_FIXTURE_TX");
        assert.equal(outbound,0,"NATIVE_OUTBOUND_REFUSED");
        evidence={checks,dashboardCount,legacyBaselineRows:legacy.length,foreignTasks:[1,10000],scopedRows:large.rows.length,predicateBytes:[small.predicateBytes,large.predicateBytes],queryBytes:large.queryBytes,parameterBytes:large.parameterBytes,plans};
        phase="ROLLBACK";throw rollback;
      },{isolationLevel:"RepeatableRead",timeout:120_000});}catch(error){transactionRejected=true;if(error!==rollback){failedPhase=phase;throw error;}}
      assert.ok(evidence,"ROLLBACK_SCENARIOS_REQUIRED");
      return {ok:true,runId:input.runId,target:binding.identity,sourceDigest,mode:"OWNED_ROLLBACK",rolledBack:true,rollbackVerified:true,ownedRowsAfter:0,outbound,originalDigest:before.digest,originalsEqual:true,...evidence};
    },async()=>{
      phase="ORIGINAL_AFTER";const after=await fingerprint(true);afterDigest=after.digest;
      originalsMatch=after.digest===before.digest;
      assert.deepEqual(after,before,"ORIGINAL_DATA_OR_SCHEMA_CHANGED_AFTER_ROLLBACK");
      assert.equal(ownedRowsAfter,0,"OWNED_ROWS_AFTER_ROLLBACK");rollbackVerified=transactionRejected&&ownedRowsAfter===0;
      sourceMatch=taskWorkspaceNativeSourceDigest()===sourceDigest;
      assert.equal(sourceMatch,true,"SOURCE_CHANGED_DURING_NATIVE");
    });
  }catch(error){
    throw Object.assign(new Error("TASK147_NATIVE_HOLD"),{task147Diagnostic:{...safeFailure(error,originalsMatch===false?"ORIGINAL_AFTER":failedPhase??phase),beforeDigest,afterDigest,originalsMatch,sourceMatch,rollbackVerified,ownedRowsAfter,foreignCreated,matrixCasesDone,outbound}});
  }finally{
    capture=false;globalThis.fetch=originalFetch;
    if(originalPrisma)(globalThis as {prisma?:PrismaClient}).prisma=originalPrisma;
    else delete (globalThis as {prisma?:PrismaClient}).prisma;
    await db.$disconnect();
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===ownFile){
  const input:NativeDeclaration={target:"local",revision:process.env.CRM_TASK147_REVISION??"",runId:randomUUID(),scenarioId:"task147-owned-rollback"};
  runTaskWorkspaceNative(input).then(result=>console.log(JSON.stringify(result))).catch(error=>{
    const diagnostic=(error as {task147Diagnostic?:unknown}).task147Diagnostic;
    console.error(JSON.stringify({ok:false,runId:input.runId,failure:"TASK147_NATIVE_HOLD",diagnostic:diagnostic??{phase:"GUARD_OR_CONSTRUCTION"}}));process.exitCode=1;
  });
}