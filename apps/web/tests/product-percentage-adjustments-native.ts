import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
import type {Prisma,ProductPercentageKind} from "@prisma/client";
import {nativeAcceptanceBinding,nativeDatabaseIdentity,type NativeDeclaration} from "./helpers/native-acceptance-target";
import {nativeSnapshot,verifiedRollback} from "./helpers/native-acceptance-snapshot";
import {assertPercentagePrerequisites} from "./helpers/native-percentage-prerequisites";

async function rejected(tx:Prisma.TransactionClient,operation:()=>Promise<unknown>){
 await tx.$executeRawUnsafe("SAVEPOINT qa90_failure");
 try{await assert.rejects(operation);}finally{await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT qa90_failure");await tx.$executeRawUnsafe("RELEASE SAVEPOINT qa90_failure");}
}
export async function runPercentageAdjustmentsAcceptance(input:NativeDeclaration){
 const binding=nativeAcceptanceBinding(input);
 const {PrismaClient}=await import("@prisma/client");
 const db=new PrismaClient({datasourceUrl:binding.url});
 try {
 await nativeDatabaseIdentity(db,input);
 const {captureDirectPercentage,settleSkippedPercentage}=await import("../src/server/product-percentage-pay/direct-completion");
 const {patchProductPercentageCore}=await import("../src/server/product-percentage-pay/patch-core");
 const {getProductPercentageView}=await import("../src/server/product-percentage-pay/queries");
 const {getProjectEconomics}=await import("../src/server/finance/queries");
 const abort=new Error("QA163_ROLLBACK"),checks:string[]=[];
 const configured=await db.orgSetting.findUnique({where:{key:"payrollCurrency"}});
 assert.equal(configured?.value??"BYN","BYN","PAYROLL_CURRENCY_PREREQUISITE");
 await assertPercentagePrerequisites(db);
 const before=await nativeSnapshot(db),originalFetch=globalThis.fetch;let outbound=0,after:Awaited<ReturnType<typeof nativeSnapshot>>|undefined;
 globalThis.fetch=async()=>{outbound++;throw Error("QA90_NO_NETWORK");};
 try{
  await verifiedRollback(async()=>{
  try {await db.$transaction(async tx=>{
   const tag=randomUUID();
   const users=await Promise.all((["MANAGER","ENGINEER","WORKER","MOUNTER"] as const).map(role=>tx.user.create({data:{name:`Проверка90 ${role}`,email:`qa90-${tag}-${role}@example.invalid`,passwordHash:"QA90_NO_LOGIN",roles:[role]}})));
   const [manager,engineer,assembler,mounter]=users,actor={id:manager.id,name:manager.name,roles:manager.roles,source:"web" as const};
   const client=await tx.client.create({data:{name:"Проверка90",phone:"QA90"}});
   const numberInt=((await tx.project.aggregate({_max:{numberInt:true}}))._max.numberInt??0)+1;
   const project=await tx.project.create({data:{number:String(numberInt),numberInt,title:"Проверка90",clientId:client.id,managerId:manager.id,currency:"BYN"}});
   const product=await tx.product.create({data:{projectId:project.id,number:`${numberInt}.1`,suffixInt:1,title:"Проверка90",status:"PRODUCTION",expectedPrice:"1000",quantity:3,engineerId:engineer.id,assemblerId:assembler.id,mounterId:mounter.id}});
   const kinds:ProductPercentageKind[]=["ENGINEERING","ASSEMBLY","INSTALLATION"],recipients=[engineer,assembler,mounter];
   for(const kind of kinds){
    await tx.productPercentageConfig.create({data:{productId:product.id,kind,ratePercent:"5",revision:1}});
    await captureDirectPercentage(tx,actor,product.id,kind,kind==="ENGINEERING"?"PRODUCTION":kind==="ASSEMBLY"?"INSTALLATION":"DONE");
   }
   const original=await tx.productPercentageCompletion.findMany({where:{productId:product.id},include:{shares:true},orderBy:{kind:"asc"}});
   const initialPayroll=await tx.payrollEntry.findMany({where:{productId:product.id},orderBy:{id:"asc"}});
   const patch=async(kind:ProductPercentageKind,value:string)=>{
    const config=(await tx.productPercentageConfig.findUnique({where:{productId_kind:{productId:product.id,kind}}}))!;
    const input={productId:product.id,kind,field:"ratePercent" as const,value,expectedValue:config.ratePercent!.toString(),expectedRevision:config.revision,clientMutationId:randomUUID()};
    const notices:Parameters<typeof patchProductPercentageCore>[3]=[];
    const result=await patchProductPercentageCore(actor,input,tx,notices);
    assert.equal(result.ok,true);
    const counts=await tx.productPercentageAdjustment.count();
    const repeated=await patchProductPercentageCore(actor,input,tx,[]);
    assert.equal(repeated.ok,true);
    if(repeated.ok)assert.equal(repeated.repeated,true);
    assert.equal(await tx.productPercentageAdjustment.count(),counts);
    return notices;
   };
   for(const rate of ["6","4","0"]){
    for(const [index,kind] of kinds.entries()){
     const notices=await patch(kind,rate);assert.equal(notices.length,1);
     const expected=String(Number(rate)*(index===0?10:30));
     const view=await getProductPercentageView({id:recipients[index].id,roles:recipients[index].roles},product.id,tx);
     assert.equal(Number(view.sections[kind].total),Number(expected));
     const managerView=await getProductPercentageView(actor,product.id,tx);
     assert.equal(Number(managerView.sections[kind].total),Number(expected));
     const sum=await tx.payrollEntry.aggregate({where:{productId:product.id,userId:recipients[index].id},_sum:{amount:true}});
     assert.equal(sum._sum.amount!.toNumber(),Number(expected));
    }
    const economics=await getProjectEconomics(project.id,tx);
    assert.equal(economics!.payrollTotal,Number(rate)*70);
   }
   assert.deepEqual(await tx.productPercentageCompletion.findMany({where:{productId:product.id},include:{shares:true},orderBy:{kind:"asc"}}),original);
   assert.deepEqual(await tx.payrollEntry.findMany({where:{id:{in:initialPayroll.map(row=>row.id)}},orderBy:{id:"asc"}}),initialPayroll);
   checks.push("three_kinds_raise_lower_zero_receipt_replay_current_views_payroll_economics_originals_immutable");
   // Разные проценты с тем же округлённым итогом: корректировка есть, PayrollEntry нет.
   await tx.product.update({where:{id:product.id},data:{expectedPrice:"1"}});
   await patch("ASSEMBLY","1");
   const countBefore=await tx.payrollEntry.count({where:{productId:product.id}});
   const notices=await patch("ASSEMBLY","1.5");
   assert.equal(notices.length,0);assert.equal(await tx.payrollEntry.count({where:{productId:product.id}}),countBefore);
   checks.push("zero_delta_has_receipt_and_no_payroll_or_notification");
   const configBefore=await tx.productPercentageConfig.findUnique({where:{productId_kind:{productId:product.id,kind:"ENGINEERING"}}});
   await rejected(tx,()=>tx.productPercentageCompletion.update({where:{id:original[0].id},data:{amount:"999"}}));
   const ownedCompletion=original.find(row=>row.kind==="ENGINEERING")!;
   assert.equal(ownedCompletion.productId,product.id,"TASK_OWNED_COMPLETION_REQUIRED");
   const ownedShareId=ownedCompletion.shares[0].id;
   const adjustment=(await tx.productPercentageAdjustment.findFirst({where:{completionShareId:ownedShareId,kind:"ENGINEERING"}}))!;
   assert.equal(adjustment.completionShareId,ownedShareId,"TASK_OWNED_ADJUSTMENT_REQUIRED");
   await rejected(tx,()=>tx.productPercentageAdjustment.update({where:{id:adjustment.id},data:{amount:"999"}}));
   await rejected(tx,()=>tx.payrollEntry.delete({where:{id:initialPayroll[0].id}}));
   // Ошибка после UPDATE конфига обязана вылететь наружу, чтобы весь tx откатился.
   await tx.$executeRawUnsafe("SAVEPOINT qa90_atomic");
   const failTx=new Proxy(tx,{get(target,key){if(key==="productPercentageAdjustment")return new Proxy(target.productPercentageAdjustment,{get(model,method){if(method==="create")return async()=>{throw Error("QA90_WRITE_FAILURE");};return Reflect.get(model,method);}});return Reflect.get(target,key);}});
   await assert.rejects(patchProductPercentageCore(actor,{productId:product.id,kind:"ENGINEERING",field:"ratePercent",value:"5",expectedValue:configBefore!.ratePercent!.toString(),expectedRevision:configBefore!.revision,clientMutationId:randomUUID()},failTx),/QA90_WRITE_FAILURE/);
   await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT qa90_atomic");
   assert.deepEqual(await tx.productPercentageConfig.findUnique({where:{productId_kind:{productId:product.id,kind:"ENGINEERING"}}}),configBefore);
   checks.push("native_triggers_preserved_and_error_rolls_back_rate");
   const skipped=await tx.product.create({data:{projectId:project.id,number:`${numberInt}.2`,suffixInt:2,title:"Проверка90 пропущенного",status:"PRODUCTION",expectedPrice:"1000",quantity:3,assemblerId:assembler.id}});
   await tx.productPercentageConfig.create({data:{productId:skipped.id,kind:"ASSEMBLY",ratePercent:null,revision:1}});
   await captureDirectPercentage(tx,actor,skipped.id,"ASSEMBLY","INSTALLATION");
   await tx.productPercentageConfig.update({where:{productId_kind:{productId:skipped.id,kind:"ASSEMBLY"}},data:{ratePercent:"5",revision:2}});
   assert.equal(await settleSkippedPercentage(tx,actor,skipped.id,"ASSEMBLY","INSTALLATION"),"SETTLED");
   assert.equal(await settleSkippedPercentage(tx,actor,skipped.id,"ASSEMBLY","INSTALLATION"),"SETTLED");
   assert.equal(await tx.payrollEntry.count({where:{productId:skipped.id}}),1);
   checks.push("skipped_once_late_settlement_native_and_repeat");
   const zero=await tx.product.create({data:{projectId:project.id,number:`${numberInt}.3`,suffixInt:3,title:"Проверка90 нулевого без получателя",status:"PRODUCTION",expectedPrice:"1000",quantity:3}});
   await tx.productPercentageConfig.create({data:{productId:zero.id,kind:"ASSEMBLY",ratePercent:"0",revision:1}});
   await captureDirectPercentage(tx,actor,zero.id,"ASSEMBLY","INSTALLATION");
   await tx.product.update({where:{id:zero.id},data:{assemblerId:assembler.id}});
   assert.equal((await patchProductPercentageCore(actor,{productId:zero.id,kind:"ASSEMBLY",field:"ratePercent",value:"5",expectedValue:"0",expectedRevision:1,clientMutationId:randomUUID()},tx)).ok,true);
   assert.equal((await tx.payrollEntry.findFirst({where:{productId:zero.id}}))!.amount.toNumber(),150);
   checks.push("zero_without_original_recipient_can_gain_first_adjustment");
   throw abort;
  }, {timeout:120000,maxWait:10000});throw Error("ROLLBACK_MARKER_NOT_RAISED");}
  catch(error){if(error!==abort)throw error;}
  },async()=>{after=await nativeSnapshot(db);assert.deepEqual(after,before,"ORIGINAL_DATA_SCHEMA_CHANGED_AFTER_ROLLBACK");assert.equal(outbound,0,"NATIVE_OUTBOUND_REFUSED");});
  return {status:"PASS",level:"native-PostgreSQL",identity:binding.identity,revision:input.revision,target:input.target,runId:input.runId,scenarioId:input.scenarioId,producerId:"percentage-adjustments",producerVersion:2,checks:checks.map(id=>({id:id.replaceAll("_","-"),status:"PASS"})),preservation:{mode:"rollback",status:"PASS",rollback:"VERIFIED",beforeDigest:before.digest,afterDigest:after!.digest},persistedRows:0,outbound};
 }finally{globalThis.fetch=originalFetch;}
 } finally {await db.$disconnect();}
}
const direct=process.argv[1]&&path.basename(process.argv[1])==="product-percentage-adjustments-native.ts"&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(direct){const [target,revision,runId,scenarioId]=process.argv.slice(2);if(target!=="local"&&target!=="staging")throw Error("EXPLICIT_NATIVE_TARGET_REQUIRED");void runPercentageAdjustmentsAcceptance({target,revision,runId,scenarioId}).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error(JSON.stringify({status:"BLOCKED",code:"NATIVE_ACCEPTANCE_FAILED"}));process.exitCode=1;});}
