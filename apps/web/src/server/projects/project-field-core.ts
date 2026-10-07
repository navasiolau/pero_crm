import {liveProjectWhere,liveProductWhere} from "@/server/access/live-entities";
import {assertProjectCurrencyChange} from "@/server/product-stage-pay/core";
import {assertPercentageProjectCurrencyChange} from "@/server/product-percentage-pay/core";
import {createHash} from "node:crypto";
import {Prisma,type Project} from "@prisma/client";
import {z} from "zod";
import {hasAnyRole,MANAGER_ROLES,FINANCE_ROLES} from "@/lib/roles";
import {assertProjectMoneyCurrency,INTERNAL_CURRENCY} from "@/lib/internal-currency";
import {decimalAtoms,decimalText,productsTotal} from "@/lib/product-quantity";
import {withTaskTransaction,type TaskTransaction} from "@/server/tasks/transaction";
import type {DomainActor} from "./core";
import {patchProjectContactInTransaction} from "./contact-core";
import {projectPricingProjectionSchema,projectPatchSchema,malformedProjectPatch,projectMoneySchema,type ProjectPatch,type ProjectPatchResult,type ProjectPatchValue,type ProjectPatchDerived,type ProjectFullBaseline} from "./patch-contract";

const services=["delivery","unloading","installation"] as const;
const legacyFields=["title","clientId","managerId","address","delivery","unloading","installation","currency"] as const;
type LegacyField=typeof legacyFields[number];
const moneyInput=z.union([projectMoneySchema,z.number().nonnegative()]);
const baselineSchema=z.object({title:z.string().optional(),clientId:z.string().optional(),managerId:z.string().nullable().optional(),address:z.string().nullable().optional(),delivery:projectMoneySchema.optional(),unloading:projectMoneySchema.optional(),installation:projectMoneySchema.optional(),currency:z.string().optional()}).strict();
export const legacyProjectUpdateSchema=z.object({title:z.string().refine(value=>value.trim().length>0,"Укажите название проекта").optional(),clientId:z.string().min(1).optional(),managerId:z.string().nullable().optional(),address:z.string().nullable().optional(),delivery:moneyInput.optional(),unloading:moneyInput.optional(),installation:moneyInput.optional(),currency:z.string().refine(value=>value===INTERNAL_CURRENCY,"Внутренние суммы CRM используют только BYN").optional(),baseline:baselineSchema.optional()}).strict();
export type LegacyProjectUpdateInput=z.input<typeof legacyProjectUpdateSchema>;
const json=(value:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(value));
function canonical(field:string,value:unknown):ProjectPatchValue {
 if(value===undefined||value===null)return null;
 return [...services].includes(field as typeof services[number])?new Prisma.Decimal(String(value)).toFixed(2):String(value);
}
function normalize(field:string,value:unknown):ProjectPatchValue {
 const money=canonical(field,value);
 if([...services].includes(field as typeof services[number]))return money;
 return typeof money==="string"?money.trim()||null:money;
}
export function projectFullBaseline(project:Pick<Project,LegacyField>):ProjectFullBaseline {
 return {title:project.title,clientId:project.clientId,managerId:project.managerId,address:project.address,
 delivery:canonical("delivery",project.delivery),unloading:canonical("unloading",project.unloading),installation:canonical("installation",project.installation),currency:project.currency};
}
async function validateManager(tx:Prisma.TransactionClient,value:ProjectPatchValue) {
 if(value!==null&&!await tx.user.findFirst({where:{id:value,active:true,roles:{hasSome:MANAGER_ROLES}},select:{id:true}}))throw Error("Выберите активного менеджера");
}
async function lightweightTotal(tx:Prisma.TransactionClient,projectId:string,project:Pick<Project,"delivery"|"unloading"|"installation">) {
 const products=await tx.product.findMany({where:{...liveProductWhere,projectId},select:{expectedPrice:true,quantity:true}});
 // Неполная оценка не превращается в известный ноль. Запись услуги при этом валидна.
 const productsSubtotalBYN=products.some(product=>product.expectedPrice===null)?null:productsTotal(products);
 const expectedTotalBYN=productsSubtotalBYN===null?null:decimalText(decimalAtoms(productsSubtotalBYN,2,18)+services.reduce((sum,field)=>sum+decimalAtoms(project[field]??"0",2,12),BigInt(0)),2);
 // Внутри общего сериализующего lock: порядок transaction IDs — порядок проекций.
 const versions=await tx.$queryRaw<{pricingVersion:string}[]>`SELECT txid_current()::text AS "pricingVersion"`;
 return projectPricingProjectionSchema.parse({productsSubtotalBYN,expectedTotalBYN,pricingVersion:versions[0]?.pricingVersion,
  delivery:canonical("delivery",project.delivery),unloading:canonical("unloading",project.unloading),installation:canonical("installation",project.installation)});
}
/** Версия initial/RSC читается вместе с ценами, а не приклеивается к прежним page props. */
export async function getProjectPricingProjection(actor:DomainActor,projectId:string,transaction:TaskTransaction=withTaskTransaction) {
 if(!hasAnyRole(actor.roles,MANAGER_ROLES)&&!hasAnyRole(actor.roles,FINANCE_ROLES))return null;
 return transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
  const project=await tx.project.findUnique({where:{...liveProjectWhere,id:projectId},select:{currency:true,delivery:true,unloading:true,installation:true}});
  if(!project||project.currency!==INTERNAL_CURRENCY)return null;
  return lightweightTotal(tx,projectId,project);
 });
}
export async function patchProjectCore(actor:DomainActor,input:ProjectPatch,transaction:TaskTransaction=withTaskTransaction):Promise<ProjectPatchResult> {
 const parsed=projectPatchSchema.safeParse(input);if(!parsed.success)return malformedProjectPatch(input,parsed.error.issues[0]?.message);
 const patch=parsed.data;const identity={field:patch.field,clientMutationId:patch.clientMutationId};
 if(!hasAnyRole(actor.roles,MANAGER_ROLES))return{...identity,kind:"forbidden",error:"Недостаточно прав"};
 const receiptId=`project-inline:${patch.clientMutationId}`,fingerprint=createHash("sha256").update(JSON.stringify(patch)).digest("hex");
 try{return await transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${patch.projectId} FOR UPDATE`;
  const project=await tx.project.findUnique({where:{...liveProjectWhere,id:patch.projectId},select:{id:true,title:true,clientId:true,managerId:true,address:true,currency:true,delivery:true,unloading:true,installation:true}});
  if(!project)return{...identity,kind:"not-found",error:"Проект не найден"};
  const receipt=await tx.changeLog.findUnique({where:{id:receiptId}});
  if(receipt){const saved=receipt.newValue;
   if(receipt.actorType!=="user"||receipt.actorId!==actor.id||receipt.entity!=="project"||receipt.entityId!==patch.projectId||receipt.action!=="inline.update"||receipt.field!==patch.field||!saved||typeof saved!=="object"||Array.isArray(saved)||saved.fingerprint!==fingerprint)return{...identity,kind:"validation",error:"Идентификатор сохранения уже использован"};
   if(!saved.result||typeof saved.result!=="object"||Array.isArray(saved.result))throw Error("Повреждён результат сохранения");
   return{...saved.result as unknown as Extract<ProjectPatchResult,{kind:"saved"}>,repeated:true};
  }
  let result:Extract<ProjectPatchResult,{kind:"saved"}>;
  if(patch.field==="clientId"||patch.field==="address"||patch.field==="client.phone"||patch.field==="client.address"){
   const shared=await patchProjectContactInTransaction(actor,{projectId:patch.projectId,field:patch.field==="client.phone"?"phone":patch.field==="client.address"?"clientAddress":patch.field,value:patch.value,expectedValue:patch.expectedValue,...(patch.field==="client.phone"||patch.field==="client.address"?{expectedClientId:patch.expectedClientId}:{})},tx);
   if(!shared.ok)return{...identity,...shared};
   result={...identity,kind:"saved",value:shared.value,noOp:!shared.changed,derived:{clientId:shared.clientId,clientLabel:shared.clientLabel,phone:shared.phone,clientAddress:shared.clientAddress,...(patch.field==="client.phone"?{phone:String(shared.value)}:{})}};
  }else{
   const current=canonical(patch.field,project[patch.field]);if(current!==canonical(patch.field,patch.expectedValue))return{...identity,kind:"conflict",error:"Поле изменено другим пользователем",currentValue:current};
   const value=normalize(patch.field,patch.value);if(current===value)return{...identity,kind:"saved",value,noOp:true};
   if(services.some(field=>field===patch.field))assertProjectMoneyCurrency(project.currency);
   if(patch.field==="managerId")await validateManager(tx,value);
   await tx.project.update({where:{id:patch.projectId},data:{[patch.field]:value}});
   const derived:ProjectPatchDerived={};
   if(services.some(field=>field===patch.field)){
    const prices={...project,[patch.field]:value};Object.assign(derived,await lightweightTotal(tx,patch.projectId,prices));
   }
   if(patch.field==="managerId")derived.managerLabel=value?(await tx.user.findFirst({where:{id:value},select:{name:true}}))?.name??null:null;
   result={...identity,kind:"saved",value,derived};
   await tx.domainEvent.create({data:{type:"project.updated",actor:actor.id,payload:{projectId:patch.projectId,field:patch.field}}});
  }
  if(!result.noOp)await tx.changeLog.create({data:{id:receiptId,actorType:"user",actorId:actor.id,actorName:actor.name,source:actor.source,entity:"project",entityId:patch.projectId,action:"inline.update",field:patch.field,oldValue:json({value:patch.expectedValue}),newValue:json({fingerprint,result})}});
  return result;
 });}catch(error){return{...identity,kind:"failure",error:error instanceof Error?error.message:"Не удалось сохранить поле"};}
}

export async function updateProjectFieldsCore(actor:DomainActor,projectId:string,input:LegacyProjectUpdateInput,transaction:TaskTransaction=withTaskTransaction):Promise<{ok:true;noOp:boolean}|{ok:false;error:string}> {
 if(!hasAnyRole(actor.roles,MANAGER_ROLES))return{ok:false,error:"Недостаточно прав"};
 const parsed=legacyProjectUpdateSchema.safeParse(input);if(!parsed.success)return{ok:false,error:parsed.error.issues[0]?.message??"Ошибка данных"};
 const {baseline,...values}=parsed.data;
 try{return await transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
  const current=await tx.project.findUnique({where:{...liveProjectWhere,id:projectId}});if(!current)return{ok:false,error:"Проект не найден"};
  const data:Record<string,ProjectPatchValue>={};
  for(const field of legacyFields){if(values[field]===undefined)continue;
   if(!baseline||!Object.prototype.hasOwnProperty.call(baseline,field))throw Error("Обновите форму: требуется исходное значение изменённых полей");
   const desired=normalize(field,values[field]),expected=canonical(field,baseline[field]);
   if(desired===expected)continue;
   if(canonical(field,current[field])!==expected)throw Error("Проект изменён другим пользователем — обновите форму");
   data[field]=desired;
  }
  if(!Object.keys(data).length)return{ok:true,noOp:true};
  if("currency"in data){await assertProjectCurrencyChange(tx,projectId,data.currency!);await assertPercentageProjectCurrencyChange(tx,projectId,data.currency!);}
  if([...services].some(field=>field in data))assertProjectMoneyCurrency(data.currency??current.currency);
  if("managerId"in data)await validateManager(tx,data.managerId);
  // Все CAS проверены до первого shared write; ошибки далее бросаются для rollback.
  for(const field of ["address","clientId"] as const){if(!(field in data))continue;
   const shared=await patchProjectContactInTransaction(actor,{projectId,field,value:data[field],expectedValue:canonical(field,current[field])},tx);
   if(!shared.ok)throw Error(shared.error);
   delete data[field];
  }
  if(Object.keys(data).length){
   await tx.project.update({where:{id:projectId},data});
   await tx.changeLog.create({data:{actorType:"user",actorId:actor.id,actorName:actor.name,source:actor.source,entity:"project",entityId:projectId,action:"update",oldValue:json(Object.fromEntries(Object.keys(data).map(field=>[field,canonical(field,current[field as LegacyField])]))),newValue:json(data)}});
   await tx.domainEvent.create({data:{type:"project.updated",actor:actor.id,payload:{projectId,fields:Object.keys(data)}}});
  }
  return{ok:true,noOp:false};
 });}catch(error){return{ok:false,error:error instanceof Error?error.message:"Не удалось изменить проект"};}
}
