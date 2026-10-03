import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {MANAGER_ROLES,hasAnyRole} from '@/lib/roles';
import type {DomainActor} from './core';
import {projectDeleteSchema,type ProjectDeleteInput,type ProjectDeleteResult} from './delete-contract';
export function projectProductsVersion(rows:readonly {id:string;updatedAt:Date;deletedAt:Date|null;deletedById:string|null}[]){return createHash('sha256').update(JSON.stringify([...rows].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(row=>({id:row.id,updatedAt:row.updatedAt.toISOString(),deletedAt:row.deletedAt?.toISOString()??null,deletedById:row.deletedById})))).digest('hex');}
const failure=(kind:Extract<ProjectDeleteResult,{ok:false}>['kind'],error:string):ProjectDeleteResult=>({ok:false,kind,error});
export async function softDeleteProjectCore(tx:Prisma.TransactionClient,actor:DomainActor,input:ProjectDeleteInput):Promise<ProjectDeleteResult>{
 const parsed=projectDeleteSchema.safeParse(input);if(!parsed.success)return failure('validation','Обновите подтверждение удаления проекта');
 if(!hasAnyRole(actor.roles,MANAGER_ROLES))return failure('forbidden','Недостаточно прав');
 const data=parsed.data;
 await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${data.projectId} FOR UPDATE`;
 const project=await tx.project.findUnique({where:{id:data.projectId},select:{id:true,number:true,title:true,updatedAt:true,deletedAt:true,deletedById:true}});
 if(!project)return failure('not-found','Проект не найден');
 const receiptId=`project-delete:${data.clientMutationId}`,fingerprint=createHash('sha256').update(JSON.stringify(data)).digest('hex'),receipt=await tx.changeLog.findUnique({where:{id:receiptId}});
 if(receipt){const saved=receipt.newValue;if(receipt.actorId!==actor.id||receipt.entity!=='project'||receipt.entityId!==project.id||receipt.action!=='soft-delete'||!saved||typeof saved!=='object'||Array.isArray(saved)||saved.fingerprint!==fingerprint||!saved.result||typeof saved.result!=='object')return failure('conflict','Идентификатор удаления уже использован');const result=saved.result as unknown as Extract<ProjectDeleteResult,{ok:true}>;if(project.deletedAt?.toISOString()!==result.deletedAt||project.deletedById!==actor.id)return failure('conflict','Состояние удалённого проекта изменилось');return{...result,repeated:true};}
 if(project.deletedAt!==null)return failure('conflict','Проект уже удалён');
 if(project.updatedAt.toISOString()!==data.expectedUpdatedAt)return failure('conflict','Проект изменился. Обновите карточку и подтвердите удаление заново');
 await tx.$queryRaw`SELECT id FROM "Product" WHERE "projectId"=${project.id} ORDER BY id FOR UPDATE`;
 const children=await tx.product.findMany({where:{projectId:project.id},select:{id:true,updatedAt:true,deletedAt:true,deletedById:true},orderBy:{id:'asc'}});
 if(projectProductsVersion(children)!==data.expectedProductsVersion)return failure('conflict','Изделия проекта изменились. Обновите подтверждение удаления');
 if(await tx.timeEntry.count({where:{source:'timer',stoppedAt:null,task:{projectId:project.id}}}))return failure('active-timer','Сначала остановите активные таймеры задач проекта');
 const deletedAt=new Date(),liveIds=children.filter(row=>row.deletedAt===null).map(row=>row.id);
 if((await tx.project.updateMany({where:{id:project.id,deletedAt:null,updatedAt:new Date(data.expectedUpdatedAt)},data:{deletedAt,deletedById:actor.id}})).count!==1)throw Error('PROJECT_SOFT_DELETE_CAS_RACE');
 if((await tx.product.updateMany({where:{projectId:project.id,deletedAt:null,id:{in:liveIds}},data:{deletedAt,deletedById:actor.id}})).count!==liveIds.length)throw Error('PROJECT_CHILD_DELETE_CAS_RACE');
 const result:ProjectDeleteResult={ok:true,projectId:project.id,number:project.number,title:project.title,deletedAt:deletedAt.toISOString(),clientMutationId:data.clientMutationId,affectedProductIds:liveIds};
 await tx.changeLog.create({data:{id:receiptId,actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'project',entityId:project.id,action:'soft-delete',field:'deletedAt',oldValue:{number:project.number,title:project.title,updatedAt:data.expectedUpdatedAt,productsVersion:data.expectedProductsVersion},newValue:JSON.parse(JSON.stringify({fingerprint,result})) as Prisma.InputJsonValue}});
 return result;
}
