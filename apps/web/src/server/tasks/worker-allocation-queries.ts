import {taskWorkspaceEligibility,taskReward} from './workspace-contract';
import {prisma} from '@/lib/prisma';
import type {TaskStatus} from '@prisma/client';
import {hasAnyRole,FIELD_ROLES} from '@/lib/roles';
import {allocatedWorkQuantity,quantityAtoms} from '@/lib/work-shares';
import {liveProductWhere,liveChildWhere} from '@/server/access/live-entities';
export type WorkerAllocationData={workerOptions:{id:string;name:string}[];eligibleWorkIds:string[];createdAssignments:{id:string;title:string;assigneeName:string;quantity:string;status:TaskStatus;workId:string;dueAt:string|null;rewardAmount:string|null;rewardCurrency:string|null;rewardSource:'WORK_SNAPSHOT'|'FROZEN_TASK_SNAPSHOT'|'UNAVAILABLE'}[];dependencyOptions:{id:string;title:string;status:TaskStatus}[]};
export async function listWorkerAllocationData(actorId:string,productId:string):Promise<WorkerAllocationData>{
 const empty:WorkerAllocationData={workerOptions:[],eligibleWorkIds:[],createdAssignments:[],dependencyOptions:[]};
  const actor=await prisma.user.findUnique({where:{id:actorId},select:{active:true,roles:true}});if(!actor?.active||!hasAnyRole(actor.roles,FIELD_ROLES))return empty;
 const product=await prisma.product.findFirst({where:{...liveProductWhere,id:productId,status:'PRODUCTION'},select:{id:true,projectId:true}});if(!product)return empty;
 const workspace=await taskWorkspaceEligibility(prisma,{projectId:product.projectId,productId:product.id});
 const [workers,works,created,dependencies]=await Promise.all([
   prisma.user.findMany({where:{active:true,roles:{hasSome:['WORKER','MOUNTER']}},select:{id:true,name:true},orderBy:{name:'asc'}}),
  prisma.work.findMany({where:{...liveChildWhere,productId:product.id,projectId:product.projectId,paymentKind:'LEGACY',stagePayPoolId:null,priceSnapshot:{not:null}},select:{id:true,quantity:true,tasks:{select:{quantity:true,allocationGroupId:true}}}}),
  prisma.task.findMany({where:{...liveChildWhere,productId:product.id,projectId:product.projectId,AND:[workspace],createdById:actorId,assigneeId:{not:actorId},work:{paymentKind:'LEGACY',stagePayPoolId:null}},select:{id:true,title:true,assignee:{select:{name:true}},quantity:true,status:true,workId:true,dueAt:true,executorShare:true,allocationGroupId:true,shareAmount:true,allocationGroup:{select:{currency:true}},work:{select:{priceSnapshot:true}}},orderBy:{createdAt:'desc'}}),
  prisma.task.findMany({where:{...liveChildWhere,AND:[workspace],productId:product.id,projectId:product.projectId},select:{id:true,title:true,status:true},orderBy:{createdAt:'asc'}}),
 ]);
 const payrollCurrency=(await prisma.orgSetting.findUnique({where:{key:'payrollCurrency'},select:{value:true}}))?.value??'BYN';
 const eligibleWorkIds=works.filter(work=>{if(work.tasks.some(task=>task.quantity===null))return false;try{return quantityAtoms(work.quantity)>quantityAtoms(allocatedWorkQuantity(work.tasks));}catch{return false;}}).map(work=>work.id);
 return{workerOptions:workers,eligibleWorkIds,createdAssignments:created.filter(task=>task.workId!==null).map(task=>({id:task.id,title:task.title,assigneeName:task.assignee?.name??'—',quantity:task.quantity?.toString()??'—',status:task.status,workId:task.workId!,dueAt:task.dueAt?.toISOString()??null,...taskReward(task,task.work?.priceSnapshot?.toString()??null,task.allocationGroup?task.allocationGroup.currency:payrollCurrency==='BYN'?'BYN':null)})),dependencyOptions:dependencies};
}
