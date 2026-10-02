import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {hasAnyRole,MANAGER_ROLES} from '@/lib/roles';
import type {DomainActor} from '@/server/projects/core';
import {DEFAULT_PERCENTAGE_KEY,EMPTY_DEFAULTS,defaultsSnapshotSchema,defaultsPatchSchema,type DefaultsSnapshot,type DefaultsResult} from './contracts';
export async function readProductPercentageDefaults(tx:Pick<Prisma.TransactionClient,'orgSetting'>):Promise<DefaultsSnapshot>{
 const row=await tx.orgSetting.findUnique({where:{key:DEFAULT_PERCENTAGE_KEY},select:{value:true}});
 if(!row)return structuredClone(EMPTY_DEFAULTS);
 try{return defaultsSnapshotSchema.parse(JSON.parse(row.value));}catch{throw Error('Проверьте стандартные процентные настройки организации');}
}
export async function saveProductPercentageDefaults(actor:DomainActor,input:unknown,tx:Prisma.TransactionClient):Promise<DefaultsResult>{
 if(!hasAnyRole(actor.roles,MANAGER_ROLES))return{ok:false,kind:'forbidden',error:'Недостаточно прав'};
 const parsed=defaultsPatchSchema.safeParse(input);if(!parsed.success)return{ok:false,kind:'validation',error:parsed.error.issues[0]?.message??'Проверьте проценты'};
 const data=parsed.data,id=`product-percentage-defaults:${data.clientMutationId}`,fingerprint=createHash('sha256').update(JSON.stringify(data)).digest('hex');
 const receipt=await tx.changeLog.findUnique({where:{id}});
 if(receipt){const saved=receipt.newValue as {fingerprint?:string;result?:DefaultsResult}|null;if(receipt.actorId!==actor.id||receipt.entity!=='orgSetting'||receipt.entityId!==DEFAULT_PERCENTAGE_KEY||receipt.action!=='percentage-defaults.update'||saved?.fingerprint!==fingerprint||!saved.result||!saved.result.ok)return{ok:false,kind:'validation',error:'Идентификатор запроса уже использован'};return{...saved.result,repeated:true};}
 const current=await readProductPercentageDefaults(tx);
 if(data.expectedRevision!==current.revision||JSON.stringify(data.expectedRates)!==JSON.stringify(current.rates))return{ok:false,kind:'conflict',error:'Настройки изменены другим пользователем',current};
 if(JSON.stringify(data.rates)===JSON.stringify(current.rates))return{ok:true,kind:'saved',snapshot:current,noOp:true,repeated:false};
 const snapshot={revision:current.revision+1,rates:data.rates},value=JSON.stringify(snapshot);
 await tx.orgSetting.upsert({where:{key:DEFAULT_PERCENTAGE_KEY},create:{key:DEFAULT_PERCENTAGE_KEY,value},update:{value}});
 const result:DefaultsResult={ok:true,kind:'saved',snapshot,noOp:false,repeated:false};
 await tx.changeLog.create({data:{id,actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'orgSetting',entityId:DEFAULT_PERCENTAGE_KEY,action:'percentage-defaults.update',oldValue:current,newValue:{fingerprint,result}}});
 return result;
}
