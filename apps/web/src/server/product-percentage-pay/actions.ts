"use server";

import type { ProductPercentageKind } from "@prisma/client";
import { patchProductPercentageCore } from "./patch-core";
import type { ProductPercentagePatch,ProductPercentagePatchResult } from "./contracts";
import { prisma } from "@/lib/prisma";
import { productVisibilityWhere } from "@/server/access/visibility";
import { auth } from "@/auth";
import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";
import type { DomainActor } from "@/server/projects/core";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { withTaskTransaction } from "@/server/tasks/transaction";
import {notifyPerson} from "@/server/notifications/notify";
import type {PercentageAdjustmentNotice} from "./direct-completion";
import { configureProductPercentageCore, settlePendingProductPercentage, transferProductPercentageCore } from "./core";

async function actor(): Promise<DomainActor> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  return { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" };
}
async function answer<T>(productId: string, operation: () => Promise<T>): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  try {
    const result = await operation();
    await revalidateProductPaths(productId).catch(() => {});
    return { ok: true, result };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Не удалось сохранить настройки изделия" }; }
}

export async function configureProductPercentageAction(input: { productId: string; kind: ProductPercentageKind;
  ratePercent: string | null; participants?: { userId: string; shareUnits: number }[]; expectedRevision: number;
  installationWorkIds?: string[]; reviewedLegacyWorks?: boolean }) {
  const user = await actor();
  return answer(input.productId, () => withTaskTransaction((tx) => configureProductPercentageCore(user, input, tx)));
}

export async function transferProductPercentageShareAction(input: { productId: string; kind: ProductPercentageKind;
  toUserId: string; percentOfOwnShare: string; expectedRevision: number }) {
  const user = await actor();
  return answer(input.productId, () => withTaskTransaction((tx) => transferProductPercentageCore(user, input, tx)));
}

export async function setProductNoModelAction(input: { productId: string; noModel: boolean }) {
  void input;
  await actor();
  return { ok: false as const, error: "Отметка модели больше не используется для изменения статуса" };
}
export async function retryProductPercentageAction(input: { productId: string; kind: ProductPercentageKind }) {
  const user = await actor();
  if (!hasAnyRole(user.roles, MANAGER_ROLES)) return { ok: false as const, error: "Недостаточно прав" };
  if (!await prisma.product.findFirst({ where: { id: input.productId, AND: [productVisibilityWhere(user)] }, select: { id: true } }))
    return { ok: false as const, error: "Изделие не найдено" };
  return answer(input.productId, () => settlePendingProductPercentage(input.productId, input.kind, {
    transaction: operation => withTaskTransaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${input.productId} FOR UPDATE`;
      if (!await tx.product.findFirst({ where: { id: input.productId, AND: [productVisibilityWhere(user)] }, select: { id: true } }))
        throw new Error("Изделие не найдено");
      return operation(tx);
    }),
  }));
}

export async function patchProductPercentageAction(input:ProductPercentagePatch):Promise<ProductPercentagePatchResult>{
  try {
    const user=await actor();
    const effects:PercentageAdjustmentNotice[]=[];
    const result=await withTaskTransaction(tx=>patchProductPercentageCore(user,input,tx,effects));
    if(result.ok){
      for(const effect of effects)await notifyPerson({userId:effect.userId,type:"payroll.accrued",title:`Процентная оплата пересчитана: ${effect.delta} BYN`,body:`${effect.label} изделия ${effect.number}: было ${effect.oldAmount}, стало ${effect.newAmount}`,link:"/payroll"}).catch(()=>{});
    }
    // Partial fields return a compact receipt; page/status operations revalidate separately.
    return result;
  }catch(error){return{ok:false,kind:"failure",error:error instanceof Error?error.message:"Не удалось сохранить оплату изделия"};}
}
