"use server";
import {auth} from '@/auth';
import {prisma} from '@/lib/prisma';
import {revalidatePath} from 'next/cache';
import {MANAGER_ROLES,hasAnyRole} from '@/lib/roles';
import {withTaskTransaction} from '../tasks/transaction';
import {liveProjectWhere} from '../access/live-entities';
import {softDeleteProjectCore,projectProductsVersion} from './delete-core';
import type {ProjectDeleteInput,ProjectDeleteResult,ProjectDeleteBaseline} from './delete-contract';
export async function readProjectDeleteBaseline(projectId:string):Promise<{ok:true;baseline:ProjectDeleteBaseline}|{ok:false;error:string}>{
 const session=await auth();if(!session?.user||!hasAnyRole(session.user.roles,MANAGER_ROLES))return{ok:false,error:'Недостаточно прав'};
 const project=await prisma.project.findFirst({where:{...liveProjectWhere,id:projectId},select:{id:true,number:true,title:true,updatedAt:true}});if(!project)return{ok:false,error:'Проект не найден'};
 const children=await prisma.product.findMany({where:{projectId:project.id},select:{id:true,updatedAt:true,deletedAt:true,deletedById:true}});
 return{ok:true,baseline:{projectId:project.id,number:project.number,title:project.title,expectedUpdatedAt:project.updatedAt.toISOString(),expectedProductsVersion:projectProductsVersion(children),productCount:children.length}};
}
export async function deleteProjectAction(input:ProjectDeleteInput):Promise<ProjectDeleteResult>{
 const session=await auth();if(!session?.user)return{ok:false,kind:'forbidden',error:'Не авторизован'};
 try{const result=await withTaskTransaction(tx=>softDeleteProjectCore(tx,{id:session.user.id,name:session.user.name??'',roles:session.user.roles,source:'web'},input));if(result.ok){try{for(const route of ['/projects','/products',`/projects/${result.projectId}`])revalidatePath(route);}catch{console.warn(JSON.stringify({event:'project.soft_delete.revalidate_failed',clientMutationId:input.clientMutationId}));}}return result;}
 catch{return{ok:false,kind:'failure',error:'Не получено подтверждение удаления проекта. Повторите тот же запрос'};}
}
