import type {Prisma,PrismaClient} from '@prisma/client';
import {taskPieceAmount,type TaskAllocationValues} from '@/lib/work-shares';
import {liveProductWhere} from '@/server/access/live-entities';
export const taskWorkspaceBindings:Prisma.TaskWhereInput={
  productId:{not:null},workId:{not:null},assigneeId:{not:null},
  work:{is:{productId:{not:null},project:{deletedAt:null},product:{is:{deletedAt:null,project:{deletedAt:null}}}}},
  OR:[{work:{is:{priceSnapshot:{not:null}}}},{allocationGroupId:{not:null},shareAmount:{not:null}}],
};
export type TaskWorkspaceScope =
  | {projectId:string;productId?:string}
  | {productKey:string}
  | {projectIds:readonly string[]}
  | {tasks:Prisma.TaskWhereInput};

const nonempty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
function scopedProducts(scope:TaskWorkspaceScope):{products:Prisma.ProductWhereInput;tasks:Prisma.TaskWhereInput}|null {
  if(!scope||typeof scope!=='object'||Array.isArray(scope))return null;
  const keys=Object.keys(scope).sort().join('|');
  if('projectId' in scope&&(keys==='projectId'||keys==='productId|projectId')&&nonempty(scope.projectId)){
    if('productId' in scope&&!nonempty(scope.productId))return null;
    return{products:{projectId:scope.projectId,...('productId' in scope?{id:scope.productId}:{})},tasks:{}};
  }
  if('productKey' in scope&&keys==='productKey'&&nonempty(scope.productKey))return{products:{OR:[{id:scope.productKey},{number:scope.productKey}]},tasks:{}};
  if('projectIds' in scope&&keys==='projectIds'&&Array.isArray(scope.projectIds)&&scope.projectIds.length&&scope.projectIds.every(nonempty))return{products:{projectId:{in:[...new Set(scope.projectIds)]}},tasks:{}};
  if('tasks' in scope&&keys==='tasks'&&scope.tasks&&typeof scope.tasks==='object'&&!Array.isArray(scope.tasks)&&!(scope.tasks instanceof Date))return{products:{},tasks:scope.tasks};
  return null;
}

/** Координаты ограничивают eligibility; действующие права caller проверяет отдельно. */
export async function taskWorkspaceEligibility(
  db:Pick<PrismaClient,'product'>,
  scope:TaskWorkspaceScope,
  candidateWhere:Prisma.TaskWhereInput={},
):Promise<Prisma.TaskWhereInput>{
  const selected=scopedProducts(scope);if(!selected)return{id:{in:[]}};
  const products=await db.product.findMany({
    where:{AND:[liveProductWhere,selected.products,{tasks:{some:{AND:[taskWorkspaceBindings,selected.tasks,candidateWhere]}}}]},
    select:{id:true,projectId:true},orderBy:{id:'asc'},
  });
  if(!products.length)return{id:{in:[]}};
  return{AND:[taskWorkspaceBindings,selected.tasks,{OR:products.map(product=>({
    projectId:product.projectId,productId:product.id,
    work:{is:{projectId:product.projectId,productId:product.id}},
    product:{is:{projectId:product.projectId}},
  }))}]};
}
export function taskReward(task:TaskAllocationValues,price:string|null,currency:string|null){
  if(!currency||price===null&&!task.allocationGroupId)return{rewardAmount:null,rewardCurrency:null,rewardSource:'UNAVAILABLE' as const};
  if(task.allocationGroupId&&task.shareAmount==null)return{rewardAmount:null,rewardCurrency:null,rewardSource:'UNAVAILABLE' as const};
  return{rewardAmount:taskPieceAmount(task,price??'0'),rewardCurrency:currency,rewardSource:task.allocationGroupId?'FROZEN_TASK_SNAPSHOT' as const:'WORK_SNAPSHOT' as const};
}
