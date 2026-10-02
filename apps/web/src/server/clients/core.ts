import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { MANAGER_ROLES, hasAnyRole } from '@/lib/roles';
import type { DomainActor } from '@/server/projects/core';

export const clientSchema = z.object({
 name: z.string().trim().min(1, 'Укажите имя'), lastName: z.string().optional(), middleName: z.string().optional(),
 phone: z.string().trim().min(1, 'Укажите телефон'), email: z.string().optional(), address: z.string().optional(), comment: z.string().optional(),
}).strict();
export type ClientInput = z.infer<typeof clientSchema>;
export const clientFields = ['name','lastName','middleName','phone','email','address','comment'] as const;
export type ClientBaseline = {name:string;phone:string} & Record<Exclude<typeof clientFields[number],'name'|'phone'>, string|null>;
const baselineSchema = z.object({name:z.string(),phone:z.string(),lastName:z.string().nullable(),middleName:z.string().nullable(),email:z.string().nullable(),address:z.string().nullable(),comment:z.string().nullable()}).strict();
export type ContactResult = {ok:true;value:string|null;changed:boolean;projectId?:string;clientId:string;clientLabel?:string;phone?:string} | {ok:false;kind:'conflict'|'validation'|'forbidden'|'not-found';error:string;currentValue?:string|null;currentClientId?:string};
export function mayManageContacts(actor:DomainActor) { return hasAnyRole(actor.roles,MANAGER_ROLES); }
function normalized(input:ClientInput):ClientBaseline {
 return {name:input.name,phone:input.phone,lastName:input.lastName?.trim()||null,middleName:input.middleName?.trim()||null,email:input.email?.trim()||null,address:input.address?.trim()||null,comment:input.comment?.trim()||null};
}
async function auditClient(tx:Prisma.TransactionClient,actor:DomainActor,clientId:string,action:string,oldValue:Prisma.InputJsonValue,newValue:Prisma.InputJsonValue,field?:string) {
 await tx.changeLog.create({data:{actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'client',entityId:clientId,action,field,oldValue,newValue}});
 await tx.domainEvent.create({data:{type:action==='create'?'client.created':'client.updated',actor:actor.id,payload:{clientId,...(field?{field}:{})}}});
}
export async function patchClientPhoneInTransaction(tx:Prisma.TransactionClient,actor:DomainActor,clientId:string,phone:string,expectedPhone:string):Promise<ContactResult> {
 if(!mayManageContacts(actor))return{ok:false,kind:'forbidden',error:'Недостаточно прав'};
 const value=phone.trim();if(!value)return{ok:false,kind:'validation',error:'Укажите телефон'};
 await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
 const client=await tx.client.findUnique({where:{id:clientId},select:{id:true,phone:true}});
 if(!client)return{ok:false,kind:'not-found',error:'Клиент не найден'};
 if(client.phone!==expectedPhone)return{ok:false,kind:'conflict',error:'Телефон изменён другим пользователем',currentValue:client.phone,currentClientId:client.id};
 if(client.phone===value)return{ok:true,value,changed:false,clientId};
 const update=await tx.client.updateMany({where:{id:clientId,phone:expectedPhone},data:{phone:value}});
 if(update.count!==1)throw new Error('CLIENT_CONTACT_CAS_RACE');
 await auditClient(tx,actor,clientId,'update',{phone:client.phone},{phone:value},'phone');
 return{ok:true,value,changed:true,clientId};
}
export async function createClientInTransaction(tx:Prisma.TransactionClient,actor:DomainActor,input:ClientInput) {
 if(!mayManageContacts(actor))return{ok:false as const,error:'Недостаточно прав'};
 const parsed=clientSchema.safeParse(input);if(!parsed.success)return{ok:false as const,error:parsed.error.issues[0]?.message??'Ошибка данных'};
 const client=await tx.client.create({data:normalized(parsed.data)});
 await auditClient(tx,actor,client.id,'create',{}, {name:client.name,phone:client.phone});
 return{ok:true as const,id:client.id};
}
export async function updateClientInTransaction(tx:Prisma.TransactionClient,actor:DomainActor,clientId:string,input:ClientInput,baseline:ClientBaseline) {
 if(!mayManageContacts(actor))return{ok:false as const,error:'Недостаточно прав'};
 const parsed=clientSchema.safeParse(input);const expected=baselineSchema.safeParse(baseline);
 if(!parsed.success)return{ok:false as const,error:parsed.error.issues[0]?.message??'Ошибка данных'};
 if(!expected.success)return{ok:false as const,error:'Форма устарела — обновите карточку клиента'};
 const desired=normalized(parsed.data);
 const changed=clientFields.filter(field=>desired[field]!==expected.data[field]);
 await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
 const current=await tx.client.findUnique({where:{id:clientId}});if(!current)return{ok:false as const,error:'Клиент не найден'};
 if(changed.some(field=>current[field]!==expected.data[field]))return{ok:false as const,error:'Клиент изменён другим пользователем — обновите форму'};
 if(!changed.length)return{ok:true as const,noOp:true};
 const data=Object.fromEntries(changed.map(field=>[field,desired[field]]));
 const where={id:clientId,...Object.fromEntries(changed.map(field=>[field,expected.data[field]]))};
 const result=await tx.client.updateMany({where,data});if(result.count!==1)throw new Error('CLIENT_CONTACT_CAS_RACE');
 await auditClient(tx,actor,clientId,'update',Object.fromEntries(changed.map(field=>[field,current[field]])),data);
 return{ok:true as const,noOp:false};
}
