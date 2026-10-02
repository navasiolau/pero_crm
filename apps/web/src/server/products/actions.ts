"use server";

import { revalidatePath } from "next/cache";
import type { ProductStatus } from "@prisma/client";
import { auth } from "@/auth";
import { productStatusLabels } from "@/lib/product-statuses";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";
import { revalidateProductPaths } from "./revalidate";
import { listProductOptions } from "./queries";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { settlePendingProductPercentage, deliverProductPercentageEffects } from "@/server/product-percentage-pay/core";
import { changeProductStatusTransaction } from "./status-core";
import { createProductCore, updateProductCore, deleteProductCore, patchProductCore, type CreateProductInput, type UpdateProductInput, type ProductUpdateBaseline } from "./core";
import { malformedProductPatch, productPatchSchema, type ProductPatch, type ProductPatchResult } from "./patch-contract";

type FinanceState = "PENDING_FX" | "SETTLED" | "SKIPPED_ONCE" | "LEGACY_PROTECTED" | null;
async function requireUser() {
  const session=await auth();
  if (!session?.user) throw new Error("Не авторизован");
  return session;
}
function domainActor(session: Awaited<ReturnType<typeof requireUser>>) {
  return {id:session.user.id,name:session.user.name??"",roles:session.user.roles,source:"web" as const};
}
async function revalidateProduct(product: { id: string; projectId: string }) {
  await revalidateProductPaths(product.id);
  revalidatePath("/projects");
}
export async function createProduct(input:CreateProductInput):Promise<{ok:boolean;id?:string;error?:string}> {
  const session=await requireUser();
  const result=await createProductCore(domainActor(session),input);
  if(!result.ok)return result;
  await revalidateProduct(result.product);
  return{ok:true,id:result.product.id};
}
/** Прежняя форма должна передать свой исходный baseline, а не снимок с сервера в момент записи. */
export async function updateProduct(productId:string,input:UpdateProductInput,baseline?:ProductUpdateBaseline):Promise<{ok:boolean;error?:string}> {
  const session=await requireUser();
  const result=await updateProductCore(domainActor(session),productId,input,baseline);
  if(!result.ok)return result;
  if(result.noOp)return{ok:true};
  await revalidateProduct(result.before);
  if(input.quantity!==undefined) for(const path of ["/","/warehouse","/warehouse/stock","/warehouse/items","/finance"]) revalidatePath(path);
  return{ok:true};
}
/** Compact field action: no Next cache invalidation, no full RSC/card reload. */
export async function patchProduct(input:ProductPatch):Promise<ProductPatchResult> {
  const session=await auth();
  if(!session?.user) {
    const parsed=productPatchSchema.safeParse(input);
    if(!parsed.success)return malformedProductPatch(input);
    return{kind:"forbidden",field:parsed.data.field,clientMutationId:parsed.data.clientMutationId,error:"Не авторизован"};
  }
  return patchProductCore(domainActor(session),input);
}
export async function deleteProduct(productId:string):Promise<{ok:boolean;error?:string}> {
  const session=await requireUser();
  const result=await deleteProductCore(domainActor(session),productId);
  if(!result.ok)return result;
  await revalidateProduct(result.product);
  return{ok:true};
}
export async function changeProductStatus(
  productId: string, toStatus: ProductStatus, comment?: string,
): Promise<{ ok: boolean; error?: string; financeState?: FinanceState }> {
  const session = await requireUser();
  if (!Object.hasOwn(productStatusLabels, toStatus)) return { ok: false, error: "Неизвестный статус изделия" };
  try {
    const result = await withTaskTransaction((tx) => changeProductStatusTransaction(tx,
      { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" },
      productId, toStatus, comment));
    if (!result.ok) return result;
    await deliverProductPercentageEffects(result.percentageEffects, productId, session.user.id).catch(()=>{});
    let financeState: FinanceState = result.percentageEffects.earnings.length ? "SETTLED" : null;
    for (const kind of result.captured) {
      let current: FinanceState;
      try { current = await settlePendingProductPercentage(productId, kind); }
      catch { current = "PENDING_FX"; }
      financeState = current === "PENDING_FX" || (financeState as FinanceState) === "PENDING_FX" ? "PENDING_FX" : current;
    }
    if (result.eventId) {
      await dispatchEvent(result.eventId).catch(() => {});
      await notifyOrg({ type: "product.statusChanged",
        title: `${result.product.number}: ${productStatusLabels[result.product.status]} → ${productStatusLabels[toStatus]}`,
        body: result.product.title, link: `/products/${productId}`, exceptUserId: session.user.id,
      }).catch(() => {});
    }
    await revalidateProduct(result.product);
    return { ok: true, financeState };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось изменить статус изделия" };
  }
}

export async function fetchProductOptions(
  projectId: string,
): Promise<{ id: string; number: string; title: string }[]> {
  const session = await requireUser();
  return listProductOptions(projectId, session.user);
}
