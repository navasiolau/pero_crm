// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; только существующая local5433.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "../../tests/helpers/local-crm-database";
import { nativeSnapshot } from "../../tests/helpers/native-acceptance-snapshot";
import { hashPassword } from "../../src/lib/password";
import { createProductCore, deleteProductCore } from "../../src/server/products/core";

type Fixture = { token: string; userId: string; email: string; password: string; clientId: string; projectId: string; projectNumber: string;
  products: {id:string;number:string;suffixInt:number|null;updatedAt:string}[]; before: Awaited<ReturnType<typeof nativeSnapshot>>; cleaned?: boolean };
async function main() {
  const mode = process.argv[2], file = path.resolve(process.argv[3] ?? "");
  assert.ok(["create", "race", "cleanup", "inspect"].includes(mode), "QA211_MODE_STOP");
  assert.ok(file.split(path.sep).includes(".playwright-mcp"), "QA211_PRIVATE_PATH_STOP");
  const url = existingLocalCrmDatabaseUrl(), db = new PrismaClient({ datasourceUrl: url });
  const rows = async (projectId: string) => (await db.product.findMany({where:{projectId,deletedAt:null},select:{id:true,number:true,suffixInt:true,updatedAt:true},orderBy:{suffixInt:"asc"}}))
    .map(row=>({...row,updatedAt:row.updatedAt.toISOString()}));
  try {
    if (mode === "create") {
      assert.equal(existsSync(file), false, "QA211_FILE_EXISTS");
      const before = await nativeSnapshot(db), token = randomUUID(), userId = `qa211-browser-${token}`;
      const password = randomUUID(), email = `${userId}@example.invalid`, passwordHash = await hashPassword(password);
      const fixture = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
        const user = await tx.user.create({data:{id:userId,name:"Проверка211",email,passwordHash,roles:["ADMIN"]}});
        const client = await tx.client.create({data:{id:`${userId}-client`,name:"Проверка211",phone:"QA211_SYNTHETIC"}});
        const numberInt=((await tx.project.aggregate({_max:{numberInt:true}}))._max.numberInt??0)+1;
        const project=await tx.project.create({data:{id:`${userId}-project`,number:String(numberInt),numberInt,title:`QA211 ${token}`,clientId:client.id,stage:"CONTRACT",managerId:user.id}});
        const actor={id:user.id,name:user.name,roles:user.roles,source:"web" as const};
        for(let suffix=1;suffix<=15;suffix++) assert.ok((await createProductCore(actor,{projectId:project.id,title:`Проверка211 ${suffix}`,quantity:2,expectedPrice:100},operation=>operation(tx))).ok);
        await tx.product.create({data:{id:`${userId}-deleted`,projectId:project.id,number:`${project.number}.63`,suffixInt:63,title:"Удалённое211",deletedAt:new Date(0),createdById:user.id}});
        return{token,userId,email,password,clientId:client.id,projectId:project.id,projectNumber:project.number,before};
      },{timeout:30_000});
      const saved:Fixture={...fixture,products:await rows(fixture.projectId)};
      writeFileSync(file,JSON.stringify(saved,null,2),{encoding:"utf8",flag:"wx"});
      console.log(JSON.stringify({status:"PASS",mode,projectId:saved.projectId,projectNumber:saved.projectNumber,active:saved.products.length}));return;
    }
    const fixture=JSON.parse(readFileSync(file,"utf8")) as Fixture;
    assert.match(fixture.token,/^[a-f0-9-]{36}$/);assert.equal(fixture.userId,`qa211-browser-${fixture.token}`);assert.equal(fixture.projectId,`${fixture.userId}-project`);
    assert.equal(fixture.cleaned,undefined,"QA211_ALREADY_CLEANED");
    const parent=await db.project.findUniqueOrThrow({where:{id:fixture.projectId}});
    assert.equal(parent.title,`QA211 ${fixture.token}`);assert.equal(parent.clientId,fixture.clientId);
    if(mode==="inspect") {console.log(JSON.stringify({status:"PASS",mode,projectNumber:fixture.projectNumber,products:await rows(fixture.projectId)}));return;}
    if(mode==="race") {
      const peer=new PrismaClient({datasourceUrl:url});
      try {
        const user=await db.user.findUniqueOrThrow({where:{id:fixture.userId}}),actor={id:user.id,name:user.name,roles:user.roles,source:"web" as const};
        const target=await db.product.findFirstOrThrow({where:{projectId:fixture.projectId,deletedAt:null,suffixInt:7}});
        let arrivals=0,release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;});const pids=new Set<number>();
        const transaction=(database:PrismaClient)=><T>(operation:(tx:Prisma.TransactionClient)=>Promise<T>)=>database.$transaction(async tx=>{
          pids.add((await tx.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0].pid);
          if(++arrivals===2)release();await ready;
          await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;return operation(tx);
        },{timeout:30_000,maxWait:5_000});
        const results=await Promise.all([
          createProductCore(actor,{projectId:fixture.projectId,title:"Проверка211 одновременно"},transaction(db)),
          deleteProductCore(actor,target.id,transaction(peer),{expectedUpdatedAt:target.updatedAt.toISOString(),clientMutationId:randomUUID()}),
        ]);
        assert.ok(results.every(result=>result.ok));assert.equal(pids.size,2);
        fixture.products=await rows(fixture.projectId);
        assert.deepEqual(fixture.products.map(row=>row.number),Array.from({length:15},(_,i)=>`${fixture.projectNumber}.${i+1}`));
        writeFileSync(file,JSON.stringify(fixture,null,2));
        console.log(JSON.stringify({status:"PASS",mode,backends:pids.size,active:fixture.products.length,contiguous:true}));return;
      }finally{await peer.$disconnect();}
    }
    await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
      const products=await tx.product.findMany({where:{projectId:fixture.projectId}}),ids=products.map(row=>row.id);
      assert.ok(products.length>=16&&products.length<=20&&products.every(row=>row.createdById===fixture.userId),"QA211_PRODUCT_OWNERSHIP_STOP");
      for(const count of [await tx.task.count({where:{projectId:fixture.projectId}}),await tx.work.count({where:{projectId:fixture.projectId}}),
        await tx.file.count({where:{projectId:fixture.projectId}}),await tx.payrollEntry.count({where:{productId:{in:ids}}}),await tx.proposalItem.count({where:{productId:{in:ids}}})])assert.equal(count,0,"QA211_FOREIGN_REFERENCE_STOP");
      await tx.notification.deleteMany({where:{userId:fixture.userId}});
      await tx.productStatusHistory.deleteMany({where:{productId:{in:ids}}});
      await tx.productPercentageConfig.deleteMany({where:{productId:{in:ids}}});
      await tx.changeLog.deleteMany({where:{actorId:fixture.userId}});
      await tx.product.deleteMany({where:{projectId:fixture.projectId,id:{in:ids}}});
      await tx.project.delete({where:{id:fixture.projectId}});
      await tx.client.delete({where:{id:fixture.clientId}});
      await tx.user.delete({where:{id:fixture.userId}});
    },{timeout:30_000});
    assert.deepEqual(await nativeSnapshot(db),fixture.before,"QA211_EXISTING_DATA_PRESERVATION_STOP");
    fixture.cleaned=true;writeFileSync(file,JSON.stringify(fixture,null,2));
    console.log(JSON.stringify({status:"PASS",mode,existingDataPreserved:true}));
  }finally{await db.$disconnect();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
