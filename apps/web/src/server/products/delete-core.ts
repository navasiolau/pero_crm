import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import { canAccessProductDraft } from "@/lib/product-drafts";
import { productDraftAccessSelect } from "@/server/access/product-draft-context";
import {MANAGER_ROLES,hasAnyRole} from '@/lib/roles';
import type {DomainActor} from '../projects/core';
import {productDeleteSchema,type ProductDeleteInput,type ProductDeleteResult} from './delete-contract';
const failure=(kind:Extract<ProductDeleteResult,{ok:false}>['kind'],error:string):ProductDeleteResult=>({ok:false,kind,error});
export async function softDeleteProductCore(tx:Prisma.TransactionClient,actor:DomainActor,input:ProductDeleteInput):Promise<ProductDeleteResult>{
 const parsed=productDeleteSchema.safeParse(input);if(!parsed.success)return failure('validation','Обновите подтверждение удаления изделия');
 if(!hasAnyRole(actor.roles,MANAGER_ROLES))return failure('forbidden','Недостаточно прав');
 const data=parsed.data,initial=await tx.product.findUnique({where:{id:data.productId},select:{projectId:true}});if(!initial)return failure('not-found','Изделие не найдено');
 await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${initial.projectId} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${data.productId} FOR UPDATE`;
 const parent=await tx.project.findUnique({where:{id:initial.projectId},select:{id:true,deletedAt:true}});
 if(!parent||parent.deletedAt!==null)return failure('not-found','Проект удалён или недоступен');
 const product=await tx.product.findUnique({where:{id:data.productId},select:{...productDraftAccessSelect,id:true,number:true,title:true,updatedAt:true,status:true}});
 if(!product||product.projectId!==parent.id||product.status==='DRAFT'&&!canAccessProductDraft(actor.roles,product))return failure('not-found','Изделие не найдено');
 const fingerprint=createHash('sha256').update(JSON.stringify(data)).digest('hex'),receiptId=`product-delete:${data.clientMutationId}`;
 const receipt=await tx.changeLog.findUnique({where:{id:receiptId}});
 if(receipt){const saved=receipt.newValue;if(receipt.actorId!==actor.id||receipt.entity!=='product'||receipt.entityId!==product.id||receipt.action!=='soft-delete'||!saved||typeof saved!=='object'||Array.isArray(saved)||saved.fingerprint!==fingerprint||!saved.result||typeof saved.result!=='object')return failure('conflict','Идентификатор удаления уже использован');return{...saved.result as unknown as Extract<ProductDeleteResult,{ok:true}>,repeated:true};}
 if(product.deletedAt!==null)return failure('conflict','Изделие уже удалено');
 if(product.updatedAt.toISOString()!==data.expectedUpdatedAt)return failure('conflict','Изделие изменилось. Обновите карточку и подтвердите удаление заново');
 if(await tx.timeEntry.count({where:{source:'timer',stoppedAt:null,task:{productId:product.id}}}))return failure('active-timer','Сначала остановите активный таймер задачи изделия');
 const deletedAt=new Date();
 const changed=await tx.product.updateMany({where:{id:product.id,projectId:parent.id,deletedAt:null,updatedAt:new Date(data.expectedUpdatedAt)},data:{deletedAt,deletedById:actor.id}});
 if(changed.count!==1)throw Error('PRODUCT_SOFT_DELETE_CAS_RACE');
 const result:ProductDeleteResult={ok:true,productId:product.id,projectId:parent.id,number:product.number,title:product.title,deletedAt:deletedAt.toISOString(),clientMutationId:data.clientMutationId};
 await tx.changeLog.create({data:{id:receiptId,actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'product',entityId:product.id,action:'soft-delete',field:'deletedAt',oldValue:{number:product.number,title:product.title,updatedAt:data.expectedUpdatedAt},newValue:JSON.parse(JSON.stringify({fingerprint,result})) as Prisma.InputJsonValue}});
 return result;
}
