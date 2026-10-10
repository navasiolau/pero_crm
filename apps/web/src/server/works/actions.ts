"use server";
import { workVisibilityWhere } from "@/server/access/visibility";

import { revalidatePath } from "next/cache";
import {addWorkCore,type AddWorkInput} from "./core";
import {updateWorkCore,type UpdateWorkInput} from "./update-core";

import { auth } from "@/auth";
import { writeChangeLog } from "@/server/plugins/changelog";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { withTaskTransaction } from "@/server/tasks/transaction";

import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";

// Server-owned tariff/unit snapshot and audit live in the atomic domain core.
export async function addWork(input:AddWorkInput):Promise<{ok:boolean;error?:string}> {
 const session=await auth();if(!session?.user)throw Error('Не авторизован');
 const result=await addWorkCore({id:session.user.id,name:session.user.name??'',roles:session.user.roles,source:'web'},input);
 if(result.ok){revalidatePath(`/projects/${input.projectId}`);await revalidateProductPaths(input.productId);}
 return result;
}

export async function updateWork(input:UpdateWorkInput) {
 const session=await auth();if(!session?.user)return{ok:false as const,kind:'forbidden' as const,error:'Не авторизован'};
 const result=await updateWorkCore({id:session.user.id,name:session.user.name??'',roles:session.user.roles,source:'web'},input);
 if(result.ok){try{revalidatePath(`/projects/${input.projectId}`);await revalidateProductPaths(input.productId);}catch{/* Правка уже подтверждена; receipt защищает повтор. */}}
 return result;
}

export async function removeWork(
  workId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  if (!hasAnyRole(session.user.roles, MANAGER_ROLES)) throw new Error("Недостаточно прав");

  const mutation = await withTaskTransaction(async (tx) => {
  const work = await tx.work.findUnique({ where: { id: workId, AND: [workVisibilityWhere(session.user)] } });
  if (!work) return { ok: false as const, error: "Работа не найдена" };
  if (work.paymentKind === "ENGINEERING") return { ok: false as const, error: "Работа включена в инженерный фонд — используйте настройку его распределения" };
  if (work.paymentKind === "INSTALLATION") return { ok: false as const, error: "Работа отмечена как монтажная; её история сохраняется вместе с настройкой процента изделия" };
  const linked = await tx.task.count({ where: { workId } });
  if (linked > 0) {
    return { ok: false as const, error: "К работе привязаны задачи — сначала удалите их" };
  }

  await tx.work.delete({ where: { id: workId } });
  return { ok: true as const, work };
  });
  if (!mutation.ok) return mutation;
  const { work } = mutation;
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "work",
    entityId: workId,
    action: "delete",
    oldValue: { title: work.title, total: work.total?.toString() ?? null },
  });
  revalidatePath(`/projects/${work.projectId}`);
  await revalidateProductPaths(work.productId);
  return { ok: true };
}
