"use server";
import { changeWorkTaskLifecycle, WorkTaskLifecycleRefusal } from "@/server/tasks/lifecycle-core";

import { revalidatePath } from "next/cache";
import { deliverPostCommit } from "@/server/operations/post-commit";
import {addWorkCore,type AddWorkInput} from "./core";
import {updateWorkCore,type UpdateWorkInput} from "./update-core";

import { auth } from "@/auth";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { withTaskTransaction } from "@/server/tasks/transaction";

import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";

// Server-owned tariff/unit snapshot and audit live in the atomic domain core.
export async function addWork(input:AddWorkInput):Promise<{ok:boolean;error?:string}> {
 const session=await auth();if(!session?.user)throw Error('Не авторизован');
 const result=await addWorkCore({id:session.user.id,name:session.user.name??'',roles:session.user.roles,source:'web'},input);
 if(result.ok)await deliverPostCommit("work-create", result.workId, [{kind:"cache",run:()=>revalidatePath(`/projects/${input.projectId}`)},{kind:"cache",run:()=>revalidateProductPaths(input.productId)}]);
 return result;
}

export async function updateWork(input:UpdateWorkInput) {
 const session=await auth();if(!session?.user)return{ok:false as const,kind:'forbidden' as const,error:'Не авторизован'};
 const result=await updateWorkCore({id:session.user.id,name:session.user.name??'',roles:session.user.roles,source:'web'},input);
 if(result.ok)await deliverPostCommit("work-update", input.workId, [{kind:"cache",run:()=>revalidatePath(`/projects/${input.projectId}`)},{kind:"cache",run:()=>revalidateProductPaths(input.productId)}]);
 return result;
}

export async function removeWork(workId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user || !hasAnyRole(session.user.roles, MANAGER_ROLES)) throw Error("Недостаточно прав");
  const actor = { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" as const };
  try {
    const { cachePaths } = await withTaskTransaction(tx => changeWorkTaskLifecycle(tx, actor, "work", workId));
    await deliverPostCommit("work-delete", workId, cachePaths.map(path => ({ kind: "cache", run: () => revalidatePath(path) })));
    return { ok: true };
  } catch (error) {
    if (error instanceof WorkTaskLifecycleRefusal) return { ok: false, error: error.message };
    throw error;
  }
}
