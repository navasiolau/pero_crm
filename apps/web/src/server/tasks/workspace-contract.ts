import type {Prisma,PrismaClient} from '@prisma/client';
import {taskPieceAmount,type TaskAllocationValues} from '@/lib/work-shares';
export const taskWorkspaceBindings:Prisma.TaskWhereInput={
  productId:{not:null},workId:{not:null},assigneeId:{not:null},
  work:{is:{productId:{not:null},project:{deletedAt:null},product:{is:{deletedAt:null,project:{deletedAt:null}}}}},
  OR:[{work:{is:{priceSnapshot:{not:null}}}},{allocationGroupId:{not:null},shareAmount:{not:null}}],
};
/** IDs are eligibility only: callers retain their original ACL as a separate AND. */
export async function taskWorkspaceEligibility(db:Pick<PrismaClient,'$queryRaw'>,scope:{projectId?:string;productId?:string}={}):Promise<Prisma.TaskWhereInput>{
  const rows=await db.$queryRaw<{id:string}[]>`
    SELECT t.id FROM "Task" t
    JOIN "Work" w ON w.id=t."workId" AND w."projectId"=t."projectId" AND w."productId"=t."productId"
    JOIN "Product" p ON p.id=t."productId" AND p.id=w."productId" AND p."projectId"=t."projectId"
    JOIN "Project" j ON j.id=t."projectId"
    WHERE t."assigneeId" IS NOT NULL AND p."deletedAt" IS NULL AND j."deletedAt" IS NULL
      AND (w."priceSnapshot" IS NOT NULL OR (t."allocationGroupId" IS NOT NULL AND t."shareAmount" IS NOT NULL))
      AND (${scope.projectId??null}::text IS NULL OR t."projectId"=${scope.projectId??null})
      AND (${scope.productId??null}::text IS NULL OR t."productId"=${scope.productId??null})
    ORDER BY t.id`;
  return{AND:[taskWorkspaceBindings,{id:{in:rows.map(row=>row.id)}}]};
}
export function taskReward(task:TaskAllocationValues,price:string|null,currency:string|null){
  if(!currency||price===null&&!task.allocationGroupId)return{rewardAmount:null,rewardCurrency:null,rewardSource:'UNAVAILABLE' as const};
  if(task.allocationGroupId&&task.shareAmount==null)return{rewardAmount:null,rewardCurrency:null,rewardSource:'UNAVAILABLE' as const};
  return{rewardAmount:taskPieceAmount(task,price??'0'),rewardCurrency:currency,rewardSource:task.allocationGroupId?'FROZEN_TASK_SNAPSHOT' as const:'WORK_SNAPSHOT' as const};
}
