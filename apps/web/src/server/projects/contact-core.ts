import type {Prisma} from '@prisma/client';
import type {DomainActor} from './core';
import {mayManageContacts,patchClientPhoneInTransaction,type ContactResult} from '@/server/clients/core';
export type ProductContactResult = ContactResult & {currentClientLabel?:string};
export type ProjectContactPatch = {projectId:string;field:'clientId'|'address'|'phone';value:string|null;expectedValue:string|null;expectedClientId?:string};
export type ProductContactPatch = {productId:string;field:'clientId'|'address'|'phone';value:string|null;expectedValue:string|null;expectedClientId?:string};
/** Порядок блокировок: Project → Client. Изделие используется только как точка доступа. */
export async function patchProductContactInTransaction(actor:DomainActor,patch:ProductContactPatch,tx:Prisma.TransactionClient):Promise<ProductContactResult> {
 if(!mayManageContacts(actor))return{ok:false,kind:'forbidden',error:'Недостаточно прав'};
 const product=await tx.product.findUnique({where:{id:patch.productId},select:{projectId:true}});
 if(!product)return{ok:false,kind:'not-found',error:'Изделие не найдено'};
 return patchProjectContactInTransaction(actor,{projectId:product.projectId,field:patch.field,value:patch.value,expectedValue:patch.expectedValue,expectedClientId:patch.expectedClientId},tx);
}

/** Общая операция настоящего Project: никаких фиктивных изделий или повторных writers. */
export async function patchProjectContactInTransaction(actor:DomainActor,patch:ProjectContactPatch,tx:Prisma.TransactionClient):Promise<ProductContactResult> {
 if(!mayManageContacts(actor))return{ok:false,kind:'forbidden',error:'Недостаточно прав'};
 const projectId=patch.projectId;
 await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
 const project=await tx.project.findUnique({where:{id:projectId},select:{id:true,clientId:true,address:true}});
 if(!project)return{ok:false,kind:'not-found',error:'Проект не найден'};
 if(patch.field==='phone'){
  if(typeof patch.value!=='string'||typeof patch.expectedValue!=='string'||!patch.expectedClientId)return{ok:false,kind:'validation',error:'Укажите телефон и исходного клиента'};
  if(project.clientId!==patch.expectedClientId){
   // Менеджмент уже проверен до любых чтений; блокировка связи предшествует
   // Client, чтобы явное принятие конфликта использовало точный текущий телефон.
   await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${project.clientId} FOR UPDATE`;
   const currentClient=await tx.client.findUnique({where:{id:project.clientId},select:{phone:true,name:true,lastName:true,middleName:true}});
   if(!currentClient)return{ok:false,kind:'not-found',error:'Клиент не найден'};
   return{ok:false,kind:'conflict',error:'Клиент проекта изменён',currentClientId:project.clientId,
    currentValue:currentClient.phone,currentClientLabel:[currentClient.lastName,currentClient.name,currentClient.middleName].filter(Boolean).join(' ')};
  }
  const result=await patchClientPhoneInTransaction(tx,actor,project.clientId,patch.value,patch.expectedValue);
  return result.ok?{...result,projectId}:result;
 }
 const field=patch.field;
 const value=field==='address'?(patch.value?.trim()||null):patch.value;
 if(field==='clientId'&&(!value||typeof value!=='string'))return{ok:false,kind:'validation',error:'Выберите клиента'};
 if(project[field]!==patch.expectedValue)return{ok:false,kind:'conflict',error:'Реквизит проекта изменён другим пользователем',currentValue:project[field],currentClientId:project.clientId};
 if(project[field]===value)return{ok:true,value,changed:false,projectId,clientId:project.clientId};
 let selectedClient: {id:string;name:string;lastName:string|null;middleName:string|null;phone:string}|null=null;
 if(field==='clientId'){
  await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${value} FOR UPDATE`;
  const client=await tx.client.findUnique({where:{id:value!},select:{id:true,name:true,lastName:true,middleName:true,phone:true}});
  selectedClient=client;
  if(!client)return{ok:false,kind:'not-found',error:'Клиент не найден'};
 }
 const update=await tx.project.updateMany({where:{id:projectId,[field]:patch.expectedValue},data:{[field]:value}});
 if(update.count!==1)throw new Error('PROJECT_CONTACT_CAS_RACE');
 await tx.changeLog.create({data:{actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'project',entityId:projectId,action:'update',field,oldValue:{[field]:project[field]},newValue:{[field]:value}}});
 await tx.domainEvent.create({data:{type:'project.updated',actor:actor.id,payload:{projectId,field}}});
 return{ok:true,value,changed:true,projectId,clientId:field==='clientId'?value!:project.clientId,...(selectedClient?{clientLabel:[selectedClient.lastName,selectedClient.name,selectedClient.middleName].filter(Boolean).join(' '),phone:selectedClient.phone}:{})};
}
